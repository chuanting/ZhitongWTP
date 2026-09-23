#!/usr/bin/env bash
# ── 在阿里云 ECS 上一键安装 frps + nginx（+ 可选 HTTPS 证书）────────────────
#
# 用法（在 ECS 上以 root 或 sudo 执行）：
#   有域名：  DOMAIN=netai.example.com EMAIL=you@example.com ./setup-frps.sh
#   无域名：  ./setup-frps.sh            # 走 http://<公网IP>:8080，仅供内部测试
#
# 脚本可重复执行：已装的组件会跳过，配置会覆盖为最新。
set -euo pipefail

FRP_VERSION="${FRP_VERSION:-0.61.1}"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
TUNNEL_PORT="${TUNNEL_PORT:-8011}"      # frp 映射到本机回环的端口
FRP_BIND_PORT="${FRP_BIND_PORT:-7000}"  # frpc 连过来的端口
HTTP_PORT="${HTTP_PORT:-8080}"          # 无域名模式下的对外 HTTP 端口
TOKEN_FILE=/etc/frp/.token

log()  { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 root 或 sudo 执行"

# ── 0. 环境探测 ─────────────────────────────────────────────────────────────
case "$(uname -m)" in
  x86_64)  ARCH=amd64 ;;
  aarch64) ARCH=arm64 ;;
  *)       die "不支持的架构：$(uname -m)" ;;
esac

if   command -v apt-get >/dev/null; then PKG=apt
elif command -v dnf     >/dev/null; then PKG=dnf
elif command -v yum     >/dev/null; then PKG=yum
else die "未识别的包管理器（支持 Ubuntu/Debian/Alibaba Cloud Linux/CentOS）"; fi

PUBLIC_IP="$(curl -fsS --max-time 5 https://100.100.100.200/latest/meta-data/eipv4 2>/dev/null \
          || curl -fsS --max-time 5 ifconfig.me 2>/dev/null || echo '')"
log "架构 $ARCH | 包管理器 $PKG | 公网 IP ${PUBLIC_IP:-未探测到}"

# ── 1. frps ────────────────────────────────────────────────────────────────
if ! command -v frps >/dev/null || [[ "$(frps --version 2>/dev/null)" != "$FRP_VERSION" ]]; then
  log "安装 frp $FRP_VERSION ($ARCH)"
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  TARBALL="frp_${FRP_VERSION}_linux_${ARCH}.tar.gz"
  curl -fsSL -o "$TMP/$TARBALL" \
    "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${TARBALL}" \
    || die "下载 frp 失败。ECS 到 GitHub 可能不通，可先在本地下好再 scp 上来，然后 install 到 /usr/local/bin/"
  tar -xzf "$TMP/$TARBALL" -C "$TMP"
  install -m 0755 "$TMP/frp_${FRP_VERSION}_linux_${ARCH}/frps" /usr/local/bin/frps
else
  log "frps 已是 $FRP_VERSION，跳过"
fi

id frp &>/dev/null || useradd -r -s /usr/sbin/nologin frp
mkdir -p /etc/frp /var/log/frp
chown frp:frp /var/log/frp

# token 只生成一次，重复执行不会让已配好的客户端失效
if [[ -f $TOKEN_FILE ]]; then
  TOKEN="$(cat $TOKEN_FILE)"
  log "复用已有 frp token"
else
  TOKEN="$(openssl rand -hex 24)"
  printf '%s' "$TOKEN" > $TOKEN_FILE
  chmod 600 $TOKEN_FILE
  log "已生成新的 frp token"
fi

cat > /etc/frp/frps.toml <<EOF
bindPort = ${FRP_BIND_PORT}

# 隧道映射出的端口只绑回环，公网入口统一走 nginx
proxyBindAddr = "127.0.0.1"

auth.method = "token"
auth.token = "${TOKEN}"

allowPorts = [{ start = ${TUNNEL_PORT}, end = ${TUNNEL_PORT} }]

log.to = "/var/log/frp/frps.log"
log.level = "info"
log.maxDays = 7
EOF
chmod 640 /etc/frp/frps.toml; chown root:frp /etc/frp/frps.toml

cat > /etc/systemd/system/frps.service <<'EOF'
[Unit]
Description=frp server
After=network.target

[Service]
Type=simple
User=frp
Restart=always
RestartSec=5
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/log/frp

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now frps
systemctl restart frps
log "frps 已启动（监听 ${FRP_BIND_PORT}）"

# ── 2. nginx ───────────────────────────────────────────────────────────────
if ! command -v nginx >/dev/null; then
  log "安装 nginx"
  if [[ $PKG == apt ]]; then apt-get update -qq && apt-get install -y -qq nginx
  else $PKG install -y -q nginx; fi
fi

