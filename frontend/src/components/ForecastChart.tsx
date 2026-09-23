import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import { baseOption, tooltipFormatter } from './chartBase'
import { CHART, SERIES, type Mode } from '../theme'
import type { ChannelResult } from '../api'
import { scaleSeries } from '../format'

const N = (n: number) => Array.from({ length: n }, () => null as number | null)

/**
 * 主预测图：历史上下文 + 实际值 + NetAILLM 中位数预测 + 分位数区间 + 季节朴素基线。
 * 所有系列共用一条 y 轴（单通道单量纲），多通道对比走小多图，不做双轴。
 */
export default function ForecastChart({ channel, mode, intervalLevel, height = 380, showBaseline = true }: {
  channel: ChannelResult
  mode: Mode
  intervalLevel: number
  height?: number
  showBaseline?: boolean
}) {
  const option = useMemo<EChartsOption>(() => {
    const c = CHART[mode]
    const s = SERIES[mode]
    const scale = channel.info.display_scale
    const unit = channel.info.unit

    const ctxT = channel.context.timestamps
    const horT = channel.horizon.timestamps
    const axis = [...ctxT, ...horT]
    const nCtx = ctxT.length
    const nHor = horT.length

    const ctxV = scaleSeries(channel.context.values, scale)
    const median = scaleSeries(channel.median, scale)
    const actual = channel.actual ? scaleSeries(channel.actual, scale) : null
    const baseline = channel.baseline ? scaleSeries(channel.baseline, scale) : null

    const qKeys = Object.keys(channel.quantiles).map(Number).sort((a, b) => a - b)
    const qLo = qKeys[0]
    const qHi = qKeys[qKeys.length - 1]
    const hasBand = qKeys.length >= 2 && qLo !== qHi
    const lo = hasBand ? scaleSeries(channel.quantiles[String(qLo)], scale) : null
    const hi = hasBand ? scaleSeries(channel.quantiles[String(qHi)], scale) : null
    // 堆叠画带：下沿 + 带宽，下沿线本身透明
    const bandWidth = lo && hi ? lo.map((v, i) => (v == null || hi[i] == null ? null : hi[i]! - v)) : null

    // 预测线从 anchor 点接上历史，避免视觉断裂
    const anchorValue = ctxV[nCtx - 1] ?? null
    const lead = (arr: (number | null)[]) => [...N(nCtx - 1), anchorValue, ...arr]

    const truthLine = actual ? [...ctxV, ...actual] : [...ctxV, ...N(nHor)]

    const series: EChartsOption['series'] = []

    if (bandWidth && lo) {
      series.push(
        {
          name: '__band_lo', type: 'line', stack: 'band', symbol: 'none',
          lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true,
          data: [...N(nCtx), ...lo], z: 1,
        },
        {
          name: `${intervalLevel}% 预测区间`, type: 'line', stack: 'band', symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: { color: s.forecast, opacity: c.bandOpacity },
          data: [...N(nCtx), ...bandWidth], z: 1,
          tooltip: { show: false },
        },
      )
    }

    series.push({
      name: '实际值', type: 'line', symbol: 'none', z: 4,
      lineStyle: { color: s.actual, width: 2 },
      itemStyle: { color: s.actual },
      data: truthLine,
      markLine: {
        symbol: 'none', silent: true, animation: false,
        lineStyle: { color: c.textMuted, width: 1, type: 'solid', opacity: 0.85 },
        label: {
          formatter: '预测起点', position: 'insideEndTop', color: c.textSecondary,
          fontSize: 10, padding: [0, 0, 3, 4],
        },
        data: [{ xAxis: nCtx - 1 }],
      },
    })

    if (showBaseline && baseline) {
      series.push({
        name: '季节朴素基线', type: 'line', symbol: 'none', z: 3,
        lineStyle: { color: s.baseline, width: 2, type: 'dashed' },
        itemStyle: { color: s.baseline },
        data: lead(baseline),
      })
    }

    series.push({
      name: 'NetAILLM 预测', type: 'line', z: 5,
      symbol: 'circle', symbolSize: 4, showSymbol: nHor <= 48,
      lineStyle: { color: s.forecast, width: 2 },
      itemStyle: { color: s.forecast, borderColor: c.surface, borderWidth: 2 },
      data: lead(median),
    })

    // 默认聚焦到「最近 3 天上下文 + 预测窗口」，可拖动查看完整历史
    const focus = Math.max(0, nCtx - 72)
    const startPct = (focus / Math.max(axis.length - 1, 1)) * 100

    return {
      ...baseOption(mode, { unit, gridTop: 16, gridBottom: 62, gridLeft: 58 }),
      tooltip: {
        ...baseOption(mode, { unit }).tooltip,
        formatter: tooltipFormatter(unit),
      },
      legend: { show: false },
      xAxis: {
        ...(baseOption(mode, { unit }).xAxis as object),
        data: axis,
        axisLabel: {
          color: c.textMuted, fontSize: 11, hideOverlap: true, margin: 10,
          formatter: (v: string) => {
            const d = new Date(v)
            return d.getHours() === 0
              ? `${d.getMonth() + 1}/${d.getDate()}`
              : `${String(d.getHours()).padStart(2, '0')}:00`
          },
        },
      },
      dataZoom: [
        { type: 'inside', start: startPct, end: 100, zoomOnMouseWheel: 'shift', moveOnMouseWheel: false },
        {
          type: 'slider', start: startPct, end: 100, height: 22, bottom: 12,
          backgroundColor: 'transparent',
          borderColor: c.axis,
          fillerColor: mode === 'dark' ? 'rgba(57,135,229,0.12)' : 'rgba(42,120,214,0.10)',
          handleStyle: { color: c.surface, borderColor: c.textMuted },
          moveHandleStyle: { color: c.axis },
          dataBackground: { lineStyle: { color: c.axis, width: 1 }, areaStyle: { opacity: 0 } },
          selectedDataBackground: { lineStyle: { color: s.actual, width: 1 }, areaStyle: { opacity: 0.08 } },
          textStyle: { color: c.textMuted, fontSize: 10 },
          labelFormatter: (_: number, v: string) => {
            const d = new Date(v)
            return `${d.getMonth() + 1}/${d.getDate()}`
          },
        },
      ],
      series,
    }
  }, [channel, mode, intervalLevel, showBaseline])

  return <EChart option={option} height={height} />
}
