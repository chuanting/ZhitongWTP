"""数据集目录：内置 Demo 数据集 + 用户上传数据集的解析与登记。"""
from __future__ import annotations

import io
import json
import re
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from . import config


# ── 通道（指标）字典 ────────────────────────────────────────────────────────
# display_scale 只影响前端展示（利用率 0–1 → %），后端一律按原始量纲计算。
CHANNEL_META: Dict[str, Dict[str, Any]] = {
    "flow":        {"label": "小区总流量",   "unit": "GB", "display_scale": 1,   "group": "流量"},
    "dflow":       {"label": "下行流量",     "unit": "GB", "display_scale": 1,   "group": "流量"},
    "uflow":       {"label": "上行流量",     "unit": "GB", "display_scale": 1,   "group": "流量"},
    "single_flow": {"label": "单用户流量",   "unit": "MB", "display_scale": 1,   "group": "流量"},
    "pdcch":       {"label": "PDCCH 利用率", "unit": "%",  "display_scale": 100, "group": "资源利用率"},
    "pdsch":       {"label": "PDSCH 利用率", "unit": "%",  "display_scale": 100, "group": "资源利用率"},
    "pusch":       {"label": "PUSCH 利用率", "unit": "%",  "display_scale": 100, "group": "资源利用率"},
    "conn":        {"label": "平均有效连接数", "unit": "个", "display_scale": 1,  "group": "负荷"},
}

TIME_COL_CANDIDATES = ["timestamp", "time", "datetime", "date", "dt", "ds", "时间", "日期", "时刻"]

# 内置 Demo：济南历下区 5G 小区，小时级，取自 licheng_5g.db
DEMO_DEFS: List[Dict[str, Any]] = [
    {"key": "campus",      "name": "高校基站",     "scene": "高校",     "band": "2.6G", "vendor": "华为",
     "cgi": "460-00-2556493-11", "blurb": "学期作息驱动的日内双峰，寒假期间整体塌陷。"},
    {"key": "office",      "name": "写字楼基站",   "scene": "写字楼",   "band": "2.6G", "vendor": "华为",
     "cgi": "460-00-2586029-7",  "blurb": "工作日 / 周末对比强烈，偶发大流量尖峰。"},
    {"key": "metro",       "name": "地铁站基站",   "scene": "地铁",     "band": "2.6G", "vendor": "华为",
     "cgi": "460-00-2557239-1",  "blurb": "早晚通勤双峰规律性强，末班后归零。"},
    {"key": "hospital",    "name": "医院基站",     "scene": "医院",     "band": "2.6G", "vendor": "华为",
     "cgi": "460-00-2628052-4",  "blurb": "高话务场景，日均流量最大，白天高位平台。"},
    {"key": "residential", "name": "居民区基站",   "scene": "低层居民区", "band": "2.6G", "vendor": "华为",
     "cgi": "460-00-2585991-7",  "blurb": "夜间高峰型，与办公场景相位相反。"},
    {"key": "mall_49g",    "name": "商业中心基站", "scene": "商业中心", "band": "4.9G", "vendor": "中兴",
     "cgi": "460-00-2658717-1",  "blurb": "4.9G 高频小区，节假日尖峰显著。"},
    {"key": "urban_700m",  "name": "城区广覆盖站", "scene": "城区",     "band": "700M", "vendor": "华为",
     "cgi": "460-00-2629230-1",  "blurb": "700M 低频广覆盖，低流量长周期，历史最完整（11 个月）。"},
]


@dataclass
class Dataset:
    id: str
    name: str
    source: str                  # "demo" | "upload"
    channels: List[str]
    rows: int
    start: str
    end: str
    freq: str
    freq_label: str
    season_period: int
    missing: Dict[str, int]
    meta: Dict[str, Any]
    path: str

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["channel_info"] = [channel_info(c) for c in self.channels]
        return d


def channel_info(key: str) -> Dict[str, Any]:
    m = CHANNEL_META.get(key)
    if m:
        return {"key": key, **m}
    return {"key": key, "label": key, "unit": "", "display_scale": 1, "group": "自定义"}


# ── 频率推断 ────────────────────────────────────────────────────────────────
_FREQ_LABELS = {"h": "小时", "D": "天", "15min": "15 分钟", "30min": "30 分钟", "min": "分钟", "W": "周"}
_SEASON = {"h": 24, "D": 7, "15min": 96, "30min": 48, "min": 60, "W": 52}


