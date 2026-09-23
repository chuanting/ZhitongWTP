/** 后端 API 客户端与类型定义。 */

export interface ChannelInfo {
  key: string
  label: string
  unit: string
  display_scale: number
  group: string
}

export interface QualityIssue {
  kind: 'replicated_tail' | 'gaps'
  severity: 'warning' | 'info'
  message: string
  points?: number
  period_label?: string
  clean_end?: string
  replicated_start?: string
  scope?: string
}

export interface Dataset {
  id: string
  name: string
  source: 'demo' | 'upload'
  channels: string[]
  channel_info: ChannelInfo[]
  rows: number
  start: string
  end: string
  freq: string
  freq_label: string
  season_period: number
  missing: Record<string, number>
  meta: Record<string, string>
  quality?: QualityIssue[]
}

export interface Defaults {
  context_length: number
  prediction_length: number
  quantiles: number[]
  max_context_length: number
  max_prediction_length: number
}

export interface Metrics {
  mae: number | null
  rmse: number | null
  mape: number | null
  mape_coverage: number | null
  smape: number | null
  mase: number | null
  wql: number | null
  r2: number | null
  corr: number | null
  bias: number | null
  coverage: number | null
  interval_level: number | null
  n: number
}

export interface ChannelResult {
  key: string
  info: ChannelInfo
  context: { timestamps: string[]; values: (number | null)[] }
  horizon: { timestamps: string[] }
  quantiles: Record<string, (number | null)[]>
  median: (number | null)[]
  actual: (number | null)[] | null
  baseline: (number | null)[] | null
  residuals: (number | null)[] | null
  metrics: Metrics | null
  baseline_metrics: Metrics | null
}

export interface FinetuneMeta {
  base_model?: string
  context_length?: number
  prediction_length?: number
  nets?: string[]
  n_train_series?: number
  num_steps?: number
  batch_size?: number
  learning_rate?: number
  lora?: { r?: number; alpha?: number; dropout?: number; target_modules?: string[] }
}

export interface AuthStatus {
  required: boolean
  authenticated: boolean
}

export interface ModelInfo {
  label: string
  base_model: string
  weights: string
  weights_input: string
  is_local: boolean
  finetuned: boolean
  finetune_meta: FinetuneMeta | null
  device: string
  device_note: string | null
  device_setting: string
  queue_depth: number
  max_queue: number
  loaded: boolean
  load_seconds: number | null
  load_error: string | null
  inference_seconds?: number
}

export interface ForecastResult {
  dataset: Dataset
  quality?: QualityIssue[]
  warnings?: QualityIssue[]
  model: ModelInfo
  config: {
    anchor: string
    context_length: number
    prediction_length: number
    quantiles: number[]
    interval_level: number
    season_period: number
    freq_label: string
    has_ground_truth: boolean
    truth_points: number
    mode: string
  }
  channels: ChannelResult[]
}

export interface ForecastRequest {
  dataset_id: string
  channels: string[]
  context_length?: number
  prediction_length?: number
  anchor?: string | null
  quantiles?: number[]
  baseline?: boolean
}

const BASE = '/api'

export class UnauthorizedError extends Error {}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `请求失败（HTTP ${res.status}）`
    try {
      const body = await res.json()
      if (typeof body?.detail === 'string') detail = body.detail
      else if (Array.isArray(body?.detail) && body.detail[0]?.msg) detail = body.detail[0].msg
    } catch { /* 响应体非 JSON，保留默认提示 */ }
    if (res.status === 401) throw new UnauthorizedError(detail)
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export const api = {
  authStatus: () => fetch(`${BASE}/auth/status`).then(handle<AuthStatus>),

  login: (password: string) =>
    fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }).then(handle<{ authenticated: boolean; expires_in: number }>),

  logout: () => fetch(`${BASE}/auth/logout`, { method: 'POST' }).then(handle<AuthStatus>),

  datasets: () =>
    fetch(`${BASE}/datasets`).then(handle<{ datasets: Dataset[]; defaults: Defaults }>),

  model: () => fetch(`${BASE}/model`).then(handle<ModelInfo>),

  series: (id: string, channel: string, maxPoints = 1200) =>
    fetch(`${BASE}/datasets/${id}/series?channel=${encodeURIComponent(channel)}&max_points=${maxPoints}`)
      .then(handle<{ timestamps: string[]; values: (number | null)[]; downsampled: boolean; source_points: number }>),

  forecast: (req: ForecastRequest) =>
    fetch(`${BASE}/forecast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }).then(handle<ForecastResult>),

  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/datasets/upload`, { method: 'POST', body: fd })
      .then(handle<{ dataset: Dataset; notes: string[] }>)
  },

  remove: (id: string) =>
    fetch(`${BASE}/datasets/${id}`, { method: 'DELETE' }).then(handle<{ deleted: string }>),

  exportUrl: `${BASE}/forecast/export`,
}

/** 导出 CSV：后端返回附件流，这里触发浏览器下载。 */
export async function downloadCsv(req: ForecastRequest) {
  const res = await fetch(api.exportUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error('导出失败')
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const match = /filename="?([^"]+)"?/.exec(disposition)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = match?.[1] ?? 'netaillm_forecast.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
