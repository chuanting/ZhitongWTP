# 用阿里云 ECS 做中转发布

GPU 留在本地，只在阿里云买一台最便宜的 ECS 当公网入口。推理在你自己的机器上跑，
ECS 只转发流量，配置低也够用。

```
访问者 ──HTTPS──▶ 阿里云 ECS:443 (nginx)
                     │ proxy_pass 127.0.0.1:8011
                     ▼
                 frps :7000 ◀──加密隧道── frpc ──▶ 127.0.0.1:8010
                 (香港地域 ECS)                    (本地 GPU 服务器，Docker)
```

---

## 一、买 ECS：三个关键选择

### 地域必须选**中国香港**

境内地域（杭州/北京/上海…）的 80、443 端口有 ICP 备案校验，域名没备案会被拦。
香港地域**免备案**，可以正常用标准端口 + Let's Encrypt 正式证书。

大陆访问香港通常 30–60 ms，比 Cloudflare 免费版的境外节点稳定得多，
对这个应用（一次预测传几十 KB JSON）完全够用。

> 如果你已经有备案好的域名，也可以选境内地域，延迟能再低一半。
> 那种情况直接看 [DEPLOY.md](DEPLOY.md)，步骤一样，只是地域不同。

### 规格选最便宜的

ECS 只做 TCP 转发，不做计算。**突发性能实例 t6（1 核 1 G）或共享型 s6（1 核 2 G）** 足够。
按量付费适合短期演示，包月适合长期挂着。具体价格控制台上看，会变。

### 带宽选**按使用流量**

这是最容易多花钱的地方。前端首屏约 280 KB（gzip 后），之后每次预测的 API
响应只有几十 KB。十几个人偶尔用，一个月流量撑死几个 GB。

- **按使用流量**：用多少算多少，闲着不花钱 —— 选这个
- **按固定带宽**：哪怕没人访问也按峰值带宽计费，对这种场景纯浪费

按流量计费时把「峰值带宽」拉到 5–10 Mbps，保证首屏加载不卡。

---

## 二、安全组：只开四个端口

ECS 创建后，在控制台 **网络与安全 → 安全组 → 配置规则 → 入方向** 添加：

| 端口 | 协议 | 授权对象 | 用途 |
|---|---|---|---|
| 22 | TCP | **你自己的 IP**（不要 0.0.0.0/0） | SSH |
| 80 | TCP | 0.0.0.0/0 | HTTP→HTTPS 跳转、证书签发验证 |
| 443 | TCP | 0.0.0.0/0 | 应用访问入口 |
| 7000 | TCP | **你 GPU 服务器的出口 IP** | frp 隧道 |

> 7000 能限定到 GPU 服务器的固定出口 IP 最好；若是动态 IP 只能放 0.0.0.0/0，
> 此时 frp 的 token 就是唯一防线，务必用脚本生成的随机 token，别用示例值。
>
> **8011 不要开放**。它是 frp 映射出来的端口，脚本里已经用
> `proxyBindAddr = "127.0.0.1"` 锁在回环上，公网访问不到——这是故意的，
> 所有流量必须经过 nginx 才有 HTTPS 和访问日志。

---

## 三、域名解析

在你的域名服务商处加一条 A 记录，指向 ECS 的公网 IP：

```
netai.你的域名    A    <ECS公网IP>    TTL 600
```

生效后验证：`dig +short netai.你的域名` 应该返回 ECS 的 IP。

没有域名也能跑（见第四步的无域名模式），但只能走 HTTP，登录 Cookie
必须关掉 Secure，**不建议给外部人员测试时用**。

---

## 四、ECS 上一键安装

```bash
ssh root@<ECS公网IP>
git clone https://github.com/chuanting/ZhitongWTP.git && cd ZhitongWTP

# 有域名（推荐）：自动装 frps + nginx + 申请 HTTPS 证书
DOMAIN=netai.你的域名 EMAIL=你的邮箱 sudo -E ./deploy/aliyun/setup-frps.sh

# 无域名：走 http://<公网IP>:8080，仅供内部临时测试
sudo ./deploy/aliyun/setup-frps.sh
```

脚本会做这些事，可重复执行（已装的跳过，token 只生成一次不会让客户端失效）：

1. 按 CPU 架构下载对应的 frp，装成 systemd 服务
2. 生成随机 token，写 `/etc/frp/frps.toml`（映射端口锁在回环）
3. 装 nginx 并配好反代、限流、40 MB 上传上限、180 秒读超时
4. 给了域名就调 certbot 申请证书并开启 HTTPS 跳转
5. **最后打印一段完整的 `frpc.toml`，token 已填好，直接复制到 GPU 服务器**

