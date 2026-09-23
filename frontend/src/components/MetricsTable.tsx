import type { ChannelResult } from '../api'
import { formatNumber, formatPercent, formatValue, improvement } from '../format'

const COLS = [
  { key: 'mae', label: 'MAE', kind: 'unit' },
  { key: 'rmse', label: 'RMSE', kind: 'unit' },
  { key: 'mape', label: 'MAPE', kind: 'pct' },
  { key: 'smape', label: 'sMAPE', kind: 'pct' },
  { key: 'mase', label: 'MASE', kind: 'num' },
  { key: 'wql', label: 'WQL', kind: 'num4' },
  { key: 'r2', label: 'R²', kind: 'num' },
  { key: 'coverage', label: '区间覆盖率', kind: 'pct' },
  { key: 'bias', label: '偏差', kind: 'unit' },
] as const

/**
 * 全通道指标明细。它同时承担无障碍「表格视图」的职责：
 * 图上用颜色区分的信息，这里都能以文字读到。
 */
export default function MetricsTable({ channels }: { channels: ChannelResult[] }) {
  const scored = channels.filter((c) => c.metrics)
  if (!scored.length) return null

  const cell = (ch: ChannelResult, key: string, kind: string, from: 'metrics' | 'baseline_metrics') => {
    const src = ch[from]
    const v = src ? (src as unknown as Record<string, number | null>)[key] : null
    if (v == null) return '—'
    if (kind === 'unit') return formatValue(v * ch.info.display_scale, ch.info.unit)
    if (kind === 'pct') return formatPercent(v, 2)
    if (kind === 'num4') return formatNumber(v, 4)
    return formatNumber(v, 3)
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-edge text-left text-[11px] tracking-[0.03em] text-ink-3">
            <th className="sticky left-0 z-10 bg-surface-1 py-2 pr-3 font-medium">指标</th>
            <th className="py-2 pr-3 font-medium">模型</th>
            {COLS.map((c) => (
              <th key={c.key} className="py-2 pr-3 text-right font-medium whitespace-nowrap">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scored.map((ch) => {
            const rows: { model: string; from: 'metrics' | 'baseline_metrics'; muted: boolean }[] = [
              { model: 'NetAILLM', from: 'metrics', muted: false },
            ]
            if (ch.baseline_metrics) rows.push({ model: '季节朴素基线', from: 'baseline_metrics', muted: true })
            return rows.map((r, i) => (
              <tr key={`${ch.key}-${r.from}`}
                className={`border-b border-edge/60 ${i === 0 ? '' : 'text-ink-3'}`}>
                {i === 0 && (
                  <td rowSpan={rows.length}
                    className="sticky left-0 z-10 bg-surface-1 py-2 pr-3 align-top font-medium text-ink whitespace-nowrap">
                    {ch.info.label}
                    <div className="text-[10px] font-normal text-ink-3">{ch.key}</div>
                  </td>
                )}
                <td className="py-2 pr-3 whitespace-nowrap">
                  <span className={r.muted ? 'text-ink-3' : 'font-medium text-ink'}>{r.model}</span>
                </td>
                {COLS.map((c) => (
                  <td key={c.key} className="tnum py-2 pr-3 text-right whitespace-nowrap">
                    {cell(ch, c.key, c.kind, r.from)}
                    {i === 0 && c.key === 'mase' && ch.baseline_metrics && (
                      <span className="ml-1.5 text-[10px] text-ink-3">
                        ({(() => {
                          const imp = improvement(ch.metrics?.mase, ch.baseline_metrics?.mase)
                          return imp == null ? '—' : `${imp > 0 ? '↓' : '↑'}${Math.abs(imp).toFixed(0)}%`
                        })()})
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))
          })}
        </tbody>
      </table>
      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-3">
        MAE / RMSE / 偏差与指标同量纲；MAPE 已剔除接近零的观测点；MASE 以季节朴素法为 1.0；
        WQL 为加权分位数损失，衡量整个预测区间的概率质量，越小越好。
      </p>
    </div>
  )
}
