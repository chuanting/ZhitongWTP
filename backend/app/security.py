"""共享口令鉴权与限流。

面向「小范围公网试用」场景：一个共享口令挡住扫描器和爬虫，
登录后签发带签名的会话 Cookie；同时对登录、预测、上传分别限流。
不设用户体系——需要按人区分时应换成正式的身份认证。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional, Tuple

from . import config

COOKIE_NAME = "netai_session"


def _secret() -> bytes:
    """会话签名密钥。

    未显式配置时由口令派生——这样重启后旧 Cookie 仍然有效，
    但改口令即全员失效；多副本部署应显式设置 NETAI_SECRET_KEY。
    """
    explicit = os.getenv("NETAI_SECRET_KEY", "").strip()
    if explicit:
        return explicit.encode()
    return hashlib.sha256(f"netai::{config.ACCESS_PASSWORD}".encode()).digest()


def auth_required() -> bool:
    return bool(config.ACCESS_PASSWORD)


def check_password(candidate: str) -> bool:
    """定时安全比较，避免逐字符比较泄漏口令长度与前缀。"""
    if not auth_required():
        return True
    return hmac.compare_digest(candidate.encode(), config.ACCESS_PASSWORD.encode())


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def issue_token(ttl_seconds: Optional[int] = None) -> Tuple[str, int]:
    """签发 `<base64(过期时间)>.<base64(HMAC)>`。

    两段各自 base64 后再用 '.' 连接：base64url 字母表不含 '.'，
    分隔符不会和签名内容混淆（原始摘要里有约 12% 概率出现 '.' 字节）。
    """
    ttl = ttl_seconds if ttl_seconds is not None else config.SESSION_TTL
    payload = _b64(str(int(time.time()) + ttl).encode())
    sig = _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}", ttl


def verify_token(token: str) -> bool:
    if not token or token.count(".") != 1:
        return False
    payload, sig = token.split(".")
    try:
        expected = _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return False
        return int(_unb64(payload)) > time.time()
    except Exception:
        return False


# ── 限流：固定窗口计数，内存态，够用于单副本小规模部署 ──────────────────────
class RateLimiter:
    def __init__(self, limit: int, window_seconds: int, name: str):
        self.limit = limit
        self.window = window_seconds
        self.name = name
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> Optional[int]:
        """未超限返回 None；超限返回建议的重试等待秒数。"""
        if self.limit <= 0:
            return None
        now = time.time()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return max(1, int(self.window - (now - q[0])))
            q.append(now)
            if len(self._hits) > 4096:          # 防止 key 无限增长
                for k in [k for k, v in self._hits.items() if not v][:1024]:
                    self._hits.pop(k, None)
        return None


login_limiter = RateLimiter(config.RATE_LOGIN, 300, "login")
forecast_limiter = RateLimiter(config.RATE_FORECAST, 60, "forecast")
upload_limiter = RateLimiter(config.RATE_UPLOAD, 3600, "upload")


def client_ip(headers: Dict[str, str], fallback: str) -> str:
    """取真实客户端 IP。

    仅在 NETAI_TRUST_PROXY 打开时才相信 X-Forwarded-For——
    该头可被伪造，直接暴露的服务不能信任它，否则限流会被轻易绕过。
    """
    if config.TRUST_PROXY:
        fwd = headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
        real = headers.get("x-real-ip", "")
        if real:
            return real.strip()
    return fallback


def random_password(length: int = 10) -> str:
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))
