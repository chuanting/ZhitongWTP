import { useState } from 'react'
import { api } from '../api'
import { Alert, Button, Spinner } from './ui'

/** 共享口令登录页。只挡扫描器和误入者，不做用户体系。 */
export default function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!password.trim() || busy) return
    setBusy(true); setError(null)
    try {
      await api.login(password)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-surface-0 px-4 py-10">
      <div className="w-full max-w-[360px]">
        <div className="mb-6 flex items-center gap-3">
          <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden className="shrink-0">
            <rect width="32" height="32" rx="7" fill="var(--accent)" />
            <path d="M7 21.5 L12 13 L16.5 18.5 L20 10.5 L25 19" stroke="#fff" strokeWidth="2.1"
              fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="20" cy="10.5" r="2.4" fill="#fff" />
          </svg>
          <div className="leading-tight">
            <div className="text-[17px] font-semibold text-ink">NetAILLM</div>
            <div className="text-[11.5px] text-ink-3">无线网络流量预测平台</div>
          </div>
        </div>

        <form onSubmit={submit} className="rounded-lg border border-edge bg-surface-1 p-5">
          <label htmlFor="pw" className="mb-1.5 block text-[11px] font-medium tracking-[0.04em] text-ink-3">
            访问口令
          </label>
          <input
            id="pw" type="password" value={password} autoFocus autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} disabled={busy}
            placeholder="请输入管理员提供的口令"
            className="w-full rounded-md border border-edge bg-surface-2 px-3 py-2 text-[13px] text-ink
                       placeholder:text-ink-3 focus-visible:border-accent focus-visible:outline-none" />
          {error && <div className="mt-3"><Alert onClose={() => setError(null)}>{error}</Alert></div>}
          <Button type="submit" variant="primary" disabled={busy || !password.trim()}
            className="mt-4 w-full !py-2 !text-[13px]">
            {busy ? <><Spinner /> 验证中…</> : '进入'}
          </Button>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            本站为模型试用演示环境，推理在本地 GPU 完成，上传的数据不会发送到外部服务，
            并会在一段时间后自动清理。
          </p>
        </form>
      </div>
    </div>
  )
}
