import type { ModelInfo } from '../api'
import { describeFinetune } from '../format'
import { Badge, Button } from './ui'
import type { Mode } from '../theme'

export default function TopBar({ model, mode, onToggleMode }: {
  model: ModelInfo | null; mode: Mode; onToggleMode: () => void
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-edge bg-surface-1 px-4">
      <div className="flex items-center gap-2.5">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden className="shrink-0">
          <rect width="32" height="32" rx="7" fill="var(--accent)" />
          <path d="M7 21.5 L12 13 L16.5 18.5 L20 10.5 L25 19"
            stroke="#fff" strokeWidth="2.1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="20" cy="10.5" r="2.4" fill="#fff" />
        </svg>
        <div className="leading-tight">
          <div className="text-[14px] font-semibold tracking-[0.01em] text-ink">NetAILLM</div>
          <div className="text-[10.5px] text-ink-3">无线网络流量预测平台</div>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {model && (
          <>
            <Badge tone={model.finetuned ? 'accent' : 'warning'}
              title={model.finetuned
                ? `已加载微调权重：${model.weights}${describeFinetune(model.finetune_meta, '\n')}`
                : `当前使用基座模型 ${model.base_model}；设置环境变量 NETAI_MODEL_PATH 指向微调权重目录（绝对路径）即可切换`}>
              {model.finetuned ? '微调权重' : '基座模型'}
            </Badge>
            <Badge tone="neutral" title={`推理设备：${model.device}`}>
              <span className="tnum">{model.device.toUpperCase()}</span>
            </Badge>
            <Badge tone={model.load_error ? 'critical' : model.loaded ? 'good' : 'neutral'}
              title={model.load_error ?? (model.loaded ? '模型已常驻内存' : '首次预测时加载模型')}>
              <span className={`h-1.5 w-1.5 rounded-full ${model.load_error ? 'bg-critical' : model.loaded ? 'bg-good' : 'bg-ink-3 pulse'}`}
                style={{ background: 'currentColor' }} />
              {model.load_error ? '加载失败' : model.loaded ? '就绪' : '待加载'}
            </Badge>
          </>
        )}
        <Button variant="ghost" onClick={onToggleMode} title="切换深色 / 浅色主题"
          className="!px-2">
          {mode === 'dark' ? '☾' : '☀'}
        </Button>
      </div>
    </header>
  )
}
