import type { EChartsOption } from 'echarts'
import { CHART, type Mode } from '../theme'
import { formatDateTimeFull, formatValue } from '../format'

/** 各图共享的坐标轴 / 网格 / 提示框底座：细发丝网格、弱化轴线。 */
export function baseOption(mode: Mode, opts: {
  unit: string
  gridTop?: number
  gridBottom?: number
  gridLeft?: number
  showXLabel?: boolean
}): EChartsOption {
  const c = CHART[mode]
  return {
    backgroundColor: 'transparent',
    animationDuration: 260,
    grid: {
      top: opts.gridTop ?? 28,
      bottom: opts.gridBottom ?? 34,
      left: opts.gridLeft ?? 56,
      right: 18,
      containLabel: false,
    },
    textStyle: { fontFamily: 'Inter, "PingFang SC", system-ui, sans-serif' },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      axisLine: { lineStyle: { color: c.axis, width: 1 } },
      axisTick: { show: false },
      axisLabel: {
        show: opts.showXLabel ?? true,
        color: c.textMuted,
        fontSize: 11,
        hideOverlap: true,
        margin: 10,
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      name: opts.unit || undefined,
      nameTextStyle: { color: c.textMuted, fontSize: 10, align: 'right', padding: [0, 4, 6, 0] },
      nameGap: 10,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: c.textMuted, fontSize: 11, margin: 8 },
      splitLine: { lineStyle: { color: c.grid, width: 1, type: 'solid' } },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: c.tooltipBg,
      borderColor: c.axis,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: c.textPrimary, fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: c.axis, width: 1 } },
      extraCssText: 'backdrop-filter:blur(6px);border-radius:6px;box-shadow:none;',
    },
  }
}

/** 统一的提示框内容：时间 + 每个系列的色块、名称、数值。 */
export function tooltipFormatter(unit: string) {
  return (params: unknown) => {
    const list = (Array.isArray(params) ? params : [params]) as {
      axisValue: string; seriesName: string; value: number | null; color: string; seriesType: string
    }[]
    if (!list.length) return ''
    const head = `<div style="font-size:11px;opacity:.7;margin-bottom:5px">${formatDateTimeFull(list[0].axisValue)}</div>`
    const rows = list
      .filter((p) => p.value != null && p.seriesName && !p.seriesName.startsWith('__'))
      .map((p) => `<div style="display:flex;align-items:center;gap:7px;line-height:19px">
          <span style="width:8px;height:2px;border-radius:1px;background:${p.color};flex:none"></span>
          <span style="opacity:.8">${p.seriesName}</span>
          <span style="margin-left:auto;font-variant-numeric:tabular-nums;font-weight:600">${formatValue(p.value, unit)}</span>
        </div>`)
      .join('')
    return head + rows
  }
}
