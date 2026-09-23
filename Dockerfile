# ── 阶段 1：构建前端 ─────────────────────────────────────────────────────────
FROM node:22-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ── 阶段 2：运行时（CUDA 12.4 + cuDNN，匹配 PyTorch cu124 轮子）──────────────
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/hf

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3-pip curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/local/bin/python

WORKDIR /app

# torch 单独装，走 CUDA 12.4 官方索引，避免默认源拉到 CPU 版
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cu124

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY --from=frontend /build/dist ./frontend/dist

# 非 root 运行；HF 缓存与上传目录需要可写
RUN useradd -m -u 10001 netai \
    && mkdir -p /models/hf backend/data/uploads \
    && chown -R netai:netai /app /models
USER netai

ENV NETAI_HOST=0.0.0.0 \
    NETAI_PORT=8010 \
    NETAI_DEVICE=auto \
    NETAI_TRUST_PROXY=1

EXPOSE 8010
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8010/api/health || exit 1

WORKDIR /app/backend
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
