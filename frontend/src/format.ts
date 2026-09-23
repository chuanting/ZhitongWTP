/** 数值与时间格式化。display_scale 仅用于展示（如利用率 0–1 → %）。 */

export function scaleSeries(values: (number | null)[], scale: number): (number | null)[] {
  return scale === 1 ? values : values.map((v) => (v == null ? null : v * scale))
}

/** 按数量级选择小数位，避免小流量小区显示成一串 0。 */
export function formatValue(v: number | null | undefined, unit = ''): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  const digits = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 3 : 4
  const text = v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return unit ? `${text} ${unit}` : text
}

export function formatNumber(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function formatPercent(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(digits)}%`
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatTime(iso: string, withDate = true): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return withDate ? `${d.getMonth() + 1}月${d.getDate()}日 ${hm}` : hm
}

export function formatDateTimeFull(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 给 <input type="datetime-local"> 用的本地时间字符串。 */
export function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : value.length === 16 ? `${value}:00` : value
}

/** 相对基线的提升百分比：误差类指标越小越好。 */
export function improvement(model: number | null | undefined, base: number | null | undefined): number | null {
  if (model == null || base == null || !Number.isFinite(model) || !Number.isFinite(base) || base === 0) return null
  return ((base - model) / Math.abs(base)) * 100
}

export function describeWindow(hours: number, freqLabel: string): string {
  if (freqLabel !== '小时') return `${hours} 个${freqLabel}点`
  if (hours % 24 === 0) return `${hours} 小时（${hours / 24} 天）`
  return `${hours} 小时`
}

/** 后端频率别名 → 毫秒步长，用于在前端推算预测起点。 */
const STEP_MS: Record<string, number> = {
  min: 60_000,
  '15min': 900_000,
  '30min': 1_800_000,
  h: 3_600_000,
  D: 86_400_000,
  W: 604_800_000,
}

export function stepMillis(freq: string): number {
  return STEP_MS[freq] ?? 3_600_000
}

/** 把 finetune_meta.json 概括成一行人话，用于模型溯源展示。 */
export function describeFinetune(
  meta: { n_train_series?: number; num_steps?: number; batch_size?: number;
          learning_rate?: number; context_length?: number; prediction_length?: number;
          nets?: string[]; lora?: { r?: number; alpha?: number } } | null | undefined,
  prefix = ' · ',
): string {
  if (!meta) return ''
  const parts: string[] = []
  if (meta.lora?.r != null) parts.push(`LoRA r=${meta.lora.r}${meta.lora.alpha != null ? `/α=${meta.lora.alpha}` : ''}`)
  if (meta.nets?.length) parts.push(meta.nets.join(' + ').toUpperCase())
  if (meta.n_train_series != null) parts.push(`${meta.n_train_series.toLocaleString('zh-CN')} 条训练序列`)
  if (meta.num_steps != null) {
    const samples = meta.batch_size != null ? ` ≈ ${(meta.num_steps * meta.batch_size).toLocaleString('zh-CN')} 样本` : ''
    parts.push(`${meta.num_steps} 步${samples}`)
  }
  if (meta.learning_rate != null) parts.push(`lr ${meta.learning_rate}`)
  if (meta.context_length != null && meta.prediction_length != null) {
    parts.push(`训练窗口 ${meta.context_length}→${meta.prediction_length}`)
  }
  return parts.length ? prefix + parts.join(' · ') : ''
}