> ECS 访问 GitHub 可能不通。若下载 frp 失败，在本地下好
> `frp_0.61.1_linux_amd64.tar.gz` 后 `scp` 上去，
> 再 `sudo install frp_*/frps /usr/local/bin/` 然后重跑脚本。

---

## 五、本地 GPU 服务器：连上隧道

把脚本最后打印的那段粘贴到 `/etc/frp/frpc.toml`：

```bash
sudo mkdir -p /etc/frp /var/log/frp
sudo useradd -r -s /usr/sbin/nologin frp 2>/dev/null || true
sudo chown frp:frp /var/log/frp
sudo vim /etc/frp/frpc.toml        # 粘贴脚本输出的内容

# 下载 frpc（版本要和 ECS 上一致）
VER=0.61.1
wget https://github.com/fatedier/frp/releases/download/v${VER}/frp_${VER}_linux_amd64.tar.gz
tar xf frp_${VER}_linux_amd64.tar.gz
sudo install frp_${VER}_linux_amd64/frpc /usr/local/bin/

sudo cp deploy/systemd/frpc.service /etc/systemd/system/
sudo systemctl enable --now frpc
sudo journalctl -u frpc -f
```

日志出现 `start proxy success` 就通了。

### 应用侧配置

`.env` 里确认这两项，改完 `docker compose up -d`：

```bash
NETAI_TRUST_PROXY=1        # 让限流按 nginx 转发的真实 IP 分桶
NETAI_COOKIE_SECURE=1      # 有 HTTPS 时必须为 1；无域名走 HTTP 时设 0
```

---

## 六、验证

```bash
# 本地 GPU 机器：应用自身
curl -s localhost:8010/api/health | python3 -m json.tool

# ECS 上：隧道是否接上
sudo systemctl status frps
sudo ss -tlnp | grep 8011          # 应该只有 127.0.0.1:8011
curl -s localhost:8011/api/health  # 能返回 JSON = 隧道通了

# 任意机器：走公网
curl -s https://netai.你的域名/api/health | python3 -m json.tool
curl -s -o /dev/null -w '%{http_code}\n' https://netai.你的域名/api/datasets   # 应为 401

# 确认 8011 没有暴露到公网（应该连不上/超时）
curl -m 5 http://<ECS公网IP>:8011/api/health
```

浏览器打开 `https://netai.你的域名`，看到登录页即成功。

---

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| `502 Bad Gateway` | 隧道没通。ECS 上 `systemctl status frps`、GPU 机器上 `journalctl -u frpc -f` 对着看 |
| frpc 日志 `login to server failed` | token 两边不一致，或安全组没放行 7000 |
| certbot 签发失败 | 域名没解析到 ECS、安全组没开 80，或解析到了境内未备案的 IP |
| 能打开页面但登录后立刻掉线 | `NETAI_COOKIE_SECURE=1` 却在用 HTTP 访问。走 HTTPS，或临时设为 0 |
| 上传大 CSV 报 413 | nginx `client_max_body_size` 小于应用的 `NETAI_MAX_UPLOAD_MB`，两个都要调 |
| 限流误伤，所有人共享配额 | 应用侧 `NETAI_TRUST_PROXY` 没设成 1 |
| 流量费超预期 | 检查带宽是不是选成了「按固定带宽」；ECS 控制台能看流量明细 |
| 本地 GPU 机器重启后访问不了 | `systemctl enable frpc` 有没有做；Docker 的 `restart: unless-stopped` 会自己拉起应用 |

---

## 成本与取舍

| 方案 | 月成本量级 | 大陆延迟 | 备案 | 说明 |
|---|---|---|---|---|
| **香港 ECS 中转 + 本地 GPU** | 最低（一台入门 ECS + 少量流量） | 30–60 ms | 不需要 | 本文方案 |
| 境内 ECS 中转 + 本地 GPU | 同上 | 10–20 ms | **需要** | 备案后延迟更好，见 [DEPLOY.md](DEPLOY.md) |
| Cloudflare Tunnel | 0 | 不稳定 | 不需要 | 连 ECS 都省了，见 [CLOUDFLARE.md](CLOUDFLARE.md) |
| 阿里云 GPU 实例跑整套 | 高一个量级 | 10–20 ms | 视地域 | 不依赖本地机器开机，但 GPU 实例按小时计费很贵 |

具体价格请以阿里云控制台为准，这里只给量级对比。

本方案的隐含前提：**本地 GPU 服务器要一直开机**。断电或断网，公网访问就断了
（nginx 会返回 502）。如果需要 7×24 稳定可用，考虑最后一行的方案。
