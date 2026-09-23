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

# 推理设备。auto = 有 CUDA 用 CUDA，否则回落 CPU；也可显式写 cpu / cuda / cuda:0 / mps。
# Chronos-2 在 M 系列 Mac 上 CPU 推理已足够快（24 步 × 8 通道 < 1s），
# 且 MPS 上部分算子回落会更慢，故本机默认 cpu；GPU 服务器上设 NETAI_DEVICE=auto 即可。
DEVICE_SETTING = os.getenv("NETAI_DEVICE", "cpu")


def resolve_device(setting: str) -> str:
    """把 auto 解析成实际设备；显式指定 cuda 但不可用时回落 CPU 并记录原因。"""
    global DEVICE_NOTE
    want = (setting or "cpu").strip().lower()
    if want not in ("auto", "cuda") and not want.startswith("cuda:"):
        return want
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda" if want == "auto" else want
        DEVICE_NOTE = "未检测到可用的 CUDA 设备，已回落到 CPU"
    except Exception as exc:                      # torch 未装或导入失败
        DEVICE_NOTE = f"CUDA 不可用（{type(exc).__name__}），已回落到 CPU"
    return "cpu"


DEVICE_NOTE: Optional[str] = None
DEVICE = resolve_device(DEVICE_SETTING)


# ── 网络与访问控制 ──────────────────────────────────────────────────────────
HOST = os.getenv("NETAI_HOST", "127.0.0.1")
PORT = int(os.getenv("NETAI_PORT", "8010"))

# 设置后开启共享口令鉴权；留空 = 完全公开（只适合本机或内网）
ACCESS_PASSWORD = os.getenv("NETAI_ACCESS_PASSWORD", "").strip()
SESSION_TTL = int(os.getenv("NETAI_SESSION_TTL", str(7 * 24 * 3600)))
# 部署在 HTTPS 反代之后时置 1，Cookie 只走加密连接
COOKIE_SECURE = os.getenv("NETAI_COOKIE_SECURE", "0").strip() in ("1", "true", "yes")
# 置 1 表示前面有可信反代，才允许用 X-Forwarded-For 判定客户端 IP
TRUST_PROXY = os.getenv("NETAI_TRUST_PROXY", "0").strip() in ("1", "true", "yes")
# 开发模式下前端独立端口的跨域来源，生产同源部署时留空
DEV_ORIGINS = [o for o in os.getenv(
    "NETAI_DEV_ORIGINS", "http://localhost:5180,http://127.0.0.1:5180").split(",") if o.strip()]

# ── 限流（每个来源 IP）──────────────────────────────────────────────────────
RATE_LOGIN = int(os.getenv("NETAI_RATE_LOGIN", "10"))        # 每 5 分钟登录尝试
RATE_FORECAST = int(os.getenv("NETAI_RATE_FORECAST", "30"))  # 每分钟预测请求
RATE_UPLOAD = int(os.getenv("NETAI_RATE_UPLOAD", "20"))      # 每小时上传次数

# ── 推理排队 ────────────────────────────────────────────────────────────────
MAX_QUEUE = int(os.getenv("NETAI_MAX_QUEUE", "8"))           # 等待中的请求上限
QUEUE_TIMEOUT = float(os.getenv("NETAI_QUEUE_TIMEOUT", "120"))  # 排队超时秒数

# ── 上传治理 ────────────────────────────────────────────────────────────────
UPLOAD_TTL_HOURS = float(os.getenv("NETAI_UPLOAD_TTL_HOURS", "24"))
UPLOAD_DIR_MAX_MB = float(os.getenv("NETAI_UPLOAD_DIR_MAX_MB", "512"))

# ── 预测窗口 ────────────────────────────────────────────────────────────────
DEFAULT_CONTEXT_LENGTH = 24 * 14        # 14 天，与微调时的 context_length 一致
DEFAULT_PREDICTION_LENGTH = 24          # 1 天
MAX_CONTEXT_LENGTH = 24 * 60
MAX_PREDICTION_LENGTH = 24 * 14
DEFAULT_QUANTILES = [0.1, 0.5, 0.9]

# ── 上传 ────────────────────────────────────────────────────────────────────
MAX_UPLOAD_BYTES = int(float(os.getenv("NETAI_MAX_UPLOAD_MB", "32")) * 1024 * 1024)
MAX_UPLOAD_ROWS = 200_000
MAX_CHANNELS = 8

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
