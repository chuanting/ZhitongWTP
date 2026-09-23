import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { downloadCsv, UnauthorizedError, type AuthStatus, type Dataset, type Defaults, type ForecastRequest, type ForecastResult, type ModelInfo } from './api'
import { client as api, IS_STATIC, scenariosFor } from './client'
import type { StaticScenario } from './staticApi'
import { applyMode, readMode, SERIES, type Mode } from './theme'
import { describeFinetune, formatDateTimeFull, formatNumber } from './format'
import TopBar from './components/TopBar'
import LoginGate from './components/LoginGate'
import DatasetPanel from './components/DatasetPanel'
import ControlPanel, { type RunConfig } from './components/ControlPanel'
import ForecastChart from './components/ForecastChart'
import ResidualChart from './components/ResidualChart'
import MiniChannelChart from './components/MiniChannelChart'
import HistoryOverview from './components/HistoryOverview'
import MetricCards from './components/MetricCards'
import MetricsTable from './components/MetricsTable'
import { Alert, Badge, Button, Card, SectionTitle, Spinner, Swatch } from './components/ui'

const DEFAULT_CONFIG: RunConfig = {
  channels: ['flow'],
  contextLength: 336,
  predictionLength: 24,
  quantiles: [0.1, 0.5, 0.9],
  anchor: null,
  baseline: true,
}

function pickChannels(ds: Dataset): string[] {
  const preferred = ['flow', 'dflow', 'uflow'].filter((c) => ds.channels.includes(c))
  return preferred.length ? preferred.slice(0, 1) : ds.channels.slice(0, 1)
}

