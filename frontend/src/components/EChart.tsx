import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import {
  DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent,
  MarkLineComponent, TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'

echarts.use([
  LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent,
  DataZoomComponent, MarkLineComponent, MarkAreaComponent, CanvasRenderer,
])

/**
 * ECharts 容器。用 ResizeObserver 跟随布局变化，配置变更时 notMerge 重建，
 * 避免切换数据集后残留上一次的系列。
 */
export default function EChart({ option, height, className = '' }: {
  option: EChartsOption
  height: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const instance = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    chart.current = instance
    const ro = new ResizeObserver(() => instance.resize())
    ro.observe(ref.current)
    return () => { ro.disconnect(); instance.dispose(); chart.current = null }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])

  useEffect(() => { chart.current?.resize() }, [height])

  return <div ref={ref} className={className} style={{ height, width: '100%' }} />
}
