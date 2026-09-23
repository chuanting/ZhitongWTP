# 部署到公网

目标形态：**GPU 服务器跑应用（Docker）→ frp 隧道到公网 VPS → nginx 终结 HTTPS → 别人用口令访问**。

```
访问者 ──HTTPS──▶ VPS:443 (nginx)
                     │ proxy_pass 127.0.0.1:8011
                     ▼
                 frps :7000 ◀──加密隧道── frpc ──▶ 127.0.0.1:8010
                  (公网 VPS)                       (GPU 服务器，Docker 容器)
```

为什么不把 GPU 服务器直接开到公网：家宽/校园网通常没有公网 IP，即便有，
把一台带 GPU 和数据的机器直接暴露在 443 上风险太大。隧道方式下 GPU 服务器
**只出不进**，公网只看得到 VPS。

---

## 一、GPU 服务器：跑起来

### 1. 前置

```bash
docker --version                      # ≥ 24
nvidia-smi                            # 确认驱动正常
# 装 nvidia-container-toolkit（让容器能用 GPU）
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker
# 验证
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

### 2. 拉代码、放权重、配置

```bash
git clone git@github.com:chuanting/ZhitongWTP.git && cd ZhitongWTP
# 微调权重不在仓库里（456 MB 超 GitHub 单文件上限），单独传到服务器
scp -r Zhitong_SDU_WT_LLM/ 服务器:/data/

cp .env.example .env
# 生成口令和密钥
echo "NETAI_ACCESS_PASSWORD=$(openssl rand -base64 12)" >> .env
echo "NETAI_SECRET_KEY=$(openssl rand -hex 32)"        >> .env
vim .env          # 把 WEIGHTS_DIR 改成 /data/Zhitong_SDU_WT_LLM
```

### 3. 启动

```bash
docker compose up -d --build
docker compose logs -f              # 首次会下载基座模型，等 "Application startup complete"
curl -s localhost:8010/api/health | python3 -m json.tool
```

健康检查里确认三件事：`model.device` 是 `cuda`、`model.loaded` 是 `true`、`auth_required` 是 `true`。

> 若 `device` 显示 `cpu`，看 `device_note` 字段的原因——通常是 nvidia-container-toolkit
> 没配好，或 compose 的 GPU 预留没生效（`docker compose config` 看一下 devices 段）。

---

## 二、公网 VPS：装 frps + nginx

选一台**境内**小规格 VPS（1核1G 足够，隧道只转发流量不做计算）。境内节点延迟远低于
Cloudflare 的境外入口。

### 1. frps

```bash
VER=0.61.1
wget https://github.com/fatedier/frp/releases/download/v${VER}/frp_${VER}_linux_amd64.tar.gz
tar xf frp_${VER}_linux_amd64.tar.gz && sudo install frp_${VER}_linux_amd64/frps /usr/local/bin/
sudo useradd -r -s /usr/sbin/nologin frp; sudo mkdir -p /etc/frp /var/log/frp
sudo chown frp:frp /var/log/frp

sudo cp deploy/frp/frps.toml /etc/frp/
sudo vim /etc/frp/frps.toml        # 改 auth.token（openssl rand -hex 24）和面板密码
sudo cp deploy/systemd/frps.service /etc/systemd/system/
sudo systemctl enable --now frps && sudo systemctl status frps
```

安全组/防火墙只开 **22、80、443、7000**。7000 是 frp 控制端口；
隧道映射出来的 8011 因为 `proxyBindAddr = "127.0.0.1"` 只在回环上，不对公网开放。

### 2. nginx + 证书

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx/netai.conf /etc/nginx/conf.d/
sudo vim /etc/nginx/conf.d/netai.conf     # 把 netai.example.com 全部换成你的域名
sudo certbot --nginx -d netai.你的域名
sudo nginx -t && sudo systemctl reload nginx
```

> **境内 VPS 必须先完成 ICP 备案**，否则 80/443 会被运营商阻断。备案期间可以先用
> 境外 VPS，或走下面的 Cloudflare Tunnel 方案。

---

## 三、GPU 服务器：装 frpc

```bash
sudo install frp_${VER}_linux_amd64/frpc /usr/local/bin/
sudo useradd -r -s /usr/sbin/nologin frp; sudo mkdir -p /etc/frp /var/log/frp
sudo chown frp:frp /var/log/frp

sudo cp deploy/frp/frpc.toml /etc/frp/
sudo vim /etc/frp/frpc.toml        # 填 VPS IP 和与 frps 完全一致的 token
sudo cp deploy/systemd/frpc.service /etc/systemd/system/
sudo systemctl enable --now frpc && sudo journalctl -u frpc -f
```

