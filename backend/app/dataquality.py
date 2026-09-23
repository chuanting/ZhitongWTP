"""数据质量检查：识别「整周期逐字复制」造成的伪造尾段。

现实中的运营商导出经常把序列补齐到某个目标日期，做法是把前一个周期原样复制过去。
这种数据用来做回测毫无意义——模型在上下文里已经逐字见过"未来"，
指标会好得离谱，却完全不反映真实预测能力。

判定标准刻意保守：要求**所有通道同时**与整数个季节周期前逐位精确相等。
真实流量在多个指标上同时精确到小数位重合的概率可以忽略。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

# 只有连续复制段长于这个长度才报告，避免偶发的数值巧合触发
MIN_RUN = 12


def _duplicate_mask(df: pd.DataFrame, period: int) -> np.ndarray:
    """逐时刻判断：是否所有通道都与 period 个点之前完全相同。"""
    n = len(df)
    if n <= period:
        return np.zeros(n, dtype=bool)
    dup = np.ones(n, dtype=bool)
    dup[:period] = False
    any_channel = False
    for col in df.columns:
        v = pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float)
        if not np.isfinite(v).any():
            continue
        any_channel = True
        same = np.zeros(n, dtype=bool)
        # NaN == NaN 为 False，这里把「两侧都缺失」也视作相同，避免缺口打断判定
        both_nan = ~np.isfinite(v[period:]) & ~np.isfinite(v[:-period])
        same[period:] = (v[period:] == v[:-period]) | both_nan
        dup &= same
    return dup if any_channel else np.zeros(n, dtype=bool)


def detect_replicated_tail(
    df: pd.DataFrame, season_period: int
) -> Optional[Dict[str, Any]]:
    """检测序列末尾是否为前一周期的复制。

    小时级数据同时检查「周」与「日」两种周期，周优先——
    整周复制更常见，且日周期更容易出现真实的巧合。
    """
    if len(df) < 2 * season_period:
        return None

    candidates = []
    if season_period == 24:
        candidates = [(24 * 7, "周"), (24, "日")]
    else:
        candidates = [(season_period, "季节周期")]

    for period, label in candidates:
        dup = _duplicate_mask(df, period)
        if not dup.any():
            continue
        i = len(dup) - 1
        while i >= 0 and dup[i]:
            i -= 1
        run = len(dup) - 1 - i
        if run >= MIN_RUN:
            return {
                "period": period,
                "period_label": label,
                "points": int(run),
                "ratio": round(run / len(df), 4),
                "clean_end": df.index[i].isoformat(),
                "replicated_start": df.index[i + 1].isoformat(),
                "message": (
                    f"数据末尾 {run} 个时间点与前一{label}逐位完全相同，"
                    f"应为补齐数据而非真实观测。落在该区间内的回测结果不可信，"
                    f"建议把预测起点放在 {df.index[i]:%Y-%m-%d %H:%M} 之前。"
                ),
            }
    return None


def summarize(df: pd.DataFrame, season_period: int) -> List[Dict[str, Any]]:
    """汇总数据质量问题，供接口返回给界面提示。"""
    issues: List[Dict[str, Any]] = []
    tail = detect_replicated_tail(df, season_period)
    if tail:
        issues.append({"kind": "replicated_tail", "severity": "warning", **tail})

    gaps = int(df.isna().all(axis=1).sum())
    if gaps:
        issues.append({
            "kind": "gaps", "severity": "info", "points": gaps,
            "message": f"有 {gaps} 个时间点在所有指标上均为空值（已按等间隔网格补位）。",
        })
    return issues
