/**
 * 设计令牌。配色取自经过 CVD（色觉障碍）校验的调色板：
 * 三条数据系列 blue → orange → aqua，深浅两套均通过对比度与可分辨性检查。
 */
export type Mode = 'dark' | 'light'

export const SERIES = {
  dark:  { actual: '#3987e5', forecast: '#d95926', baseline: '#199e70' },
  light: { actual: '#2a78d6', forecast: '#eb6834', baseline: '#1baf7a' },
} as const

export const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' } as const

export const CHART = {
  dark: {
    surface: '#1a1a19',
    grid: '#2b2b29',
    axis: '#3a3a37',
    textPrimary: '#ffffff',
    textSecondary: '#c3c2b7',
    textMuted: '#8a897e',
    tooltipBg: 'rgba(26,26,25,0.96)',
    bandOpacity: 0.16,
  },
  light: {
    surface: '#fcfcfb',
    grid: '#eceae5',
    axis: '#d5d3cd',
    textPrimary: '#0b0b0b',
    textSecondary: '#52514e',
    textMuted: '#7a7972',
    tooltipBg: 'rgba(252,252,251,0.97)',
    bandOpacity: 0.18,
  },
} as const

export function readMode(): Mode {
  const stored = (() => {
    try { return localStorage.getItem('netaillm-theme') } catch { return null }
  })()
  if (stored === 'dark' || stored === 'light') return stored
  return 'dark'
}

export function applyMode(mode: Mode) {
  document.documentElement.setAttribute('data-theme', mode)
  try { localStorage.setItem('netaillm-theme', mode) } catch { /* 隐私模式下忽略 */ }
}
