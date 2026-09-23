"""NetAILLM 推理封装。

底座为 Chronos-2；NETAI_MODEL_PATH 指向微调权重目录时自动切换，
调用方式完全一致（与 03_predict.py 的加载逻辑保持一致）。
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from . import config

_pipeline = None
_pipeline_lock = threading.Lock()
_load_error: Optional[str] = None
_load_seconds: Optional[float] = None
# Chronos-2 不是线程安全的，推理串行化
_infer_lock = threading.Lock()
# 等待进入推理的请求数。GPU/CPU 只有一份，排队太长不如早点告诉调用方稍后再试。
_waiting = 0
_waiting_lock = threading.Lock()


class QueueFull(RuntimeError):
    """并发请求超过 NETAI_MAX_QUEUE，拒绝排队。"""


class QueueTimeout(RuntimeError):
    """排队超过 NETAI_QUEUE_TIMEOUT 仍未轮到。"""


def queue_depth() -> int:
    return _waiting


class _Slot:
    """限深 + 超时的推理准入控制。"""

    def __enter__(self):
        global _waiting
        with _waiting_lock:
            if _waiting >= config.MAX_QUEUE:
                raise QueueFull(
                    f"当前有 {_waiting} 个预测任务在排队，已达上限 {config.MAX_QUEUE}，请稍后重试")
            _waiting += 1
        try:
            if not _infer_lock.acquire(timeout=config.QUEUE_TIMEOUT):
                raise QueueTimeout(f"排队超过 {config.QUEUE_TIMEOUT:.0f} 秒仍未轮到，请稍后重试")
        except BaseException:
            with _waiting_lock:
                _waiting -= 1
            raise
        return self

    def __exit__(self, *exc):
        global _waiting
        _infer_lock.release()
        with _waiting_lock:
            _waiting -= 1
        return False


def finetune_meta() -> Optional[Dict[str, Any]]:
    """读取微调产物里的 finetune_meta.json（04_finetune.py 写出的训练配置）。"""
    if not config.MODEL_IS_LOCAL:
        return None
    meta_path = Path(config.MODEL_PATH) / "finetune_meta.json"
    if not meta_path.is_file():
        return None
    try:
        return json.loads(meta_path.read_text("utf-8"))
    except Exception:
        return None


def model_info() -> Dict[str, Any]:
    return {
        "label": config.MODEL_LABEL,
        "base_model": config.BASE_MODEL_ID,
        "weights": config.MODEL_PATH,
        "weights_input": config.MODEL_PATH_RAW,
        "is_local": config.MODEL_IS_LOCAL,
        "finetuned": config.IS_FINETUNED,
        "device": config.DEVICE,
        "loaded": _pipeline is not None,
        "load_seconds": _load_seconds,
        "load_error": _load_error or config.MODEL_PATH_ERROR,
        "device_note": config.DEVICE_NOTE,
        "device_setting": config.DEVICE_SETTING,
        "queue_depth": queue_depth(),
        "max_queue": config.MAX_QUEUE,
        "finetune_meta": finetune_meta(),
    }


def get_pipeline():
    """首次调用时加载权重（约 2 秒），之后复用。"""
    global _pipeline, _load_error, _load_seconds
    if _pipeline is not None:
        return _pipeline
    with _pipeline_lock:
        if _pipeline is not None:
            return _pipeline
        # 路径在配置阶段就已判定不可用时直接报错，避免 HF 把本地路径当 repo id
        if config.MODEL_PATH_ERROR:
            _load_error = config.MODEL_PATH_ERROR
            raise FileNotFoundError(config.MODEL_PATH_ERROR)
        from chronos import Chronos2Pipeline
        t0 = time.perf_counter()
        try:
            _pipeline = Chronos2Pipeline.from_pretrained(
                config.MODEL_PATH, device_map=config.DEVICE)
        except Exception as exc:
            hint = ""
            if config.MODEL_IS_LOCAL:
                hint = f"\n权重目录：{config.MODEL_PATH}"
            elif "HFValidationError" in type(exc).__name__ or "Repo id" in str(exc):
                hint = (f"\n「{config.MODEL_PATH_RAW}」既不是已存在的本地目录，也不是合法的 "
                        f"Hugging Face repo id。若要加载本地权重请使用绝对路径。")
            _load_error = f"{type(exc).__name__}: {exc}{hint}"
            raise
        _load_seconds = round(time.perf_counter() - t0, 2)
        _load_error = None
        return _pipeline


def warmup() -> None:
    """后台预热，避免首个预测请求承担加载耗时。"""
    try:
        get_pipeline()
    except Exception:
        pass


def seasonal_naive(context: np.ndarray, horizon: int, period: int) -> np.ndarray:
    """季节性朴素基线：ŷ(T+h) = y(T+h−m·⌈h/m⌉)，作为行业通行的对照参考。"""
    ctx = np.asarray(context, float)
    if ctx.size == 0:
        return np.full(horizon, np.nan)
    period = max(1, min(period, ctx.size))
    out = np.empty(horizon, dtype=float)
    for h in range(horizon):
        idx = ctx.size - period + (h % period)
        out[h] = ctx[idx]
    # 基线取值本身可能缺失，用上下文均值兜底
    if np.isnan(out).any():
        fill = np.nanmean(ctx) if np.isfinite(ctx).any() else 0.0
        out = np.where(np.isnan(out), fill, out)
    return out


def forecast(
    context: pd.DataFrame,
    channels: List[str],
    prediction_length: int,
    quantiles: List[float],
) -> tuple[Dict[str, Dict[float, np.ndarray]], pd.DatetimeIndex, float]:
    """对多个通道一次性预测。

    返回 ({通道: {分位数: 数组}}, 预测时间索引, 推理耗时秒)。
    """
    pipeline = get_pipeline()

    frame = context[channels].copy()
    frame.index.name = "timestamp"
    frame = frame.reset_index()
    frame.insert(0, "item_id", "series")

    qs = sorted(set(round(float(q), 4) for q in quantiles))
    t0 = time.perf_counter()
    with _Slot():
        pred = pipeline.predict_df(
            df=frame,
            prediction_length=prediction_length,
            quantile_levels=qs,
            id_column="item_id",
            timestamp_column="timestamp",
            target=channels,
        )
    elapsed = time.perf_counter() - t0

    pred = pred.sort_values("timestamp")
    if "target_name" not in pred.columns:          # 单通道时 Chronos 不产出该列
        pred = pred.assign(target_name=channels[0])

    out: Dict[str, Dict[float, np.ndarray]] = {}
    horizon_index: Optional[pd.DatetimeIndex] = None
    for ch in channels:
        sub = pred[pred["target_name"] == ch].sort_values("timestamp")
        if sub.empty:
            continue
        if horizon_index is None:
            horizon_index = pd.DatetimeIndex(sub["timestamp"].values)
        per_q: Dict[float, np.ndarray] = {}
        for q in qs:
            col = next((c for c in (f"{q}", f"{q:.1f}", f"{q:g}") if c in sub.columns), None)
            if col is not None:
                per_q[q] = sub[col].to_numpy(dtype=float)
        if 0.5 not in per_q and "predictions" in sub.columns:
            per_q[0.5] = sub["predictions"].to_numpy(dtype=float)
        out[ch] = per_q

    if horizon_index is None:
        raise RuntimeError("模型未返回任何预测结果")
    return out, horizon_index, elapsed
