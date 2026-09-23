# 用 Cloudflare Tunnel 发布

不需要公网 IP、不需要端口映射、不需要买 VPS、不需要 ICP 备案，HTTPS 证书自动签发。
GPU 服务器只向外建立出站连接，公网扫不到它。

```
访问者 ──HTTPS──▶ Cloudflare 边缘 ──出站长连接──▶ cloudflared ──▶ netai:8010
                  (自动证书/WAF)                  (GPU 服务器容器内)
```

**代价**：国内访问走境外节点（免费版通常落在香港/日本/新加坡/洛杉矶），
延迟和稳定性不如境内 VPS + frp。演示、外审、跨境协作够用；要给国内大量用户
长期稳定访问，还是 [DEPLOY.md](DEPLOY.md) 的 frp 方案更合适。

---

## 零、先试水：临时隧道（2 分钟，不需要域名和账号）

想马上看到效果、确认应用在公网能跑通，先用这个：

```bash
# GPU 服务器上，应用已经在 127.0.0.1:8010 跑着
docker run --rm --network host cloudflare/cloudflared:latest \
  tunnel --url http://127.0.0.1:8010
```

输出里会给一个 `https://随机字样.trycloudflare.com`，直接能访问。

限制：URL 每次重启都变、无 SLA、Cloudflare 随时可能限速。**只适合临时验证**，
确认能跑通之后再按下面做正式隧道。

---

## 一、前置条件

1. **一个域名，且 NS 已托管到 Cloudflare**（免费套餐即可）
   - 在 <https://dash.cloudflare.com> 添加站点，按提示把域名注册商处的
     NS 改成 Cloudflare 给的两条，等生效（通常几分钟到几小时）
   - `dig NS 你的域名 +short` 看到 cloudflare.com 就算好了
2. **应用已在 GPU 服务器上跑起来**（见 [DEPLOY.md](DEPLOY.md) 第一节）
3. `.env` 里 `NETAI_ACCESS_PASSWORD` 已设置

---

## 二、创建隧道（控制台方式，推荐）

路由规则存在 Cloudflare 侧，服务器上只需要一个 token，最适合 Docker 部署。

1. 打开 <https://one.dash.cloudflare.com> → 左侧 **Networks → Tunnels**
2. **Create a tunnel** → 选 **Cloudflared** → 隧道名填 `netai` → Save
3. 在 **Install and run a connector** 页面，**复制那串 token**
   （形如 `eyJhIjoi...`，很长；只要 token，不用管它给的安装命令）
4. 切到 **Public Hostname** 标签页 → **Add a public hostname**：

   | 字段 | 填什么 |
   |---|---|
   | Subdomain | `netai` |
   | Domain | 你的域名 |
   | Path | 留空 |
   | Type | `HTTP` |
   | **URL** | **`netai:8010`** |

   > ⚠️ URL 必须填 **`netai:8010`**（compose 里的服务名），不是 `localhost:8010`。
   > cloudflared 跑在自己的容器里，`localhost` 指的是它自己，填错会一直 502。
   >
   > 如果你不用 Docker、直接用 systemd 跑 cloudflared，这里才填 `localhost:8010`。

5. 展开 **Additional application settings → TLS**，确认 **No TLS Verify** 关着
   （源站是明文 HTTP，本来就不校验证书）；**HTTP Settings** 里
   **Disable Chunked Encoding** 保持关闭，否则 CSV 上传会出问题。
6. Save hostname。DNS 记录 Cloudflare 会自动建，不用手动加。

---

## 三、服务器上启动

```bash
cd ZhitongWTP
# 把第 3 步复制的 token 写进 .env
echo 'CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...把整串粘这里' >> .env

docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d --build
docker compose logs -f cloudflared
```

日志里出现 `Registered tunnel connection` 四条（四个边缘节点）就通了。
控制台上隧道状态会从 **Inactive** 变成 **Healthy**。

浏览器打开 `https://netai.你的域名` —— 应该看到登录页。

---

## 四、验证

