import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import { baseOption } from './chartBase'
import { CHART, SERIES, type Mode } from '../theme'
import type { ChannelResult } from '../api'
import { formatValue, scaleSeries } from '../format'

/**
 * 逐步残差（预测 − 实际）。柱子方向已经表达了高估/低估，
 * 因此只用单一颜色，不再用配色重复编码正负号。
 */
export default function ResidualChart({ channel, mode, height = 150 }: {
  channel: ChannelResult; mode: Mode; height?: number
}) {
  const option = useMemo<EChartsOption>(() => {
    const c = CHART[mode]
    const s = SERIES[mode]
    const unit = channel.info.unit
    const scale = channel.info.display_scale
    const values = scaleSeries(channel.residuals ?? [], scale)
    const steps = values.map((_, i) => `+${i + 1}`)

    return {
      ...baseOption(mode, { unit, gridTop: 14, gridBottom: 24, gridLeft: 58 }),
      tooltip: {
        ...baseOption(mode, { unit }).tooltip,
        formatter: (params: unknown) => {
          const p = (Array.isArray(params) ? params[0] : params) as { dataIndex: number; value: number | null }
          if (p?.value == null) return ''
          const t = channel.horizon.timestamps[p.dataIndex]
          const d = new Date(t)
          const sign = p.value > 0 ? '高估' : '低估'
          return `<div style="font-size:11px;opacity:.7;margin-bottom:4px">第 ${p.dataIndex + 1} 步 · ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00</div>
            <div style="font-variant-numeric:tabular-nums"><b>${formatValue(Math.abs(p.value), unit)}</b> ${sign}</div>`
        },
      },
      xAxis: {
        ...(baseOption(mode, { unit }).xAxis as object),
        type: 'category',
        boundaryGap: true,
        data: steps,
        axisLabel: { color: c.textMuted, fontSize: 10, hideOverlap: true, margin: 7, interval: values.length > 36 ? 3 : 1 },
      },
      yAxis: {
        ...(baseOption(mode, { unit }).yAxis as object),
        name: undefined,
      },
      series: [{
        name: '残差', type: 'bar',
        barMaxWidth: 12,
        itemStyle: { color: s.forecast, borderRadius: [2, 2, 2, 2] },
        data: values,
        markLine: {
          symbol: 'none', silent: true, animation: false,
          lineStyle: { color: c.axis, width: 1 },
          label: { show: false },
          data: [{ yAxis: 0 }],
        },
      }],
    }
  }, [channel, mode])

  return <EChart option={option} height={height} />
}