def infer_freq(index: pd.DatetimeIndex) -> tuple[str, int]:
    """返回 (pandas 频率别名, 季节周期)。以中位间隔为准，对缺口鲁棒。"""
    if len(index) < 3:
        return "h", 24
    delta = pd.Series(index).diff().dt.total_seconds().dropna()
    if delta.empty:
        return "h", 24
    step = float(delta.median())
    table = [(60, "min", 60), (900, "15min", 96), (1800, "30min", 48),
             (3600, "h", 24), (86400, "D", 7), (604800, "W", 52)]
    best = min(table, key=lambda t: abs(np.log(max(step, 1) / t[0])))
    return best[1], best[2]


# ── Demo 加载 ───────────────────────────────────────────────────────────────
_demo_cache: Dict[str, Dataset] = {}


def _build_dataset(df: pd.DataFrame, *, ds_id: str, name: str, source: str,
                   meta: Dict[str, Any], path: Path) -> Dataset:
    freq, season = infer_freq(df.index)
    channels = [c for c in df.columns]
    return Dataset(
        id=ds_id, name=name, source=source, channels=channels,
        rows=int(len(df)), start=df.index[0].isoformat(), end=df.index[-1].isoformat(),
        freq=freq, freq_label=_FREQ_LABELS.get(freq, freq), season_period=season,
        missing={c: int(df[c].isna().sum()) for c in channels},
        meta=meta, path=str(path),
    )


def load_frame(ds: Dataset) -> pd.DataFrame:
    df = pd.read_csv(ds.path, parse_dates=["timestamp"], index_col="timestamp")
    return df.sort_index()


def _demo_datasets() -> Dict[str, Dataset]:
    if _demo_cache:
        return _demo_cache
    for d in DEMO_DEFS:
        path = config.DEMO_DIR / f"{d['key']}.csv"
        if not path.exists():
            continue
        df = pd.read_csv(path, parse_dates=["timestamp"], index_col="timestamp").sort_index()
        meta = {k: d[k] for k in ("scene", "band", "vendor", "cgi", "blurb")}
        meta["region"] = "山东济南 · 历下区"
        meta["network"] = "5G NR"
        _demo_cache[d["key"]] = _build_dataset(
            df, ds_id=d["key"], name=d["name"], source="demo", meta=meta, path=path)
    return _demo_cache


# ── 上传数据集 ──────────────────────────────────────────────────────────────
def _upload_index_path() -> Path:
    return config.UPLOAD_DIR / "index.json"


def _read_upload_index() -> Dict[str, Any]:
    p = _upload_index_path()
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text("utf-8"))
    except Exception:
        return {}


def _write_upload_index(idx: Dict[str, Any]) -> None:
    _upload_index_path().write_text(json.dumps(idx, ensure_ascii=False, indent=1), "utf-8")


def _upload_datasets() -> Dict[str, Dataset]:
    out: Dict[str, Dataset] = {}
    for ds_id, raw in _read_upload_index().items():
        if Path(raw["path"]).exists():
            out[ds_id] = Dataset(**raw)
    return out


def all_datasets() -> Dict[str, Dataset]:
    return {**_demo_datasets(), **_upload_datasets()}


def get_dataset(ds_id: str) -> Optional[Dataset]:
    return all_datasets().get(ds_id)


class IngestError(ValueError):
    pass


def _parse_timestamps(raw: pd.Series) -> pd.Series:
    """支持 ISO 字符串、Excel 常见格式，以及 YYYYMMDDHH 整数（源库 dt 列的格式）。"""
    s = raw.astype(str).str.strip()
    compact = s.str.fullmatch(r"\d{10}")
    if compact.fillna(False).all():
        return pd.to_datetime(s, format="%Y%m%d%H", errors="coerce")
    if s.str.fullmatch(r"\d{8}").fillna(False).all():
        return pd.to_datetime(s, format="%Y%m%d", errors="coerce")
    return pd.to_datetime(raw, errors="coerce")


def _looks_like_time(raw: pd.Series) -> bool:
    """判断某列是否真的是时间列。

    仅靠 pd.to_datetime 能否解析并不可靠——整数列会被当成 epoch 纳秒解析成 1970 年，
    因此额外要求解析结果落在合理年份区间且取值不重复。
    """
    parsed = _parse_timestamps(raw)
    if parsed.notna().mean() <= 0.9:
        return False
    valid = parsed.dropna()
    if valid.nunique() < max(8, int(0.5 * len(valid))):
        return False
    years = valid.dt.year
    return bool(years.between(1990, 2100).mean() > 0.95)


