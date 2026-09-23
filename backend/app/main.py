"""NetAILLM 无线流量预测平台 —— 后端服务。"""
from __future__ import annotations

import csv
import io
import math
import threading
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import catalog, config, predictor, scoring
from .schemas import ForecastRequest

app = FastAPI(title="NetAILLM 无线流量预测平台", version="1.0.0", docs_url="/api/docs",
              openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware, allow_origins=["http://localhost:5180", "http://127.0.0.1:5180"],
    allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    threading.Thread(target=predictor.warmup, daemon=True).start()


def _clean(x: Any) -> Any:
    """JSON 不支持 NaN/Inf，统一转成 null。"""
    if x is None:
        return None
    v = float(x)
    return None if not math.isfinite(v) else round(v, 6)


def _clean_list(arr) -> List[Optional[float]]:
    return [_clean(v) for v in np.asarray(arr, dtype=float)]


def _clean_metrics(m: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if m is None:
        return None
    return {k: (v if k == "n" else _clean(v)) for k, v in m.items()}


# ── 基础信息 ────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health() -> Dict[str, Any]:
    return {"status": "ok", "model": predictor.model_info()}


@app.get("/api/model")
def model() -> Dict[str, Any]:
    return predictor.model_info()


@app.get("/api/datasets")
def list_datasets() -> Dict[str, Any]:
    items = [d.to_dict() for d in catalog.all_datasets().values()]
    items.sort(key=lambda d: (d["source"] != "demo", d["name"]))
    return {"datasets": items, "defaults": {
        "context_length": config.DEFAULT_CONTEXT_LENGTH,
        "prediction_length": config.DEFAULT_PREDICTION_LENGTH,
        "quantiles": config.DEFAULT_QUANTILES,
        "max_context_length": config.MAX_CONTEXT_LENGTH,
        "max_prediction_length": config.MAX_PREDICTION_LENGTH,
    }}


def _require(ds_id: str) -> catalog.Dataset:
    ds = catalog.get_dataset(ds_id)
    if ds is None:
        raise HTTPException(404, f"数据集不存在：{ds_id}")
    return ds


@app.get("/api/datasets/{ds_id}/series")
def series(ds_id: str, channel: str = Query(...), max_points: int = Query(1200, ge=100, le=6000)):
    """历史概览序列；超过 max_points 时按等宽分桶取均值。"""
    ds = _require(ds_id)
    df = catalog.load_frame(ds)
    if channel not in df.columns:
        raise HTTPException(400, f"数据集不含通道：{channel}")
    s = df[channel]
    downsampled = len(s) > max_points
    if downsampled:
        bucket = math.ceil(len(s) / max_points)
        grouped = s.groupby(np.arange(len(s)) // bucket)
        s = pd.Series(grouped.mean().to_numpy(),
                      index=pd.DatetimeIndex(s.index[::bucket][: grouped.ngroups]))
    return {
        "channel": channel,
        "channel_info": catalog.channel_info(channel),
        "timestamps": [t.isoformat() for t in s.index],
        "values": _clean_list(s.to_numpy()),
        "downsampled": downsampled,
        "source_points": int(len(df)),
    }


@app.post("/api/datasets/upload")
async def upload(file: UploadFile = File(...)) -> Dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith((".csv", ".txt")):
        raise HTTPException(400, "仅支持 .csv 文件")
    content = await file.read()
    try:
        ds, notes = catalog.ingest_csv(content, file.filename)
    except catalog.IngestError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"dataset": ds.to_dict(), "notes": notes}


@app.delete("/api/datasets/{ds_id}")
def delete_dataset(ds_id: str) -> Dict[str, Any]:
    ds = _require(ds_id)
    if ds.source != "upload":
        raise HTTPException(400, "内置 Demo 数据集不可删除")
    catalog.delete_upload(ds_id)
    return {"deleted": ds_id}


# ── 预测 ────────────────────────────────────────────────────────────────────
def _resolve_anchor(df: pd.DataFrame, req: ForecastRequest) -> int:
    """把 anchor 时刻解析成上下文结束的行号（含该行）。"""
    n = len(df)
    if req.anchor:
        try:
            ts = pd.Timestamp(req.anchor)
        except Exception as exc:
            raise HTTPException(400, f"无法解析预测起点：{req.anchor}") from exc
        pos = int(df.index.searchsorted(ts, side="right")) - 1
        if pos < 0:
            raise HTTPException(400, "预测起点早于数据起始时间")
    else:
        pos = n - 1 - req.prediction_length      # 默认留出一个完整的真实值窗口做回测
    pos = max(0, min(pos, n - 1))
    if pos + 1 < 24:
        raise HTTPException(400, "该预测起点之前的历史不足 24 个时间点")
    return pos


@app.post("/api/forecast")
def run_forecast(req: ForecastRequest) -> Dict[str, Any]:
    ds = _require(req.dataset_id)
    df = catalog.load_frame(ds)

    unknown = [c for c in req.channels if c not in df.columns]
    if unknown:
        raise HTTPException(400, f"数据集不含通道：{', '.join(unknown)}")

    anchor_pos = _resolve_anchor(df, req)
    ctx_start = max(0, anchor_pos + 1 - req.context_length)
    context = df.iloc[ctx_start: anchor_pos + 1]
    if len(context) < 24:
        raise HTTPException(400, "上下文长度不足 24 个时间点")

    try:
        preds, horizon_index, infer_s = predictor.forecast(
            context, req.channels, req.prediction_length, req.quantiles)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"推理失败：{type(exc).__name__}: {exc}") from exc

    actual = df.iloc[anchor_pos + 1: anchor_pos + 1 + req.prediction_length]
    q_lo, q_hi = min(req.quantiles), max(req.quantiles)
    interval_level = round((q_hi - q_lo) * 100, 1)

    channels_out: List[Dict[str, Any]] = []
    for ch in req.channels:
        per_q = preds.get(ch)
        if not per_q:
            continue
        median = per_q.get(0.5)
        ctx_vals = context[ch].to_numpy(dtype=float)

        truth = np.full(req.prediction_length, np.nan)
        if len(actual):
            truth[: len(actual)] = actual[ch].to_numpy(dtype=float)
        has_truth = bool(np.isfinite(truth).any())

        base = predictor.seasonal_naive(ctx_vals, req.prediction_length, ds.season_period) \
            if req.baseline else None

        metrics = base_metrics = None
        if has_truth:
            metrics = scoring.evaluate(
                truth, median, context=ctx_vals, season_period=ds.season_period,
                quantile_preds={q: v for q, v in per_q.items()},
                lower=per_q.get(q_lo), upper=per_q.get(q_hi), interval_level=interval_level)
            if base is not None:
                base_metrics = scoring.evaluate(
                    truth, base, context=ctx_vals, season_period=ds.season_period)

        channels_out.append({
            "key": ch,
            "info": catalog.channel_info(ch),
            "context": {"timestamps": [t.isoformat() for t in context.index],
                        "values": _clean_list(ctx_vals)},
            "horizon": {"timestamps": [t.isoformat() for t in horizon_index]},
            "quantiles": {f"{q:g}": _clean_list(v) for q, v in sorted(per_q.items())},
            "median": _clean_list(median),
            "actual": _clean_list(truth) if has_truth else None,
            "baseline": _clean_list(base) if base is not None else None,
            "residuals": [_clean(v) for v in scoring.step_errors(truth, median)] if has_truth else None,
            "metrics": _clean_metrics(metrics),
            "baseline_metrics": _clean_metrics(base_metrics),
        })

    if not channels_out:
        raise HTTPException(500, "模型未返回任何通道的预测结果")

    return {
        "dataset": ds.to_dict(),
        "model": {**predictor.model_info(), "inference_seconds": round(infer_s, 3)},
        "config": {
            "anchor": context.index[-1].isoformat(),
            "context_length": len(context),
            "prediction_length": req.prediction_length,
            "quantiles": req.quantiles,
            "interval_level": interval_level,
            "season_period": ds.season_period,
            "freq_label": ds.freq_label,
            "has_ground_truth": bool(len(actual)),
            "truth_points": int(len(actual)),
            "mode": "回测评估" if len(actual) >= req.prediction_length else (
                "部分回测" if len(actual) else "未来外推"),
        },
        "channels": channels_out,
    }


@app.post("/api/forecast/export")
def export_forecast(req: ForecastRequest) -> StreamingResponse:
    """把预测结果导出为 CSV（长表：时间 × 通道 × 预测/真实/基线/分位数）。"""
    result = run_forecast(req)
    qkeys = [f"{q:g}" for q in req.quantiles]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["timestamp", "channel", "channel_label", "unit", "forecast", "actual",
                "baseline", "abs_error"] + [f"q{k}" for k in qkeys])
    for ch in result["channels"]:
        info, ts = ch["info"], ch["horizon"]["timestamps"]
        for i, t in enumerate(ts):
            fc = ch["median"][i]
            ac = ch["actual"][i] if ch["actual"] else None
            ae = None if (fc is None or ac is None) else round(abs(fc - ac), 6)
            w.writerow([t, ch["key"], info["label"], info["unit"], fc, ac,
                        ch["baseline"][i] if ch["baseline"] else None, ae]
                       + [ch["quantiles"].get(k, [None] * len(ts))[i] for k in qkeys])
    buf.seek(0)
    name = f"netaillm_{req.dataset_id}_{result['config']['anchor'][:13].replace(':', '')}.csv"
    return StreamingResponse(
        iter(["﻿" + buf.getvalue()]), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ── 前端静态资源（构建产物存在时挂载） ──────────────────────────────────────
_DIST = config.BASE_DIR.parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str) -> FileResponse:
        candidate = _DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_DIST / "index.html")
