"""API 请求 / 响应模型。"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

from . import config


class ForecastRequest(BaseModel):
    dataset_id: str
    channels: List[str] = Field(min_length=1, max_length=config.MAX_CHANNELS)
    context_length: int = config.DEFAULT_CONTEXT_LENGTH
    prediction_length: int = config.DEFAULT_PREDICTION_LENGTH
    # 上下文结束时刻（含）。留空 = 自动退到「末尾 − 预测步长」，保证有真实值可对比。
    anchor: Optional[str] = None
    quantiles: List[float] = Field(default_factory=lambda: list(config.DEFAULT_QUANTILES))
    baseline: bool = True

    @field_validator("context_length")
    @classmethod
    def _ctx(cls, v: int) -> int:
        if not 24 <= v <= config.MAX_CONTEXT_LENGTH:
            raise ValueError(f"上下文长度需在 24 ~ {config.MAX_CONTEXT_LENGTH} 之间")
        return v

    @field_validator("prediction_length")
    @classmethod
    def _horizon(cls, v: int) -> int:
        if not 1 <= v <= config.MAX_PREDICTION_LENGTH:
            raise ValueError(f"预测步长需在 1 ~ {config.MAX_PREDICTION_LENGTH} 之间")
        return v

    @field_validator("quantiles")
    @classmethod
    def _quantiles(cls, v: List[float]) -> List[float]:
        vals = sorted({round(float(q), 4) for q in v})
        if not vals or any(not 0.0 < q < 1.0 for q in vals):
            raise ValueError("分位数需落在 (0, 1) 区间内")
        if 0.5 not in vals:
            vals = sorted(vals + [0.5])
        if len(vals) > 9:
            raise ValueError("分位数不超过 9 个")
        return vals


class UploadResponse(BaseModel):
    dataset: Dict[str, Any]
    notes: List[str]