def ingest_csv(content: bytes, filename: str) -> tuple[Dataset, List[str]]:
    """解析上传的 CSV，规整到等间隔时间网格并落盘。返回 (数据集, 提示信息)。"""
    notes: List[str] = []
    if len(content) > config.MAX_UPLOAD_BYTES:
        raise IngestError(f"文件超过 {config.MAX_UPLOAD_BYTES // 1024 // 1024} MB 上限")

    text: Optional[str] = None
    for enc in ("utf-8-sig", "gb18030", "utf-16", "latin-1"):
        try:
            text = content.decode(enc)
            if enc != "utf-8-sig":
                notes.append(f"按 {enc} 编码解析")
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise IngestError("无法识别文件编码，请另存为 UTF-8 后重试")

    try:
        df = pd.read_csv(io.StringIO(text))
    except Exception as exc:
        raise IngestError(f"CSV 解析失败：{exc}") from exc
    if df.empty:
        raise IngestError("文件没有数据行")
    if len(df) > config.MAX_UPLOAD_ROWS:
        raise IngestError(f"数据行数超过 {config.MAX_UPLOAD_ROWS:,} 上限")

    df.columns = [str(c).strip() for c in df.columns]
    lower = {c.lower(): c for c in df.columns}
    time_col = next((lower[c] for c in TIME_COL_CANDIDATES if c in lower), None)
    if time_col is None:
        for c in df.columns:                       # 回退：找第一个能可靠解析成时间的列
            if _looks_like_time(df[c]):
                time_col = c
                notes.append(f"未找到标准时间列名，已采用「{c}」作为时间列")
                break
    if time_col is None:
        raise IngestError(
            "未找到时间列。请提供名为 timestamp / time / date / dt 的列（支持 "
            "'2026-04-30 12:00:00' 或 '2026043012' 格式）")

    ts = _parse_timestamps(df[time_col])
    bad = int(ts.isna().sum())
    if bad:
        notes.append(f"丢弃 {bad} 行无法解析的时间戳")
        df, ts = df[ts.notna()], ts[ts.notna()]
    if len(df) < 32:
        raise IngestError("有效数据不足 32 个时间点，无法用于预测")

    values = df.drop(columns=[time_col]).apply(pd.to_numeric, errors="coerce")
    values = values.loc[:, values.notna().mean() > 0.5]
    if values.empty:
        raise IngestError("未找到数值列。除时间列外至少需要一列数值型指标")
    if values.shape[1] > config.MAX_CHANNELS:
        keep = list(values.columns[: config.MAX_CHANNELS])
        notes.append(f"数值列超过 {config.MAX_CHANNELS} 个，仅保留前 {config.MAX_CHANNELS} 列：{', '.join(keep)}")
        values = values[keep]

    values.index = pd.DatetimeIndex(ts.values)
    values = values[~values.index.duplicated(keep="last")].sort_index()

    freq, _ = infer_freq(values.index)
    grid = pd.date_range(values.index[0], values.index[-1], freq=freq)
    gaps = len(grid) - len(values)
    values = values.reindex(grid)
    if gaps > 0:
        notes.append(f"按 {_FREQ_LABELS.get(freq, freq)}粒度补齐 {gaps} 个缺失时间点（保留为空值）")
    values.index.name = "timestamp"

    ds_id = f"up_{uuid.uuid4().hex[:10]}"
    path = config.UPLOAD_DIR / f"{ds_id}.csv"
    values.round(6).to_csv(path, float_format="%g")

    safe_name = re.sub(r"\.csv$", "", filename, flags=re.I).strip() or "上传数据集"
    ds = _build_dataset(values, ds_id=ds_id, name=safe_name[:60], source="upload",
                        meta={"filename": filename,
                              "uploaded_at": datetime.now().isoformat(timespec="seconds"),
                              "blurb": f"{len(values):,} 个时间点 · {values.shape[1]} 个指标"},
                        path=path)
    idx = _read_upload_index()
    idx[ds_id] = asdict(ds)
    _write_upload_index(idx)
    return ds, notes


def delete_upload(ds_id: str) -> bool:
    idx = _read_upload_index()
    raw = idx.pop(ds_id, None)
    if raw is None:
        return False
    Path(raw["path"]).unlink(missing_ok=True)
    _write_upload_index(idx)
    return True
