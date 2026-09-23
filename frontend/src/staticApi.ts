/**
 * 静态展示模式的数据层。
 *
 * GitHub Pages 只能托管静态文件，跑不了模型推理，因此所有预测结果由
 * scripts/build_static_demo.py 离线算好写成 JSON，这里按需加载并拼装成
 * 与在线 API 完全一致的结构，界面组件无需区分两种模式。
 */
import type {
  AuthStatus, ChannelResult, Dataset, Defaults, ForecastRequest,
  ForecastResult, ModelInfo,
} from './api'

export interface StaticScenario {
  id: string
  anchor: string
  prediction_length: number
  offset_hours: number
}

interface ManifestDataset {
  id: string; name: string; cell: string; scene: string; band: string; blurb: string
  channels: string[]; channel_info: Dataset['channel_info']
  rows: number; start: string; end: string
  freq: string; freq_label: string; season_period: number
  scenarios: StaticScenario[]
}

interface Manifest {
  generated_at: string
  model: { label: string; base_model: string; finetuned: boolean; finetune_meta: ModelInfo['finetune_meta'] }
  context_length: number
  horizons: number[]
  quantiles: number[]
  data_note: string
  datasets: ManifestDataset[]
}

const BASE = `${import.meta.env.BASE_URL}demo-data`

let manifestPromise: Promise<Manifest> | null = null
const cache = new Map<string, unknown>()

async function load<T>(path: string): Promise<T> {
  const hit = cache.get(path)
  if (hit) return hit as T
  const res = await fetch(`${BASE}/${path}`)
  if (!res.ok) throw new Error(`加载演示数据失败：${path}`)
  const data = (await res.json()) as T
  cache.set(path, data)
  return data
}

function manifest(): Promise<Manifest> {
  manifestPromise ??= load<Manifest>('manifest.json')
  return manifestPromise
}

function toDataset(d: ManifestDataset): Dataset {
  return {
    id: d.id, name: d.name, source: 'demo',
    channels: d.channels, channel_info: d.channel_info,
    rows: d.rows, start: d.start, end: d.end,
    freq: d.freq, freq_label: d.freq_label, season_period: d.season_period,
    missing: {},
    meta: {
      cgi: d.cell, scene: d.scene, band: d.band, blurb: d.blurb,
      vendor: '—', region: '已脱敏', network: '5G NR',
    },
  }
}

/** 静态模式下可选的预测场景，供配置面板渲染成下拉而非任意时刻输入。 */
export async function scenariosFor(datasetId: string): Promise<StaticScenario[]> {
  const m = await manifest()
  return m.datasets.find((d) => d.id === datasetId)?.scenarios ?? []
}

export async function staticNote(): Promise<string> {
  return (await manifest()).data_note
}

/** 选出与请求最接近的已预计算场景：先匹配步长，再取锚点最近的一个。 */
function pickScenario(list: StaticScenario[], req: ForecastRequest): StaticScenario | undefined {
  if (!list.length) return undefined
  const horizon = req.prediction_length ?? 24
  const sameHorizon = list.filter((s) => s.prediction_length === horizon)
  const pool = sameHorizon.length ? sameHorizon : list
  if (!req.anchor) return pool[0]
  const target = new Date(req.anchor).getTime()
  return pool.reduce((best, s) =>
    Math.abs(new Date(s.anchor).getTime() - target) < Math.abs(new Date(best.anchor).getTime() - target)
      ? s : best)
}

export const staticApi = {
  authStatus: async (): Promise<AuthStatus> => ({ required: false, authenticated: true }),
  login: async () => ({ authenticated: true, expires_in: 0 }),
  logout: async (): Promise<AuthStatus> => ({ required: false, authenticated: true }),

  model: async (): Promise<ModelInfo> => {
    const m = await manifest()
    return {
      label: m.model.label, base_model: m.model.base_model,
      weights: m.model.finetuned ? 'Zhitong_SDU_WT_LLM（离线预计算）' : m.model.base_model,
      weights_input: '', is_local: false, finetuned: m.model.finetuned,
      finetune_meta: m.model.finetune_meta,
      device: 'offline', device_note: null, device_setting: 'offline',
      queue_depth: 0, max_queue: 0, loaded: true, load_seconds: null, load_error: null,
    }
  },

  datasets: async (): Promise<{ datasets: Dataset[]; defaults: Defaults }> => {
    const m = await manifest()
    return {
      datasets: m.datasets.map(toDataset),
      defaults: {
        context_length: m.context_length,
        prediction_length: m.horizons[0],
        quantiles: m.quantiles,
        max_context_length: m.context_length,
        max_prediction_length: Math.max(...m.horizons),
      },
    }
  },

  series: async (id: string, channel: string) => {
    const ov = await load<{
      timestamps: string[]; channels: Record<string, (number | null)[]>; source_points: number
    }>(`overview_${id}.json`)
    return {
      timestamps: ov.timestamps,
      values: ov.channels[channel] ?? [],
      downsampled: ov.source_points > ov.timestamps.length,
      source_points: ov.source_points,
    }
  },

  forecast: async (req: ForecastRequest): Promise<ForecastResult> => {
    const m = await manifest()
    const meta = m.datasets.find((d) => d.id === req.dataset_id)
    if (!meta) throw new Error('演示数据中没有该数据集')
    const sc = pickScenario(meta.scenarios, req)
    if (!sc) throw new Error('该数据集没有预计算的演示场景')

    const file = await load<{ config: ForecastResult['config']; channels: ChannelResult[] }>(
      `forecasts/${sc.id}.json`)
    const wanted = new Set(req.channels)
    const channels = file.channels.filter((c) => wanted.has(c.key))

    return {
      dataset: toDataset(meta),
      model: await staticApi.model(),
      config: file.config,
      channels: channels.length ? channels : file.channels,
      warnings: [],
      quality: [],
    }
  },

  upload: async (): Promise<never> => {
    throw new Error('这是静态演示版，没有后端可以处理上传。要用自己的数据测试，请参照仓库说明在本地或服务器上部署完整版。')
  },
  remove: async (): Promise<never> => {
    throw new Error('静态演示版不支持删除数据集。')
  },
}