export default function App() {
  const [mode, setMode] = useState<Mode>(readMode)
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [defaults, setDefaults] = useState<Defaults | null>(null)
  const [model, setModel] = useState<ModelInfo | null>(null)
  const [datasetId, setDatasetId] = useState('')
  const [config, setConfig] = useState<RunConfig>(DEFAULT_CONFIG)
  const [result, setResult] = useState<ForecastResult | null>(null)
  const [activeChannel, setActiveChannel] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [booting, setBooting] = useState(true)
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [scenarios, setScenarios] = useState<StaticScenario[]>([])
  const [exporting, setExporting] = useState(false)
  const autoRan = useRef(false)

  const dataset = datasets.find((d) => d.id === datasetId)

  // 静态演示版：预测起点只能从预计算场景里选
  useEffect(() => {
    if (!IS_STATIC || !datasetId) return
    let alive = true
    scenariosFor(datasetId).then((list) => {
      if (!alive) return
      setScenarios(list)
      setConfig((c) => (list.length ? { ...c, anchor: list[0].anchor,
                                        predictionLength: list[0].prediction_length } : c))
    })
    return () => { alive = false }
  }, [datasetId])

  useEffect(() => { applyMode(mode) }, [mode])

  // 先确认会话状态，未通过鉴权时不请求任何受保护接口
  useEffect(() => {
    let alive = true
    api.authStatus()
      .then((st) => { if (alive) setAuth(st) })
      .catch(() => alive && setAuth({ required: true, authenticated: false }))
      .finally(() => alive && setBooting(false))
    return () => { alive = false }
  }, [])

  // 通过鉴权后再加载数据集目录与模型状态
  useEffect(() => {
    if (!auth?.authenticated) return
    let alive = true
    setBooting(true)
    Promise.all([api.datasets(), api.model().catch(() => null)])
      .then(([cat, mi]) => {
        if (!alive) return
        setDatasets(cat.datasets)
        setDefaults(cat.defaults)
        setModel(mi)
        const first = cat.datasets[0]
        if (first) {
          setDatasetId(first.id)
          setConfig((c) => ({ ...c, channels: pickChannels(first) }))
        }
      })
      .catch((e) => {
        if (!alive) return
        if (e instanceof UnauthorizedError) setAuth({ required: true, authenticated: false })
        else setError(e instanceof Error ? e.message : '无法连接后端服务')
      })
      .finally(() => alive && setBooting(false))
    return () => { alive = false }
  }, [auth?.authenticated])

  // 模型冷启动时轮询加载状态，直到常驻内存
  useEffect(() => {
    if (!model || model.loaded || model.load_error) return
    const timer = setInterval(() => {
      api.model().then(setModel).catch(() => { /* 轮询失败不打断界面 */ })
    }, 2500)
    return () => clearInterval(timer)
  }, [model])

  const buildRequest = useCallback((): ForecastRequest => ({
    dataset_id: datasetId,
    channels: config.channels,
    context_length: config.contextLength,
    prediction_length: config.predictionLength,
    anchor: config.anchor,
    quantiles: config.quantiles,
    baseline: config.baseline,
  }), [datasetId, config])

  const run = useCallback(async () => {
    if (!datasetId || !config.channels.length) return
    setRunning(true); setError(null)
    try {
      const res = await api.forecast(buildRequest())
      setResult(res)
      setModel(res.model)
      setActiveChannel((prev) =>
        res.channels.some((c) => c.key === prev) ? prev : res.channels[0]?.key ?? '')
    } catch (e) {
      if (e instanceof UnauthorizedError) setAuth({ required: true, authenticated: false })
      else setError(e instanceof Error ? e.message : '预测失败')
    } finally {
      setRunning(false)
    }
  }, [buildRequest, datasetId, config.channels.length])

  // 首次进入自动跑一次，让界面直接呈现结果而不是空状态
  useEffect(() => {
    if (!autoRan.current && datasetId && !booting) { autoRan.current = true; void run() }
  }, [datasetId, booting, run])

  function selectDataset(id: string) {
    const ds = datasets.find((d) => d.id === id)
    if (!ds) return
    setDatasetId(id)
    setResult(null)
    setNotes([])
    setConfig((c) => {
      const kept = c.channels.filter((k) => ds.channels.includes(k))
      return { ...c, channels: kept.length ? kept : pickChannels(ds), anchor: null }
    })
  }

  const active = result?.channels.find((c) => c.key === activeChannel) ?? result?.channels[0]
  const others = result?.channels.filter((c) => c.key !== active?.key) ?? []
  const s = SERIES[mode]

  const headerMeta = useMemo(() => {
    if (!result) return null
    const { config: rc, model: rm } = result
    return [
      { k: '预测起点', v: formatDateTimeFull(rc.anchor) },
      { k: '上下文', v: `${rc.context_length} 点` },
      { k: '预测窗口', v: `${rc.prediction_length} 点` },
      { k: '推理耗时', v: `${formatNumber(rm.inference_seconds ?? null, 2)} 秒` },
    ]
  }, [result])

  async function handleExport() {
    setExporting(true)
    try { await downloadCsv(buildRequest()) } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败')
    } finally { setExporting(false) }
  }

  if (auth && auth.required && !auth.authenticated) {
    return <LoginGate onSuccess={() => setAuth({ required: true, authenticated: true })} />
  }

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <TopBar model={model} mode={mode} onToggleMode={() => setMode(mode === 'dark' ? 'light' : 'dark')}
        canLogout={!!auth?.required}
        onLogout={async () => {
          await api.logout().catch(() => { /* 本地清状态即可 */ })
          setAuth({ required: true, authenticated: false })
          setResult(null)
          autoRan.current = false
        }} />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 overflow-y-auto border-edge bg-surface-1 p-4
                          lg:w-[300px] lg:border-r xl:w-[330px] border-b lg:border-b-0">
          {booting ? (
            <div className="flex items-center gap-2 text-[12px] text-ink-3"><Spinner /> 正在加载数据集…</div>
          ) : (
            <>
              <DatasetPanel
                datasets={datasets} selectedId={datasetId} onSelect={selectDataset}
                onUploaded={(ds, ns) => {
                  setDatasets((prev) => [...prev, ds])
                  setNotes(ns)
                  selectDataset(ds.id)
                  setConfig((c) => ({ ...c, channels: pickChannels(ds), anchor: null }))
                }}
                onDeleted={(id) => {
                  setDatasets((prev) => prev.filter((d) => d.id !== id))
                  if (id === datasetId) {
                    const next = datasets.find((d) => d.id !== id)
                    if (next) selectDataset(next.id)
                  }
                }} />
              <div className="my-4 border-t border-edge" />
              <ControlPanel dataset={dataset} defaults={defaults} config={config} running={running}
                scenarios={IS_STATIC ? scenarios : undefined}
                onChange={(patch) => setConfig((c) => ({ ...c, ...patch }))} onRun={run} />
            </>
          )}
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-[1400px] space-y-3.5">
            {notes.length > 0 && (
              <Alert tone="accent" title="数据已规整" onClose={() => setNotes([])}>
                <ul className="mt-0.5 list-disc pl-4">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
              </Alert>
            )}
            {error && <Alert title="出错了" onClose={() => setError(null)}>{error}</Alert>}

            {result?.warnings?.map((w) => (
              <Alert key={w.kind + w.scope} tone="warning" title="该预测窗口的评估结果不可信">
                {w.message}
              </Alert>
            ))}

            {!result && (running || booting) && (
              <Card className="flex h-[420px] flex-col items-center justify-center gap-3">
                <div className="relative h-1 w-48 overflow-hidden rounded-full bg-surface-3">
                  <div className="sweep absolute inset-y-0 w-1/3 rounded-full" style={{ background: s.actual }} />
                </div>
                <div className="text-[12.5px] text-ink-2">
                  {model?.loaded ? '正在推理…' : '首次加载 NetAILLM 权重，约需数秒…'}
                </div>
              </Card>
            )}

            {!result && !running && !booting && (
              <Card className="flex h-[420px] flex-col items-center justify-center gap-2 text-center">
                <div className="text-[13px] font-medium text-ink">选择数据集并开始预测</div>
                <div className="max-w-sm text-[12px] leading-relaxed text-ink-3">
                  左侧选择内置示范小区或上传自己的 CSV，配置预测指标与窗口后点击「开始预测」。
                </div>
              </Card>
            )}

            {result && active && (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <h1 className="text-[15px] font-semibold text-ink">{result.dataset.name}</h1>
                  <Badge tone={result.config.mode === '回测评估' ? 'accent' : 'warning'}
                    title={result.config.mode === '回测评估'
                      ? '预测窗口落在历史范围内，可与真实值逐点对比'
                      : '预测窗口超出已有数据，无真实值可比对'}>
                    {result.config.mode}
                  </Badge>
                  {headerMeta?.map((m) => (
                    <span key={m.k} className="text-[11.5px] text-ink-3">
                      {m.k} <span className="tnum text-ink-2">{m.v}</span>
                    </span>
                  ))}
                  <Button className="ml-auto" onClick={handleExport} disabled={exporting}
                    title="导出预测、真实值、基线与各分位数为 CSV">
                    {exporting ? <Spinner /> : '导出 CSV'}
                  </Button>
                </div>

                <MetricCards channel={active} />

                <Card padded={false}>
                  <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {result.channels.map((c) => (
                        <button key={c.key} type="button" onClick={() => setActiveChannel(c.key)}
                          aria-pressed={c.key === active.key}
                          className={`rounded px-2 py-1 text-[11.5px] font-medium transition-colors
                            ${c.key === active.key ? 'bg-surface-3 text-ink' : 'text-ink-3 hover:text-ink'}`}>
                          {c.info.label}
                        </button>
                      ))}
                    </div>
                    <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-ink-2">
                      <span className="flex items-center gap-1.5"><Swatch color={s.actual} />实际值</span>
                      <span className="flex items-center gap-1.5"><Swatch color={s.forecast} />NetAILLM 预测</span>
                      <span className="flex items-center gap-1.5"><Swatch color={s.forecast} area />{result.config.interval_level}% 区间</span>
                      {config.baseline && (
                        <span className="flex items-center gap-1.5"><Swatch color={s.baseline} dashed />季节朴素基线</span>
                      )}
                    </div>
                  </div>
                  <div className="border-b border-edge px-2 pb-1 pt-2">
                    <HistoryOverview
                      datasetId={result.dataset.id} channel={active.key}
                      unit={active.info.unit} displayScale={active.info.display_scale}
                      anchor={result.config.anchor} contextLength={result.config.context_length}
                      predictionLength={result.config.prediction_length} mode={mode} />
                  </div>
                  <div className="px-2 pb-1 pt-2">
                    <ForecastChart channel={active} mode={mode} showBaseline={config.baseline}
                      intervalLevel={result.config.interval_level} height={400} />
                  </div>
                  <div className="px-4 pb-3 text-[11px] text-ink-3">
                    竖线为预测起点；其左侧为模型输入的历史上下文，右侧为预测窗口。
                    拖动下方滑块或按住 Shift 滚轮可缩放时间范围。
                  </div>
                </Card>

                {active.residuals && (
                  <Card>
                    <SectionTitle title="逐步残差" hint={`预测 − 实际 · ${active.info.label}（${active.info.unit || '原量纲'}）`} />
                    <ResidualChart channel={active} mode={mode} height={150} />
                    <p className="mt-1.5 text-[11px] text-ink-3">
                      横轴为预测步长 +1 … +{result.config.prediction_length}。柱子向上表示高估，向下表示低估；
                      误差随步长系统性放大通常意味着上下文窗口偏短。
                    </p>
                  </Card>
                )}

                {others.length > 0 && (
                  <Card>
                    <SectionTitle title="其他指标预测" hint={`${others.length} 个指标 · 各自独立纵轴`} />
                    <div className="grid gap-x-4 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
                      {others.map((c) => (
                        <div key={c.key} className="min-w-0">
                          <div className="mb-0.5 flex items-baseline justify-between gap-2">
                            <button onClick={() => setActiveChannel(c.key)}
                              className="text-[12px] font-medium text-ink hover:text-accent">
                              {c.info.label}
                            </button>
                            <span className="tnum text-[11px] text-ink-3">
                              {c.metrics?.mase != null ? `MASE ${formatNumber(c.metrics.mase, 2)}` : c.info.unit}
                            </span>
                          </div>
                          <MiniChannelChart channel={c} mode={mode} height={130} />
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                <Card>
                  <SectionTitle title="指标明细"
                    hint={`${result.config.prediction_length} 步预测 · 对照季节朴素基线（周期 ${result.config.season_period}）`} />
                  <MetricsTable channels={result.channels} />
                </Card>

                <footer className="space-y-1 pb-2 pt-1 text-[11px] leading-relaxed text-ink-3">
                  <div>
                    {result.model.finetuned ? (
                      <>推理权重：<span className="tnum">{result.model.weights}</span>
                        （基座 {result.model.base_model}）
                        {describeFinetune(result.model.finetune_meta)}</>
                    ) : (
                      <>当前为基座模型 <span className="tnum">{result.model.base_model}</span>。
                        设置环境变量 <span className="tnum">NETAI_MODEL_PATH</span> 指向微调权重目录的
                        <b className="font-medium text-ink-2">绝对路径</b>后重启服务，即可切换为 NetAILLM 微调模型。</>
                    )}
                  </div>
                  <div>
                    预测区间为 P{result.config.quantiles[0] * 100}–P{result.config.quantiles[result.config.quantiles.length - 1] * 100}，
                    表示模型的不确定性估计，并非保证范围。对照基线为季节朴素法（周期 {result.config.season_period}）。
                  </div>
                </footer>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
