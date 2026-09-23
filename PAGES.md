# 发布静态展示版到 GitHub Pages

GitHub Pages 只托管静态文件，**跑不了模型推理**。因此这里发布的是一个
「预计算展示版」：所有预测结果由模型离线算好写成 JSON，页面只负责渲染。

| | 静态展示版 | 完整版（自建服务器） |
|---|---|---|
| 图表、指标、模型 vs 基线对比 | ✅ | ✅ |
| 切换数据集 / 指标 | ✅ | ✅ |
| 切换预测起点 | 预先算好的 8 个场景 | 任意时刻 |
| 上传自己的 CSV | ❌ | ✅ |
| 实时推理 | ❌ | ✅ |
| 成本 / 运维 | 0 | 服务器 + 常开 |

## 两个前提

1. **仓库必须是公开的。** GitHub Free 版只能从公开仓库发布 Pages。
2. **`frontend/public/demo-data/` 会跟着公开。** 里面是脱敏后的预计算结果：
   CGI 已换成 `CELL-001` 这类匠号，省市区县与厂商字段已全部移除，
   只保留场景（高校/地铁/医院…）和频段。数值本身是真实观测。

## 发布步骤

```bash
# 1. 生成预计算数据（需要本地有模型权重）
NETAI_MODEL_PATH=/abs/path/to/Zhitong_SDU_WT_LLM \
  python3 scripts/build_static_demo.py

# 2. 本地验证
cd frontend
VITE_BASE=/ npm run build:static
cd dist-static && python3 -m http.server 8899
# 打开 http://127.0.0.1:8899 确认一切正常

# 3. 提交产物（demo-data 需要入库，CI 不会重新推理）
git add frontend/public/demo-data
git commit -m "更新静态演示数据"
git push
```

然后在 GitHub 上：**Settings → Pages → Source** 选 **GitHub Actions**。
推送到 `main` 后工作流自动构建并发布到
`https://<用户名>.github.io/<仓库名>/`。

## 预计算的内容

`scripts/build_static_demo.py` 会为每个数据集生成：

- 7 个数据集 × 4 个锚点 × 2 个步长（24h / 72h）= 56 个预测结果
- 每个结果含全部 8 个指标的上下文、分位数、真实值、季节朴素基线与完整指标
- 每个数据集一份降采样的全历史概览

总计约 7.4 MB JSON，按需加载（首屏只拉 manifest + 一份概览 + 一份结果）。

改锚点或步长就编辑脚本顶部的 `ANCHOR_OFFSETS` / `HORIZONS` 后重跑。

## 数据可信区间

源数据末尾 223 个小时（2026-04-21 16:00 之后）是**前一周的逐字复制**，
属于补齐数据而非真实观测。落在该区间的回测毫无意义——模型在上下文里
已经逐字见过"未来"。预计算脚本会调用 `app.dataquality` 自动检出并整体排除，
所有对外展示的锚点都落在可信区间内。

完整版应用也内置了同一套检测：默认预测起点会自动避开复制段，
手动选到该区间时界面会明确告警。上传的数据同样会被检查。