CONF_DIR=/etc/nginx/conf.d
mkdir -p "$CONF_DIR"

write_http_conf() {   # 无域名/未签证书时的临时配置
  cat > "$CONF_DIR/netai.conf" <<EOF
limit_req_zone \$binary_remote_addr zone=netai_req:10m rate=4r/s;
limit_conn_zone \$binary_remote_addr zone=netai_conn:10m;

server {
    listen ${1};
    listen [::]:${1};
    server_name ${DOMAIN:-_};

    client_max_body_size 40m;
    client_body_timeout  120s;
    limit_conn netai_conn 12;

    gzip on;
    gzip_types text/css application/javascript application/json text/csv;
    gzip_min_length 1024;

    access_log /var/log/nginx/netai.access.log;
    error_log  /var/log/nginx/netai.error.log warn;

    location /.well-known/acme-challenge/ { root /var/www/html; }

    location / {
        limit_req zone=netai_req burst=20 nodelay;
        proxy_pass http://127.0.0.1:${TUNNEL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection        "";
        proxy_connect_timeout 10s;
        proxy_send_timeout    180s;
        proxy_read_timeout    180s;
        proxy_buffering       off;
    }
}
EOF
}

mkdir -p /var/www/html
if [[ -n $DOMAIN ]]; then
  write_http_conf 80
else
  write_http_conf "$HTTP_PORT"
fi
nginx -t && systemctl enable --now nginx && systemctl reload nginx
log "nginx 已配置"

# ── 3. HTTPS 证书（仅在给了域名时）──────────────────────────────────────────
if [[ -n $DOMAIN ]]; then
  if ! command -v certbot >/dev/null; then
    log "安装 certbot"
    if [[ $PKG == apt ]]; then apt-get install -y -qq certbot python3-certbot-nginx
    else $PKG install -y -q certbot python3-certbot-nginx; fi
  fi
  log "为 $DOMAIN 申请证书（需要该域名已解析到 ${PUBLIC_IP:-本机公网 IP} 且 80 端口可达）"
  CERTBOT_ARGS=(--nginx -d "$DOMAIN" --agree-tos --non-interactive --redirect)
  if [[ -n $EMAIL ]]; then CERTBOT_ARGS+=(-m "$EMAIL"); else CERTBOT_ARGS+=(--register-unsafely-without-email); fi
  if certbot "${CERTBOT_ARGS[@]}"; then
    log "证书签发成功，已自动配置 HTTPS 跳转"
    systemctl reload nginx
  else
    warn "证书签发失败。常见原因：域名没解析到本机、安全组没放行 80、或该域名指向了境内未备案的 IP"
    warn "应用此时仍可通过 http://${DOMAIN} 访问，修好后重跑：certbot --nginx -d $DOMAIN"
  fi
fi

# ── 4. 输出客户端配置 ───────────────────────────────────────────────────────
if [[ -n $DOMAIN ]]; then
  URL="https://${DOMAIN}"; COOKIE_SECURE=1
else
  URL="http://${PUBLIC_IP:-<公网IP>}:${HTTP_PORT}"; COOKIE_SECURE=0
fi

cat <<EOF

────────────────────────────────────────────────────────────────────────
✓ ECS 侧配置完成

访问地址：${URL}

下一步：在你本地的 GPU 服务器上写 /etc/frp/frpc.toml，内容如下
（token 已填好，直接复制）：

serverAddr = "${PUBLIC_IP:-<你的ECS公网IP>}"
serverPort = ${FRP_BIND_PORT}

auth.method = "token"
auth.token = "${TOKEN}"

loginFailExit = false
transport.tls.enable = true

log.to = "/var/log/frp/frpc.log"
log.level = "info"
log.maxDays = 7

[[proxies]]
name = "netai-console"
type = "tcp"
localIP = "127.0.0.1"
localPort = 8010
remotePort = ${TUNNEL_PORT}
transport.useEncryption = true
transport.useCompression = true
healthCheck.type = "http"
healthCheck.path = "/api/health"
healthCheck.intervalSeconds = 20
healthCheck.timeoutSeconds = 5
healthCheck.maxFailed = 3

然后在 GPU 服务器上：
  sudo cp deploy/systemd/frpc.service /etc/systemd/system/
  sudo systemctl enable --now frpc
  sudo journalctl -u frpc -f     # 看到 start proxy success 即为连通

别忘了应用侧 .env 要设：
  NETAI_TRUST_PROXY=1
  NETAI_COOKIE_SECURE=${COOKIE_SECURE}

安全组请只放行：22、${FRP_BIND_PORT}$([[ -n $DOMAIN ]] && echo "、80、443" || echo "、${HTTP_PORT}")
────────────────────────────────────────────────────────────────────────
EOF
