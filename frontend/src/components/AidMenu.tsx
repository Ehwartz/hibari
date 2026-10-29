// The 辅助 button of the game / replay toolbar: a small panel of on/off switches for the display aids.

import { useEffect, useRef, useState } from 'react'
import type { Aids } from '../lib/aids'

export interface AidRow {
  label: string
  on: boolean
  set: (on: boolean) => void
}

const AID_LABELS: [keyof Aids, string][] = [
  ['sameTile', '同牌高亮'],
  ['waits', '听牌提示'],
  ['furiten', '振听提示'],
  ['danger', '铳率'],
]

function Switch({ on }: { on: boolean }) {
  return (
    <span className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-white/20'}`}>
      <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all ${on ? 'left-4' : 'left-[2px]'}`} />
    </span>
  )
}

/** `extra`: page-specific switches (the replay's 明牌 / 摸切明暗), listed after a divider. */
export function AidMenu({ aids, setAid, extra = [] }: { aids: Aids; setAid: (name: keyof Aids, on: boolean) => void; extra?: AidRow[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const rows: AidRow[] = AID_LABELS.map(([name, label]) => ({ label, on: aids[name], set: (on) => setAid(name, on) }))
  const count = [...rows, ...extra].filter((r) => r.on).length
  const row = (r: AidRow) => (
    <button
      key={r.label}
      onClick={() => r.set(!r.on)}
      className="flex w-full items-center justify-between gap-6 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-white/10"
    >
      {r.label}
      <Switch on={r.on} />
    </button>
  )
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold ${open ? 'bg-white/25' : 'bg-white/10 hover:bg-white/20'}`}
      >
        辅助
        <span className="min-w-[18px] rounded-full bg-emerald-400 px-1 text-center text-[11px] text-black">{count}</span>
        <span className="text-white/60">▾</span>
      </button>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-[180px] rounded-xl bg-[#13241c] p-1.5 text-white shadow-2xl ring-1 ring-white/15">
          {rows.map(row)}
          {extra.length > 0 && <div className="mx-2 my-1 h-px bg-white/10" />}
          {extra.map(row)}
        </div>
      )}
    </div>
  )
}
