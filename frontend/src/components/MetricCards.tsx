import type { ChannelResult } from '../api'
import { formatNumber, formatPercent, formatValue, improvement } from '../format'

function Delta({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[11px] text-ink-3">—</span>
  const better = value > 0
  const tone = Math.abs(value) < 1 ? 'text-ink-3' : better ? 'text-good' : 'text-critical'
  return (
    <span className={`tnum inline-flex items-center gap-0.5 text-[11px] font-medium ${tone}`}
      title={better ? '误差低于季节朴素基线' : '误差高于季节朴素基线'}>
      {better ? '↓' : '↑'}{Math.abs(value).toFixed(1)}%
    </span>
  )
}

function Tile({ name, hint, value, sub, delta }: {
  name: string; hint: string; value: string; sub?: string; delta?: number | null
}) {
  return (
    <div className="rounded-lg border border-edge bg-surface-1 px-3 py-2.5" title={hint}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium tracking-[0.03em] text-ink-3">{name}</span>
        {delta !== undefined && <Delta value={delta} />}
      </div>
      <div className="tnum mt-1 text-[22px] font-semibold leading-7 text-ink">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-ink-3">{sub ?? hint}</div>
    </div>
  )
}

/**
 * 核心指标卡。误差类指标同时给出相对「季节朴素基线」的改善幅度，
 * 单看绝对值无法判断模型好坏。
 */
export default function MetricCards({ channel }: { channel: ChannelResult }) {
  const m = channel.metrics
  const b = channel.baseline_metrics
  const unit = channel.info.unit
  const scale = channel.info.display_scale
  const sc = (v: number | null | undefined) => (v == null ? null : v * scale)

  if (!m) {
    return (
      <div className="rounded-lg border border-dashed border-edge bg-surface-1 px-4 py-6 text-center text-[12px] text-ink-2">
        当前为<span className="mx-1 font-medium text-ink">未来外推</span>模式，预测区间之后没有真实观测值，因此不计算评估指标。
        <div className="mt-1 text-[11px] text-ink-3">把「预测起点」前移到历史范围内即可进入回测评估模式。</div>
      </div>
    )
  }

  const nominal = m.interval_level ?? 80
  const covGap = m.coverage == null ? null : m.coverage - nominal

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
      <Tile name="MASE" hint="平均绝对缩放误差：以季节朴素法为 1.0，小于 1 即优于基线"
        value={formatNumber(m.mase, 3)}
        sub={m.mase == null ? '上下文不足' : m.mase < 1 ? `优于基线 ${(100 - m.mase * 100).toFixed(0)}%` : '未优于基线'}
        delta={improvement(m.mase, b?.mase)} />
      <Tile name="MAPE" hint="平均绝对百分比误差；接近零的观测点已剔除"
        value={formatPercent(m.mape, 2)}
        sub={m.mape_coverage != null && m.mape_coverage < 1
          ? `有效样本 ${(m.mape_coverage * 100).toFixed(0)}%`
          : `sMAPE ${formatPercent(m.smape, 2)}`}
        delta={improvement(m.mape, b?.mape)} />
      <Tile name="MAE" hint="平均绝对误差，与指标同量纲"
        value={formatValue(sc(m.mae), unit)}
        sub={`基线 ${formatValue(sc(b?.mae), unit)}`}
        delta={improvement(m.mae, b?.mae)} />
      <Tile name="RMSE" hint="均方根误差，对大偏差更敏感"
        value={formatValue(sc(m.rmse), unit)}
        sub={`基线 ${formatValue(sc(b?.rmse), unit)}`}
        delta={improvement(m.rmse, b?.rmse)} />
      <Tile name="R²" hint="决定系数：预测解释了多少真实波动，1 为完美"
        value={formatNumber(m.r2, 3)}
        sub={`相关系数 ${formatNumber(m.corr, 3)}`}
        delta={undefined} />
      <Tile name={`${nominal}% 区间覆盖率`}
        hint="真实值落入预测区间的比例；理想情况应接近名义水平"
        value={formatPercent(m.coverage, 1)}
        sub={covGap == null ? `WQL ${formatNumber(m.wql, 4)}`
          : `名义 ${nominal}%，偏差 ${covGap >= 0 ? '+' : ''}${covGap.toFixed(1)}pp`} />
    </div>
  )
}
