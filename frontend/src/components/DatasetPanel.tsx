import { useRef, useState } from 'react'
import type { Dataset } from '../api'
import { api } from '../api'
import { Alert, Badge, SectionTitle, Spinner } from './ui'
import { formatDateTimeFull } from '../format'

function Row({ ds, active, onSelect, onDelete }: {
  ds: Dataset; active: boolean; onSelect: () => void; onDelete?: () => void
}) {
  return (
    <div
      role="button" tabIndex={0} onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={`group relative w-full cursor-pointer rounded-md border px-2.5 py-2 text-left transition-colors
        ${active ? 'border-accent/55 bg-[var(--accent-soft)]' : 'border-edge bg-surface-2 hover:border-edge-strong'}`}>
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-accent' : 'bg-edge-strong'}`} />
        <span className="truncate text-[12.5px] font-medium text-ink">{ds.name}</span>
        {ds.source === 'demo' ? (
          <Badge tone="neutral">{ds.meta.band}</Badge>
        ) : (
          <Badge tone="accent">已上传</Badge>
        )}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="ml-auto shrink-0 rounded px-1 text-[12px] text-ink-3 opacity-0 transition-opacity
                       hover:text-critical group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={`删除 ${ds.name}`} title="删除该数据集">✕</button>
        )}
      </div>
      <div className="mt-1 pl-3.5 text-[11px] leading-relaxed text-ink-3">
        <div className="truncate">{ds.meta.blurb}</div>
        <div className="tnum mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
          <span>{ds.rows.toLocaleString('zh-CN')} 点</span>
          <span className="text-edge-strong">·</span>
          <span>{ds.freq_label}粒度</span>
          <span className="text-edge-strong">·</span>
          <span>{ds.start.slice(0, 10)} ~ {ds.end.slice(0, 10)}</span>
        </div>
      </div>
    </div>
  )
}

export default function DatasetPanel({ datasets, selectedId, onSelect, onUploaded, onDeleted }: {
  datasets: Dataset[]
  selectedId: string
  onSelect: (id: string) => void
  onUploaded: (ds: Dataset, notes: string[]) => void
  onDeleted: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const demos = datasets.filter((d) => d.source === 'demo')
  const uploads = datasets.filter((d) => d.source === 'upload')

  async function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setBusy(true); setError(null)
    try {
      const { dataset, notes } = await api.upload(file)
      onUploaded(dataset, notes)
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove(ds: Dataset) {
    if (!confirm(`确定删除数据集「${ds.name}」？`)) return
    try { await api.remove(ds.id); onDeleted(ds.id) } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  const selected = datasets.find((d) => d.id === selectedId)

  return (
    <div>
      <SectionTitle title="数据源" hint={`${datasets.length} 个数据集`} />

      <div className="space-y-1.5">
        {demos.map((ds) => (
          <Row key={ds.id} ds={ds} active={ds.id === selectedId} onSelect={() => onSelect(ds.id)} />
        ))}
      </div>

      {uploads.length > 0 && (
        <>
          <div className="mt-3.5 mb-1.5 text-[11px] font-medium tracking-[0.04em] text-ink-3">我的数据</div>
          <div className="space-y-1.5">
            {uploads.map((ds) => (
              <Row key={ds.id} ds={ds} active={ds.id === selectedId}
                onSelect={() => onSelect(ds.id)} onDelete={() => remove(ds)} />
            ))}
          </div>
        </>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.click() }}
        className={`mt-3 cursor-pointer rounded-md border border-dashed px-3 py-3.5 text-center transition-colors
          ${drag ? 'border-accent bg-[var(--accent-soft)]' : 'border-edge-strong bg-surface-2 hover:border-accent/50'}`}>
        <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => handleFiles(e.target.files)} />
        {busy ? (
          <div className="flex items-center justify-center gap-2 text-[12px] text-ink-2">
            <Spinner /> 正在解析…
          </div>
        ) : (
          <>
            <div className="text-[12px] font-medium text-ink">上传 CSV 数据</div>
            <div className="mt-1 text-[11px] leading-relaxed text-ink-3">
              拖拽文件到此处或点击选择<br />
              需含时间列（timestamp / time / date / dt）与至少一列数值指标
            </div>
          </>
        )}
      </div>

      {error && <div className="mt-2"><Alert onClose={() => setError(null)}>{error}</Alert></div>}

      {selected && (
        <div className="mt-3.5 rounded-md border border-edge bg-surface-2 px-2.5 py-2 text-[11px] leading-relaxed text-ink-3">
          <div className="mb-1 font-medium text-ink-2">当前数据集</div>
          {selected.source === 'demo' && (
            <div className="mb-1 flex flex-wrap gap-1">
              <Badge>{selected.meta.scene}</Badge>
              <Badge>{selected.meta.vendor}</Badge>
              <Badge>{selected.meta.network}</Badge>
            </div>
          )}
          <div className="tnum">
            {formatDateTimeFull(selected.start)} — {formatDateTimeFull(selected.end)}
          </div>
          <div className="tnum mt-0.5">
            {selected.channels.length} 个指标 · 季节周期 {selected.season_period} 点
          </div>
          {selected.source === 'demo' && (
            <div className="mt-1 break-all opacity-80">CGI {selected.meta.cgi}</div>
          )}
        </div>
      )}
    </div>
  )
}
