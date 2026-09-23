import type { ReactNode } from 'react'

/** 卡片：全站统一的 1px 描边容器，不用阴影，保持工程化观感。 */
export function Card({ children, className = '', padded = true }: {
  children: ReactNode; className?: string; padded?: boolean
}) {
  return (
    <section className={`rounded-lg border border-edge bg-surface-1 ${padded ? 'p-4' : ''} ${className}`}>
      {children}
    </section>
  )
}

export function SectionTitle({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <div className="flex items-baseline gap-2 min-w-0">
        <h2 className="text-[13px] font-semibold tracking-[0.02em] text-ink">{title}</h2>
        {hint && <span className="truncate text-[11px] text-ink-3">{hint}</span>}
      </div>
      {right}
    </div>
  )
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-[11px] font-medium tracking-[0.04em] text-ink-3">{children}</span>
      {hint && <span className="tnum text-[11px] text-ink-2">{hint}</span>}
    </div>
  )
}

type Tone = 'neutral' | 'accent' | 'good' | 'warning' | 'critical'
const TONES: Record<Tone, string> = {
  neutral: 'border-edge text-ink-2 bg-surface-2',
  accent: 'border-accent/35 text-accent bg-[var(--accent-soft)]',
  good: 'border-good/35 text-good bg-good/10',
  warning: 'border-warning/40 text-warning bg-warning/10',
  critical: 'border-critical/35 text-critical bg-critical/10',
}

export function Badge({ children, tone = 'neutral', title }: {
  children: ReactNode; tone?: Tone; title?: string
}) {
  return (
    <span title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-4 ${TONES[tone]}`}>
      {children}
    </span>
  )
}

export function Button({ children, onClick, variant = 'secondary', disabled, className = '', title, type = 'button' }: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean
  className?: string
  title?: string
  type?: 'button' | 'submit'
}) {
  const styles = {
    primary: 'bg-accent text-white hover:brightness-110 border-transparent',
    secondary: 'bg-surface-2 text-ink border-edge hover:border-edge-strong hover:bg-surface-3',
    ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-surface-2 hover:text-ink',
  }[variant]
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px]
        font-medium transition-[background,border,filter] disabled:cursor-not-allowed disabled:opacity-45
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${styles} ${className}`}>
      {children}
    </button>
  )
}

/** 分段控件，用于互斥的少量选项。 */
export function Segmented<T extends string | number>({ value, options, onChange, className = '' }: {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={`inline-flex rounded-md border border-edge bg-surface-2 p-0.5 ${className}`} role="group">
      {options.map((o) => (
        <button key={String(o.value)} type="button" title={o.title} onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded px-2.5 py-1 text-[12px] font-medium transition-colors
            ${value === o.value ? 'bg-accent text-white' : 'text-ink-2 hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** 图例色块：颜色始终与文字标签同时出现，识别不依赖颜色本身。 */
export function Swatch({ color, dashed = false, area = false }: {
  color: string; dashed?: boolean; area?: boolean
}) {
  if (area) {
    return <span className="inline-block h-2.5 w-3.5 rounded-[2px]" style={{ background: color, opacity: 0.32 }} />
  }
  return (
    <span className="inline-block h-0 w-3.5 rounded-full"
      style={{ borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
  )
}

export function Alert({ tone = 'critical', title, children, onClose }: {
  tone?: 'critical' | 'warning' | 'accent'; title?: string; children: ReactNode; onClose?: () => void
}) {
  const ring = { critical: 'border-critical/40', warning: 'border-warning/40', accent: 'border-accent/35' }[tone]
  const ink = { critical: 'text-critical', warning: 'text-warning', accent: 'text-accent' }[tone]
  return (
    <div className={`rounded-md border ${ring} bg-surface-2 px-3 py-2 text-[12px] leading-relaxed`} role="alert">
      <div className="flex items-start gap-2">
        <span className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${ink}`} style={{ background: 'currentColor' }} />
        <div className="min-w-0 flex-1">
          {title && <div className={`font-medium ${ink}`}>{title}</div>}
          <div className="text-ink-2 break-words">{children}</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="shrink-0 text-ink-3 hover:text-ink" aria-label="关闭">✕</button>
        )}
      </div>
    </div>
  )
}
