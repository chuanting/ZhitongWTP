import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import { baseOption, tooltipFormatter } from './chartBase'
import { CHART, SERIES, type Mode } from '../theme'
import type { ChannelResult } from '../api'
import { scaleSeries } from '../format'

const CONTEXT_TAIL = 48   // 小多图只保留最近 48 点上下文，突出预测窗口

/** 小多图：每个通道独立 y 轴，避免把不同量纲塞进同一张图。 */
export default function MiniChannelChart({ channel, mode, height = 132 }: {
  channel: ChannelResult; mode: Mode; height?: number
}) {
  const option = useMemo<EChartsOption>(() => {
    const c = CHART[mode]
    const s = SERIES[mode]
    const scale = channel.info.display_scale
    const unit = channel.info.unit

    const tail = Math.min(CONTEXT_TAIL, channel.context.timestamps.length)
    const ctxT = channel.context.timestamps.slice(-tail)
    const ctxV = scaleSeries(channel.context.values.slice(-tail), scale)
    const horT = channel.horizon.timestamps
    const axis = [...ctxT, ...horT]
    const nCtx = ctxT.length
    const nHor = horT.length
    const pad = Array.from({ length: nCtx }, () => null as number | null)

    const median = scaleSeries(channel.median, scale)
    const actual = channel.actual ? scaleSeries(channel.actual, scale) : null
    const anchor = ctxV[nCtx - 1] ?? null
    const lead = (arr: (number | null)[]) => [...pad.slice(0, nCtx - 1), anchor, ...arr]

    const qKeys = Object.keys(channel.quantiles).map(Number).sort((a, b) => a - b)
    const lo = qKeys.length >= 2 ? scaleSeries(channel.quantiles[String(qKeys[0])], scale) : null
    const hi = qKeys.length >= 2 ? scaleSeries(channel.quantiles[String(qKeys[qKeys.length - 1])], scale) : null
    const band = lo && hi ? lo.map((v, i) => (v == null || hi[i] == null ? null : hi[i]! - v)) : null

    const series: EChartsOption['series'] = []
    if (lo && band) {
      series.push(
        { name: '__lo', type: 'line', stack: 'b', symbol: 'none', silent: true,
          lineStyle: { opacity: 0 }, data: [...pad, ...lo], z: 1 },
        { name: '预测区间', type: 'line', stack: 'b', symbol: 'none', silent: true,
          lineStyle: { opacity: 0 }, areaStyle: { color: s.forecast, opacity: c.bandOpacity },
          data: [...pad, ...band], z: 1, tooltip: { show: false } },
      )
    }
    series.push({
      name: '实际值', type: 'line', symbol: 'none', z: 3,
      lineStyle: { color: s.actual, width: 1.6 }, itemStyle: { color: s.actual },
      data: actual ? [...ctxV, ...actual] : [...ctxV, ...Array.from({ length: nHor }, () => null)],
      markLine: {
        symbol: 'none', silent: true, animation: false,
        lineStyle: { color: c.textMuted, width: 1, opacity: 0.7 },
        label: { show: false },
        data: [{ xAxis: nCtx - 1 }],
      },
    })
    series.push({
      name: 'NetAILLM 预测', type: 'line', symbol: 'none', z: 4,
      lineStyle: { color: s.forecast, width: 1.6 }, itemStyle: { color: s.forecast },
      data: lead(median),
    })

    return {
      ...baseOption(mode, { unit, gridTop: 10, gridBottom: 20, gridLeft: 46 }),
      tooltip: { ...baseOption(mode, { unit }).tooltip, formatter: tooltipFormatter(unit) },
      xAxis: {
        ...(baseOption(mode, { unit }).xAxis as object),
        data: axis,
        axisLabel: {
          color: c.textMuted, fontSize: 10, hideOverlap: true, margin: 7,
          formatter: (v: string) => {
            const d = new Date(v)
            return d.getHours() === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : `${String(d.getHours()).padStart(2, '0')}:00`
          },
        },
      },
      yAxis: { ...(baseOption(mode, { unit }).yAxis as object), name: undefined, axisLabel: { color: c.textMuted, fontSize: 10, margin: 6 } },
      series,
    }
  }, [channel, mode])

  return <EChart option={option} height={height} />
}