```bash
# 隧道状态
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml ps

# 应用自身（走宿主机回环，绕过 Cloudflare）
curl -s localhost:8010/api/health | python3 -m json.tool

# 走公网：未登录应返回 401
curl -s -o /dev/null -w '%{http_code}\n' https://netai.你的域名/api/datasets

# 走公网：健康检查应返回 200
curl -s https://netai.你的域名/api/health | python3 -m json.tool

# 确认限流拿到的是真实访问者 IP 而不是 Cloudflare 的边缘 IP：
# 连续快速请求登录接口，第 11 次应返回 429
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code} " -X POST https://netai.你的域名/api/auth/login \
    -H 'Content-Type: application/json' -d '{"password":"x"}'
done; echo
```

---

## 五、可选：用 Cloudflare Access 替代共享口令

免费额度 50 个用户，支持邮箱一次性验证码、Google / GitHub 登录。
比共享口令强的地方是能按人授权、能看到谁访问过、能随时撤销某个人。

1. Zero Trust 控制台 → **Access → Applications → Add an application** → **Self-hosted**
2. Application domain 填 `netai.你的域名`
3. 加一条 Policy：Action `Allow`，Include 选 **Emails** 并列出允许的邮箱
   （或 **Emails ending in** 填 `@sdu.edu.cn` 这类域后缀）
4. 生效后，访问者会先被 Cloudflare 拦下做身份验证

这时应用内的口令可以关掉——把 `.env` 里的 `NETAI_ACCESS_PASSWORD` 留空并重启。
**但要注意**：关掉之后，任何绕过 Cloudflare 直接访问源站的请求都是无鉴权的。
只有在确认宿主机 8010 端口没暴露到公网（默认就是 `127.0.0.1:8010`，安全）时才这么做。
稳妥起见，两层都留着也没什么成本。

---

## 六、常见问题

| 现象 | 原因与处理 |
|---|---|
| 一直 **502 Bad Gateway** | 九成是 Public Hostname 的 URL 填了 `localhost:8010`。Docker 部署要填 `netai:8010` |
| 隧道 **Inactive** | token 没填对，或容器没起来：`docker compose logs cloudflared` |
| **524 Timeout** | Cloudflare 边缘对源站响应有 100 秒上限。GPU 推理通常 1 秒内返回；如果确实超了，把预测步长调小 |
| 能打开页面但**登录后立刻掉线** | `NETAI_COOKIE_SECURE=1` 但你在用 `http://` 直连源站测试。走 `https://域名` 访问即可 |
| 上传大 CSV **失败** | Cloudflare 免费版请求体上限 100 MB；应用默认上限 32 MB，两者都要够 |
| 限流误伤，**所有人共享一个配额** | `NETAI_TRUST_PROXY` 没设成 `1`，导致所有请求都被算作来自 cloudflared 容器的同一个 IP。叠加配置里已经设了 |
| 国内访问**很慢/不稳** | 免费版走境外节点的固有限制。改用境内 VPS + frp（[DEPLOY.md](DEPLOY.md)） |

---

## 七、日常运维

```bash
C="-f docker-compose.yml -f docker-compose.cloudflare.yml"

docker compose $C logs -f --tail=100       # 全部日志
docker compose $C logs -f cloudflared      # 只看隧道
docker compose $C restart cloudflared      # 隧道重连
docker compose $C up -d --build            # 更新代码后重新部署
docker compose $C down                     # 停止（隧道断开，域名立即不可访问）
```

**换口令**：改 `.env` 的 `NETAI_ACCESS_PASSWORD` 后 `docker compose $C up -d`。
没设 `NETAI_SECRET_KEY` 时，换口令会让所有已登录会话立即失效。

**临时下线**：`docker compose $C stop cloudflared` —— 应用继续在本地跑，
只是公网访问不了了。

---

## 上线前检查清单

- [ ] `.env` 里 `NETAI_ACCESS_PASSWORD` 和 `NETAI_SECRET_KEY` 都已设置，且 `.env` 没被提交
- [ ] Public Hostname 的 URL 是 `netai:8010`（Docker 部署）
- [ ] `https://域名/api/health` 返回 `auth_required: true`、`device: cuda`
- [ ] `https://域名/api/datasets` 未登录时返回 401
- [ ] 连打登录接口能触发 429（说明限流拿到的是真实 IP）
- [ ] 宿主机 `ss -tlnp | grep 8010` 只有 `127.0.0.1`，没有 `0.0.0.0`
- [ ] 告知测试者：上传数据会落在服务器磁盘，24 小时后自动删除
