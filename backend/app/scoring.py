"""时间序列预测评估指标。

所有指标都在原始量纲上计算；对齐后若存在 NaN（真实值缺失），按成对删除处理。
"""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence

import numpy as np

EPS = 1e-9


def _pairwise(y: np.ndarray, f: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    m = np.isfinite(y) & np.isfinite(f)
    return y[m], f[m]


def quantile_loss(y: np.ndarray, f: np.ndarray, q: float) -> float:
    """pinball loss（未做 2× 缩放）。"""
    u = y - f
    return float(np.mean(np.maximum(q * u, (q - 1.0) * u)))


def weighted_quantile_loss(
    y: np.ndarray, preds: Dict[float, np.ndarray]
) -> Optional[float]:
    """WQL = Σ_q Σ_t 2·ρ_q(y_t − f_q,t) / (|Q| · Σ_t |y_t|)。

    分位数预测的标准归一化指标，可跨量纲比较；越小越好。

    分子分母必须落在同一组有效点上：真实值缺失时若分母仍按整段求和，
    结果会被 NaN 污染（且 NaN < EPS 为 False，判不出来）。
    """
    if not preds:
        return None
    y = np.asarray(y, dtype=float)
    mask = np.isfinite(y)
    for f in preds.values():
        mask &= np.isfinite(np.asarray(f, dtype=float))
    if not mask.any():
        return None
    denom = float(np.sum(np.abs(y[mask])))
    if not np.isfinite(denom) or denom < EPS:
        return None
    total = 0.0
    for q, f in preds.items():
        u = y[mask] - np.asarray(f, dtype=float)[mask]
        total += 2.0 * float(np.sum(np.maximum(q * u, (q - 1.0) * u)))
    value = total / (len(preds) * denom)
    return value if np.isfinite(value) else None


def seasonal_naive_scale(context: np.ndarray, period: int) -> Optional[float]:
    """MASE 的分母：上下文窗口上季节性朴素法的平均绝对误差。"""
    c = context[np.isfinite(context)]
    if c.size <= period:
        return None
    diff = np.abs(c[period:] - c[:-period])
    diff = diff[np.isfinite(diff)]
    if diff.size == 0:
        return None
    scale = float(np.mean(diff))
    return scale if scale > EPS else None


def evaluate(
    y_true: Sequence[float],
    y_pred: Sequence[float],
    *,
    context: Optional[Sequence[float]] = None,
    season_period: int = 24,
    quantile_preds: Optional[Dict[float, Sequence[float]]] = None,
    lower: Optional[Sequence[float]] = None,
    upper: Optional[Sequence[float]] = None,
    interval_level: Optional[float] = None,
) -> Optional[Dict[str, Optional[float]]]:
    """返回一组标准指标；真实值全部缺失时返回 None。"""
    y = np.asarray(y_true, dtype=float)
    f = np.asarray(y_pred, dtype=float)
    yy, ff = _pairwise(y, f)
    if yy.size == 0:
        return None

    err = ff - yy
    abs_err = np.abs(err)

    mae = float(np.mean(abs_err))
    rmse = float(np.sqrt(np.mean(err ** 2)))
    bias = float(np.mean(err))

    # MAPE 对近零真实值无意义，只在 |y| 超过序列尺度的 1% 处计算
    floor = max(EPS, 0.01 * float(np.mean(np.abs(yy))))
    mask = np.abs(yy) > floor
    mape = float(np.mean(abs_err[mask] / np.abs(yy[mask])) * 100) if mask.any() else None
    mape_coverage = float(mask.mean())

    denom = np.abs(yy) + np.abs(ff)
    smask = denom > EPS
    smape = float(np.mean(2 * abs_err[smask] / denom[smask]) * 100) if smask.any() else None

    mase = None
    if context is not None:
        scale = seasonal_naive_scale(np.asarray(context, dtype=float), season_period)
        if scale:
            mase = mae / scale

    sst = float(np.sum((yy - yy.mean()) ** 2))
    r2 = float(1.0 - np.sum(err ** 2) / sst) if sst > EPS else None

    corr = None
    if yy.size > 2 and yy.std() > EPS and ff.std() > EPS:
        corr = float(np.corrcoef(yy, ff)[0, 1])

    wql = None
    if quantile_preds:
        wql = weighted_quantile_loss(y, {q: np.asarray(v, float) for q, v in quantile_preds.items()})

    coverage = None
    if lower is not None and upper is not None:
        lo = np.asarray(lower, float)
        hi = np.asarray(upper, float)
        m = np.isfinite(y) & np.isfinite(lo) & np.isfinite(hi)
        if m.any():
            coverage = float(np.mean((y[m] >= lo[m]) & (y[m] <= hi[m])) * 100)

    return {
        "mae": mae,
        "rmse": rmse,
        "mape": mape,
        "mape_coverage": mape_coverage,
        "smape": smape,
        "mase": mase,
        "wql": wql,
        "r2": r2,
        "corr": corr,
        "bias": bias,
        "coverage": coverage,
        "interval_level": interval_level,
        "n": int(yy.size),
    }


def step_errors(y_true: Sequence[float], y_pred: Sequence[float]) -> List[Optional[float]]:
    """逐步（h=1..H）预测误差，用于误差随步长增长的可视化。"""
    y = np.asarray(y_true, float)
    f = np.asarray(y_pred, float)
    out: List[Optional[float]] = []
    for a, b in zip(y, f):
        out.append(None if not (np.isfinite(a) and np.isfinite(b)) else float(b - a))
    return out