看到 `start proxy success` 就通了。浏览器打开 `https://netai.你的域名`，
应该看到登录页，输入 `.env` 里的口令即可进入。

---

## 备选：Cloudflare Tunnel（不用 VPS、不用备案）

适合还没备案、或不想维护 VPS 的情况。代价是国内访问走境外节点，速度不稳定。

```bash
# GPU 服务器上
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cf.deb
sudo dpkg -i cf.deb
cloudflared tunnel login
cloudflared tunnel create netai
cloudflared tunnel route dns netai netai.你的域名
cp deploy/cloudflared/config.yml ~/.cloudflared/config.yml
vim ~/.cloudflared/config.yml      # 填 TUNNEL_ID 和域名
sudo cloudflared service install && sudo systemctl enable --now cloudflared
```

域名需要托管在 Cloudflare。HTTPS 自动有，无需 certbot。
想再加一层身份认证可以开 Cloudflare Access（免费额度 50 用户），这时应用里的口令可以关掉。

---

## 运维

```bash
docker compose logs -f --tail=100        # 应用日志
docker compose restart                   # 重启
docker compose up -d --build             # 更新代码后重新部署
docker stats netai-console               # 资源占用
nvidia-smi                               # 显存占用
curl -s localhost:8010/api/health | python3 -m json.tool   # 含上传目录用量
```

**改口令**：改 `.env` 里的 `NETAI_ACCESS_PASSWORD` 后 `docker compose up -d`。
若没设 `NETAI_SECRET_KEY`，改口令会让所有已登录会话立即失效（密钥由口令派生）。

**上传数据清理**：默认保留 24 小时、目录上限 512 MB，超出按最旧优先淘汰，
启动时清一次、之后每 30 分钟清一次。改 `NETAI_UPLOAD_TTL_HOURS` / `NETAI_UPLOAD_DIR_MAX_MB`。

---

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `NETAI_ACCESS_PASSWORD` | 空 | 共享访问口令。**留空 = 完全公开**，公网部署必填 |
| `NETAI_SECRET_KEY` | 由口令派生 | 会话签名密钥。多副本部署必须显式设置 |
| `NETAI_SESSION_TTL` | `604800` | 登录有效期（秒），默认 7 天 |
| `NETAI_COOKIE_SECURE` | `0` | HTTPS 部署设 `1`。设 `1` 后纯 HTTP 访问将无法登录 |
| `NETAI_TRUST_PROXY` | `0` | 前面有可信反代时设 `1`，才按 `X-Forwarded-For` 判定来源 IP |
| `NETAI_HOST` / `NETAI_PORT` | `127.0.0.1` / `8010` | 监听地址。容器内为 `0.0.0.0` |
| `NETAI_DEVICE` | `cpu` | `auto` / `cuda` / `cpu` / `mps`。`auto` 无卡时回落 CPU |
| `NETAI_MODEL_PATH` | `amazon/chronos-2` | 微调权重目录（绝对路径）或 HF repo id |
| `NETAI_MAX_QUEUE` | `8` | 等待推理的请求上限，超出返回 503 |
| `NETAI_QUEUE_TIMEOUT` | `120` | 排队超时秒数 |
| `NETAI_RATE_FORECAST` | `30` | 每 IP 每分钟预测次数 |
| `NETAI_RATE_UPLOAD` | `20` | 每 IP 每小时上传次数 |
| `NETAI_RATE_LOGIN` | `10` | 每 IP 每 5 分钟登录尝试次数 |
| `NETAI_MAX_UPLOAD_MB` | `32` | 单文件上限。改大时 nginx 的 `client_max_body_size` 要同步调 |
| `NETAI_UPLOAD_TTL_HOURS` | `24` | 上传数据保留时长，`0` = 不按时间清理 |
| `NETAI_UPLOAD_DIR_MAX_MB` | `512` | 上传目录总容量上限 |

---

## 公网前的检查清单

- [ ] `.env` 里 `NETAI_ACCESS_PASSWORD` 已设成强口令，且 **`.env` 没被提交**（已在 `.gitignore`）
- [ ] `NETAI_SECRET_KEY` 已显式设置
- [ ] `NETAI_COOKIE_SECURE=1`（走 HTTPS）
- [ ] `/api/health` 显示 `auth_required: true`、`device: cuda`
- [ ] 未登录时 `curl https://域名/api/datasets` 返回 401
- [ ] VPS 防火墙只开 22 / 80 / 443 / 7000
- [ ] frp 的 `auth.token` 不是示例值
- [ ] 境内域名已完成 ICP 备案
- [ ] nginx `client_max_body_size` ≥ 应用的上传上限
- [ ] 确认参与测试的人知道：上传数据会落在服务器磁盘，24 小时后自动删除
