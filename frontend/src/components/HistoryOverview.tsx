import { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import { baseOption } from './chartBase'
import { CHART, SERIES, type Mode } from '../theme'
import { api } from '../api'
import { formatDateTimeFull, formatValue, scaleSeries } from '../format'

interface Overview { timestamps: string[]; values: (number | null)[]; downsampled: boolean; source_points: number }

/**
 * 全历史概览条：主图只覆盖上下文+预测窗口（通常十几天），
 * 这条带子给出该窗口在整个数据集中的位置。
 */
export default function HistoryOverview({ datasetId, channel, unit, displayScale, anchor, contextLength, predictionLength, mode }: {
  datasetId: string
  channel: string
  unit: string
  displayScale: number
  anchor: string
  contextLength: number
  predictionLength: number
  mode: Mode
}) {
  const [data, setData] = useState<Overview | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    api.series(datasetId, channel, 900)
      .then((d) => { if (alive) setData(d) })
      .catch(() => { if (alive) setData(null) })
    return () => { alive = false }
  }, [datasetId, channel])

  const option = useMemo<EChartsOption | null>(() => {
    if (!data || !data.timestamps.length) return null
    const c = CHART[mode]
    const s = SERIES[mode]
    const values = scaleSeries(data.values, displayScale)

    // 概览已降采样，按时间戳找出最接近的窗口边界
    const times = data.timestamps.map((t) => new Date(t).getTime())
    const nearest = (target: number) => {
      let best = 0
      let gap = Infinity
      for (let i = 0; i < times.length; i += 1) {
        const d = Math.abs(times[i] - target)
        if (d < gap) { gap = d; best = i }
      }
      return best
    }
    const anchorMs = new Date(anchor).getTime()
    // 概览是降采样后的点，而 contextLength / predictionLength 以原始采样步长计
    const totalMs = times[times.length - 1] - times[0]
    const stepMs = data.source_points > 1 ? totalMs / (data.source_points - 1) : 3_600_000
    const startIdx = nearest(anchorMs - contextLength * stepMs)
    const endIdx = nearest(anchorMs + predictionLength * stepMs)

    return {
      ...baseOption(mode, { unit: '', gridTop: 8, gridBottom: 20, gridLeft: 8 }),
      grid: { top: 8, bottom: 20, left: 8, right: 8, containLabel: false },
      tooltip: {
        ...baseOption(mode, { unit }).tooltip,
        formatter: (params: unknown) => {
          const p = (Array.isArray(params) ? params[0] : params) as { axisValue: string; value: number | null }
          if (p?.value == null) return ''
          return `<div style="font-size:11px;opacity:.7">${formatDateTimeFull(p.axisValue)}</div>
                  <div style="font-variant-numeric:tabular-nums;font-weight:600">${formatValue(p.value, unit)}</div>`
        },
      },
      xAxis: {
        type: 'category', boundaryGap: false, data: data.timestamps,
        axisLine: { lineStyle: { color: c.axis, width: 1 } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: c.textMuted, fontSize: 10, hideOverlap: true, margin: 7,
          formatter: (v: string) => {
            const d = new Date(v)
            return `${d.getFullYear()}/${d.getMonth() + 1}`
          },
        },
      },
      yAxis: { type: 'value', scale: true, show: false },
      series: [{
        type: 'line', symbol: 'none', name: '历史',
        lineStyle: { color: c.textMuted, width: 1, opacity: 0.75 },
        areaStyle: { color: c.textMuted, opacity: 0.1 },
        data: values,
        markArea: {
          silent: true, animation: false,
          itemStyle: { color: s.forecast, opacity: 0.18 },
          label: {
            show: true, position: 'insideTop', color: c.textSecondary, fontSize: 10,
            formatter: '当前窗口', offset: [0, -1],
          },
          data: [[{ xAxis: startIdx }, { xAxis: endIdx }]],
        },
      }],
    }
  }, [data, mode, unit, displayScale, anchor, contextLength, predictionLength])

  if (!option) {
    return <div className="h-[70px] w-full animate-pulse rounded bg-surface-2" aria-hidden />
  }
  return (
    <div>
      <EChart option={option} height={70} />
      {data?.downsampled && (
        <div className="px-2 text-[10.5px] text-ink-3">
          全历史 {data.source_points.toLocaleString('zh-CN')} 个点，已按等宽分桶取均值绘制概览
        </div>
      )}
    </div>
  )
}
