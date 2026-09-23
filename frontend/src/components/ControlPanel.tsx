import type { Dataset, Defaults } from '../api'
import { Button, Label, SectionTitle, Segmented, Spinner } from './ui'
import { describeWindow, formatDateTimeFull, stepMillis, toLocalInput } from '../format'

export interface RunConfig {
  channels: string[]
  contextLength: number
  predictionLength: number
  quantiles: number[]
  anchor: string | null
  baseline: boolean
}

const HORIZONS = [6, 12, 24, 48, 72, 168]
const CONTEXTS = [168, 336, 720, 1440]
const INTERVALS: { value: string; label: string; quantiles: number[]; title: string }[] = [
  { value: '50', label: '50%', quantiles: [0.25, 0.5, 0.75], title: 'P25–P75 预测区间' },
  { value: '80', label: '80%', quantiles: [0.1, 0.5, 0.9], title: 'P10–P90 预测区间' },
  { value: '90', label: '90%', quantiles: [0.05, 0.5, 0.95], title: 'P5–P95 预测区间' },
]

export default function ControlPanel({ dataset, defaults, config, onChange, onRun, running }: {
  dataset: Dataset | undefined
  defaults: Defaults | null
  config: RunConfig
  onChange: (patch: Partial<RunConfig>) => void
  onRun: () => void
  running: boolean
}) {
  if (!dataset) return null

  const maxCtx = Math.min(defaults?.max_context_length ?? 1440, dataset.rows - 1)
  const contexts = CONTEXTS.filter((c) => c <= maxCtx)
  const maxHorizon = defaults?.max_prediction_length ?? 336
  const horizons = HORIZONS.filter((h) => h <= maxHorizon)
  const intervalKey = INTERVALS.find(
    (i) => i.quantiles[0] === config.quantiles[0])?.value ?? '80'

  // 可选的预测起点：既要有足够上下文，也不能超过数据末尾
  const stepMs = stepMillis(dataset.freq)
  const minAnchor = new Date(new Date(dataset.start).getTime() + 24 * stepMs).toISOString()
  const latestBacktest = new Date(
    new Date(dataset.end).getTime() - config.predictionLength * stepMs).toISOString()

  const toggleChannel = (key: string) => {
    const has = config.channels.includes(key)
    if (has && config.channels.length === 1) return         // 至少保留一个指标
    onChange({ channels: has ? config.channels.filter((c) => c !== key) : [...config.channels, key] })
  }

  return (
    <div>
      <SectionTitle title="预测配置" />

      <div className="mb-4">
        <Label hint={`已选 ${config.channels.length} / ${dataset.channels.length}`}>预测指标</Label>
        <div className="flex flex-wrap gap-1.5">
          {dataset.channel_info.map((ci) => {
            const on = config.channels.includes(ci.key)
            return (
              <button key={ci.key} type="button" onClick={() => toggleChannel(ci.key)}
                aria-pressed={on} title={`${ci.label}${ci.unit ? `（${ci.unit}）` : ''}`}
                className={`rounded border px-2 py-1 text-[11.5px] transition-colors
                  ${on ? 'border-accent/55 bg-[var(--accent-soft)] text-accent'
                       : 'border-edge bg-surface-2 text-ink-2 hover:border-edge-strong hover:text-ink'}`}>
                {ci.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mb-4">
        <Label hint={describeWindow(config.predictionLength, dataset.freq_label)}>预测步长</Label>
        <Segmented value={config.predictionLength} className="w-full flex-wrap"
          options={horizons.map((h) => ({ value: h, label: h >= 24 && h % 24 === 0 ? `${h / 24}天` : `${h}h` }))}
          onChange={(v) => onChange({ predictionLength: v })} />
      </div>

      <div className="mb-4">
        <Label hint={describeWindow(config.contextLength, dataset.freq_label)}>历史上下文</Label>
        <Segmented value={config.contextLength} className="w-full flex-wrap"
          options={contexts.map((c) => ({ value: c, label: `${c / 24}天` }))}
          onChange={(v) => onChange({ contextLength: v })} />
      </div>

      <div className="mb-4">
        <Label hint="模型输出的不确定性区间">预测区间</Label>
        <Segmented value={intervalKey} className="w-full"
          options={INTERVALS.map((i) => ({ value: i.value, label: i.label, title: i.title }))}
          onChange={(v) => onChange({ quantiles: INTERVALS.find((i) => i.value === v)!.quantiles })} />
      </div>

      <div className="mb-4">
        <Label hint={config.anchor ? '自定义' : '自动'}>预测起点</Label>
        <input
          type="datetime-local"
          value={toLocalInput(config.anchor ?? latestBacktest)}
          min={toLocalInput(minAnchor)}
          max={toLocalInput(dataset.end)}
          step={Math.max(60, stepMs / 1000)}
          onChange={(e) => onChange({ anchor: e.target.value ? `${e.target.value}:00` : null })}
          className="tnum w-full rounded-md border border-edge bg-surface-2 px-2.5 py-1.5 text-[12px]
                     text-ink focus-visible:border-accent focus-visible:outline-none" />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Button variant="ghost" className="!px-2 !py-0.5 !text-[11px]"
            onClick={() => onChange({ anchor: null })}
            title={`回到最近一个能完整对比真实值的起点（${formatDateTimeFull(latestBacktest)}）`}>
            最新可回测
          </Button>
          <Button variant="ghost" className="!px-2 !py-0.5 !text-[11px]"
            onClick={() => onChange({ anchor: dataset.end })}
            title="以全部历史为上下文，向未来外推（无真实值可比对）">
            未来外推
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
          该时刻及之前的数据作为模型输入，之后的 {config.predictionLength} 个点为预测窗口。
        </p>
      </div>

      <label className="mb-4 flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
        <input type="checkbox" checked={config.baseline} className="accent-[var(--accent)]"
          onChange={(e) => onChange({ baseline: e.target.checked })} />
        对比季节朴素基线
      </label>

      <Button variant="primary" onClick={onRun} disabled={running} className="w-full !py-2 !text-[13px]">
        {running ? (<><Spinner /> 推理中…</>) : '开始预测'}
      </Button>
    </div>
  )
}
