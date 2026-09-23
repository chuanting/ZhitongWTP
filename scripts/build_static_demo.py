#!/usr/bin/env python3
"""为 GitHub Pages 静态展示页预计算模型输出。

静态页没有后端，所有预测结果必须离线算好。本脚本：
  1. 对内置数据集做脱敏——去掉 CGI、省市区县、厂商，只保留场景与频段
  2. 对若干「数据集 × 预测起点 × 预测步长」组合跑真实推理
  3. 把结果与概览序列写成静态 JSON，供前端按需加载

用法：
    python scripts/build_static_demo.py
    NETAI_MODEL_PATH=/abs/path/to/weights python scripts/build_static_demo.py
"""
from __future__ import annotations

import json
import math
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app import catalog, dataquality, predictor, scoring  # noqa: E402

OUT = ROOT / "frontend" / "public" / "demo-data"

# 锚点按「距最后一个可信时刻回退多少小时」给出，覆盖不同月份与星期几。
# 注意基准不是数据末尾：源数据末尾 223 小时是前一周的逐字复制（见 dataquality），
# 落在那一段的回测指标虚高且无意义，必须整体排除。
ANCHOR_OFFSETS = [0, 24 * 14, 24 * 42, 24 * 84]
HORIZONS = [24, 72]
CONTEXT = 336
QUANTILES = [0.1, 0.5, 0.9]

# 脱敏后的展示名。场景与频段保留（预测形态的解释依赖它们），其余一律丢弃。
ANON = {
    "campus":      {"cell": "CELL-001", "scene": "高校",     "band": "2.6G"},
    "office":      {"cell": "CELL-002", "scene": "写字楼",   "band": "2.6G"},
    "metro":       {"cell": "CELL-003", "scene": "地铁",     "band": "2.6G"},
    "hospital":    {"cell": "CELL-004", "scene": "医院",     "band": "2.6G"},
    "residential": {"cell": "CELL-005", "scene": "低层居民区", "band": "2.6G"},
    "mall_49g":    {"cell": "CELL-006", "scene": "商业中心", "band": "4.9G"},
    "urban_700m":  {"cell": "CELL-007", "scene": "城区",     "band": "700M"},
}


def clean(x, digits: int = 4):
    if x is None:
        return None
    v = float(x)
    return None if not math.isfinite(v) else round(v, digits)


def clean_list(arr, digits: int = 4):
    return [clean(v, digits) for v in np.asarray(arr, dtype=float)]


def clean_metrics(m):
    if m is None:
        return None
    return {k: (v if k == "n" else clean(v, 5)) for k, v in m.items()}


