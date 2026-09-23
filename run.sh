#!/usr/bin/env bash
# NetAILLM 无线流量预测平台 —— 一键启动
#
#   ./run.sh              以基座 amazon/chronos-2 启动
#   NETAI_MODEL_PATH=/path/to/Zhitong_SDU_WT_LLM ./run.sh    使用微调权重
#   ./run.sh dev          前后端分离的开发模式（Vite 热更新）
set -euo pipefail
cd "$(dirname "$0")"

PORT="${NETAI_PORT:-8010}"
PY="${PYTHON:-python3}"

# 本地权重目录要在 cd backend 之前转成绝对路径，否则相对路径会跟着工作目录跑偏，
# 最终被 Hugging Face 当成非法 repo id。
if [[ -n "${NETAI_MODEL_PATH:-}" ]]; then
  EXPANDED="${NETAI_MODEL_PATH/#\~/$HOME}"
  if [[ -d "$EXPANDED" ]]; then
    NETAI_MODEL_PATH="$(cd "$EXPANDED" && pwd)"
    export NETAI_MODEL_PATH
  elif [[ "$EXPANDED" == */* && "$EXPANDED" != */*/* ]]; then
    :   # 形如 org/model，按 Hugging Face repo id 处理
  else
    echo "✗ NETAI_MODEL_PATH 指向的目录不存在：$NETAI_MODEL_PATH" >&2
    echo "  当前目录：$(pwd)" >&2
    exit 1
  fi
fi

if [[ "${1:-}" == "dev" ]]; then
  echo "▸ 开发模式：后端 :$PORT，前端 :5180"
  (cd backend && $PY -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" --reload) &
  BACKEND=$!
  trap 'kill $BACKEND 2>/dev/null || true' EXIT
  cd frontend && npm run dev
  exit 0
fi

if [[ ! -d frontend/dist ]]; then
  echo "▸ 构建前端…"
  (cd frontend && npm install --silent && npm run build)
fi

echo "▸ 模型权重：${NETAI_MODEL_PATH:-amazon/chronos-2 (基座)}"
echo "▸ 服务地址：http://127.0.0.1:$PORT"
cd backend && exec $PY -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT"
