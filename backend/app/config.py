"""运行期配置。所有项均可用环境变量覆盖，便于从基座模型切换到微调权重。"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent.parent      # …/backend
PROJECT_DIR = BASE_DIR.parent                          # …/netai-console
DATA_DIR = BASE_DIR / "data"
DEMO_DIR = DATA_DIR / "demo"
UPLOAD_DIR = DATA_DIR / "uploads"

# ── 模型 ────────────────────────────────────────────────────────────────────
BASE_MODEL_ID = "amazon/chronos-2"
MODEL_LABEL = os.getenv("NETAI_MODEL_LABEL", "NetAILLM")

_RAW_MODEL_PATH = os.getenv("NETAI_MODEL_PATH", "").strip() or BASE_MODEL_ID


def _looks_like_local_path(raw: str) -> bool:
    """区分「本地目录」与「HF repo id」。

    HF repo id 形如 `amazon/chronos-2`，也含斜杠，因此不能只看分隔符：
    只有显式的相对/绝对路径前缀，或者段数超过 2，才当成本地路径。
    """
    if raw.startswith(("./", "../", "~", "/", ".\\", "..\\")) or os.path.isabs(raw):
        return True
    return raw.count("/") > 1 or "\\" in raw


def _resolve_model_path(raw: str) -> tuple[str, bool, Optional[str]]:
    """把 NETAI_MODEL_PATH 解析成 (最终取值, 是否本地目录, 错误信息)。

    相对路径依次按「进程工作目录 → 项目根目录 → backend 目录」尝试，
    这样无论从哪个目录启动 run.sh 都能命中，不会退化成非法的 repo id。
    """
    expanded = os.path.expanduser(raw)
    bases = [Path.cwd(), PROJECT_DIR, BASE_DIR]

    if os.path.isabs(expanded):
        p = Path(expanded)
        if p.is_dir():
            return str(p.resolve()), True, None
    else:
        for base in bases:
            p = (base / expanded).resolve()
            if p.is_dir():
                return str(p), True, None

    if _looks_like_local_path(raw):
        tried = "\n  ".join(
            str(Path(expanded) if os.path.isabs(expanded) else (b / expanded).resolve())
            for b in ([Path("/")] if os.path.isabs(expanded) else bases)
        )
        return raw, True, (
            f"NETAI_MODEL_PATH 指向的目录不存在：{raw}\n"
            f"已尝试以下位置：\n  {tried}\n"
            f"请改用绝对路径，例如 NETAI_MODEL_PATH=/abs/path/to/Zhitong_SDU_WT_LLM"
        )

    # 不像本地路径 → 当作 Hugging Face repo id 交给 from_pretrained 处理
    return raw, False, None


MODEL_PATH, MODEL_IS_LOCAL, MODEL_PATH_ERROR = _resolve_model_path(_RAW_MODEL_PATH)
MODEL_PATH_RAW = _RAW_MODEL_PATH
IS_FINETUNED = _RAW_MODEL_PATH != BASE_MODEL_ID

# Chronos-2 在 M 系列 Mac 上 CPU 推理已足够快（24 步 × 8 通道 < 1s），
# 且 MPS 上部分算子回落会更慢，故默认 cpu；需要时用 NETAI_DEVICE 覆盖。
DEVICE = os.getenv("NETAI_DEVICE", "cpu")

# ── 预测窗口 ────────────────────────────────────────────────────────────────
DEFAULT_CONTEXT_LENGTH = 24 * 14        # 14 天，与微调时的 context_length 一致
DEFAULT_PREDICTION_LENGTH = 24          # 1 天
MAX_CONTEXT_LENGTH = 24 * 60
MAX_PREDICTION_LENGTH = 24 * 14
DEFAULT_QUANTILES = [0.1, 0.5, 0.9]

# ── 上传 ────────────────────────────────────────────────────────────────────
MAX_UPLOAD_BYTES = 32 * 1024 * 1024
MAX_UPLOAD_ROWS = 200_000
MAX_CHANNELS = 8

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