def build_overview(df: pd.DataFrame, max_points: int = 720) -> dict:
    """全历史概览：等宽分桶取均值，仅用于展示当前窗口在整段历史中的位置。"""
    out = {}
    bucket = max(1, math.ceil(len(df) / max_points))
    groups = np.arange(len(df)) // bucket
    idx = [t.isoformat() for t in df.index[::bucket][: groups[-1] + 1]]
    for ch in df.columns:
        out[ch] = clean_list(df[ch].groupby(groups).mean().to_numpy(), 4)
    return {"timestamps": idx, "channels": out, "source_points": int(len(df))}


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "forecasts").mkdir(parents=True, exist_ok=True)

    info = predictor.model_info()
    print(f"模型：{info['weights']}（微调={info['finetuned']}，设备={info['device']}）\n")

    datasets_meta = []
    total_bytes = 0

    for key, ds in catalog.all_datasets().items():
        if ds.source != "demo" or key not in ANON:
            continue
        anon = ANON[key]
        df = catalog.load_frame(ds)

        # 截掉整周期复制的伪造尾段，概览与回测都只用可信区间
        tail = dataquality.detect_replicated_tail(df, ds.season_period)
        if tail:
            df = df[df.index <= pd.Timestamp(tail["clean_end"])]
            print(f"  {anon['cell']}：排除末尾 {tail['points']} 个复制点，"
                  f"可信区间截至 {tail['clean_end'][:16]}")

        ov = build_overview(df)
        p = OUT / f"overview_{key}.json"
        p.write_text(json.dumps(ov, ensure_ascii=False, separators=(",", ":")), "utf-8")
        total_bytes += p.stat().st_size

        scenarios = []
        for offset in ANCHOR_OFFSETS:
            for horizon in HORIZONS:
                pos = len(df) - 1 - horizon - offset
                if pos + 1 < CONTEXT:
                    continue
                context = df.iloc[pos + 1 - CONTEXT: pos + 1]
                actual = df.iloc[pos + 1: pos + 1 + horizon]
                if len(actual) < horizon:
                    continue

                preds, hidx, secs = predictor.forecast(
                    context, list(df.columns), horizon, QUANTILES)

                channels = []
                for ch in df.columns:
                    per_q = preds.get(ch)
                    if not per_q:
                        continue
                    median = per_q[0.5]
                    ctx_vals = context[ch].to_numpy(float)
                    truth = actual[ch].to_numpy(float)
                    base = predictor.seasonal_naive(ctx_vals, horizon, ds.season_period)
                    m = scoring.evaluate(
                        truth, median, context=ctx_vals, season_period=ds.season_period,
                        quantile_preds=dict(per_q), lower=per_q[0.1], upper=per_q[0.9],
                        interval_level=80)
                    bm = scoring.evaluate(truth, base, context=ctx_vals,
                                          season_period=ds.season_period)
                    channels.append({
                        "key": ch,
                        "info": catalog.channel_info(ch),
                        "context": {"timestamps": [t.isoformat() for t in context.index],
                                    "values": clean_list(ctx_vals)},
                        "horizon": {"timestamps": [t.isoformat() for t in hidx]},
                        "quantiles": {f"{q:g}": clean_list(v) for q, v in sorted(per_q.items())},
                        "median": clean_list(median),
                        "actual": clean_list(truth),
                        "baseline": clean_list(base),
                        "residuals": [clean(v) for v in scoring.step_errors(truth, median)],
                        "metrics": clean_metrics(m),
                        "baseline_metrics": clean_metrics(bm),
                    })

                sid = f"{key}_a{offset}_h{horizon}"
                anchor_iso = context.index[-1].isoformat()
                payload = {
                    "id": sid,
                    "dataset_id": key,
                    "config": {
                        "anchor": anchor_iso, "context_length": CONTEXT,
                        "prediction_length": horizon, "quantiles": QUANTILES,
                        "interval_level": 80.0, "season_period": ds.season_period,
                        "freq_label": ds.freq_label, "has_ground_truth": True,
                        "truth_points": horizon, "mode": "回测评估",
                    },
                    "channels": channels,
                }
                f = OUT / "forecasts" / f"{sid}.json"
                f.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), "utf-8")
                total_bytes += f.stat().st_size
                scenarios.append({"id": sid, "anchor": anchor_iso,
                                  "prediction_length": horizon, "offset_hours": offset})
                mm = [c["metrics"]["mase"] for c in channels if c["metrics"]["mase"] is not None]
                print(f"  {anon['cell']} {anchor_iso[:13]} h={horizon:<3} "
                      f"MASE {min(mm):.2f}~{max(mm):.2f}  ({secs:.2f}s)")

        datasets_meta.append({
            "id": key,
            "name": ds.name,
            "cell": anon["cell"],
            "scene": anon["scene"],
            "band": anon["band"],
            "blurb": ds.meta["blurb"],
            "channels": list(df.columns),
            "channel_info": [catalog.channel_info(c) for c in df.columns],
            "rows": int(len(df)),
            "start": df.index[0].isoformat(),
            "end": df.index[-1].isoformat(),
            "freq": ds.freq,
            "freq_label": ds.freq_label,
            "season_period": ds.season_period,
            "scenarios": scenarios,
        })

    manifest = {
        "generated_at": pd.Timestamp.now().isoformat(timespec="seconds"),
        "model": {
            "label": info["label"],
            "base_model": info["base_model"],
            "finetuned": info["finetuned"],
            "finetune_meta": info["finetune_meta"],
        },
        "context_length": CONTEXT,
        "horizons": HORIZONS,
        "data_note": ("源数据末尾存在整周复制的补齐段，已整体排除；"
                      "此处全部锚点均落在可信区间内。"),
        "quantiles": QUANTILES,
        "datasets": datasets_meta,
    }
    mp = OUT / "manifest.json"
    mp.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), "utf-8")
    total_bytes += mp.stat().st_size

    n_files = len(list(OUT.rglob("*.json")))
    print(f"\n生成 {n_files} 个 JSON，合计 {total_bytes / 1024 / 1024:.2f} MB → {OUT}")


if __name__ == "__main__":
    main()
