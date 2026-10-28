// 进张分析: a centered window listing, per discard, the shanten and the draws that improve it, with how
// many of each are left after the tiles you can see (rivers, melds, dora indicators, your hand).

import { useEffect, useState } from 'react'
import { type UkeireResult, api } from '../lib/api'
import type { TableState } from '../lib/table'
import { kind } from '../lib/tiles'
import { Tile } from './Tile'

/** Tiles seen outside `me`'s concealed hand, per kind (called discards are counted in the melds). */
export function visibleCounts(table: TableState): number[] {
  const counts = new Array(34).fill(0)
  const add = (t: string) => {
    if (t && t !== '?') counts[kind(t)]++
  }
  for (const s of table.seats) {
    for (const r of s.river) if (!r.called) add(r.pai)
    for (const m of s.melds) {
      if (m.type === 'pon' || m.type === 'chi') [...m.consumed, m.pai!].forEach(add)
      else counts[kind(m.consumed[0] ?? m.pai!)] += 4 // any kan shows all four
    }
  }
  table.doraMarkers.forEach(add)
  return counts
}

const shantenText = (n: number) => (n < 0 ? '和了' : n === 0 ? '听牌' : `${n} 向听`)

export function UkeirePanel({ table, onClose }: { table: TableState; onClose: () => void }) {
  const me = table.human
  const seat = table.seats[me]
  const hand = [...seat.hand, ...(seat.drawn ? [seat.drawn] : [])]
  const key = JSON.stringify([hand, visibleCounts(table)])
  const [result, setResult] = useState<UkeireResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // recompute whenever your hand or the visible tiles change
  useEffect(() => {
    const [h, v] = JSON.parse(key) as [string[], number[]]
    if (!h.length || h.length % 3 === 0) {
      setResult(null)
      return
    }
    let live = true
    api
      .ukeire(h, v)
      .then((r) => live && (setResult(r), setError(null)))
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [key])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const best = result?.options[0]
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-[min(760px,100%)] flex-col rounded-2xl bg-[#11201a] text-white shadow-2xl ring-1 ring-white/15"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3.5">
          <span className="text-[17px] font-bold">进张分析</span>
          <span className="text-[12px] text-white/50">剩余枚数已扣除可见的牌：牌河、副露、宝牌指示牌和你的手牌</span>
          <span className="flex-1" />
          <button className="rounded-md px-2 py-1 text-white/60 hover:bg-white/10 hover:text-white" onClick={onClose} title="关闭 (Esc)">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-3">
          {error && <div className="py-6 text-center text-rose-300">分析失败：{error}</div>}
          {!error && !result && <div className="py-6 text-center text-white/50">{hand.length % 3 === 0 ? '鸣牌后等待打牌…' : '计算中…'}</div>}
          {result?.options.map((o, i) => {
            const top = !!best && o.shanten === best.shanten && o.total === best.total
            return (
              <div
                key={o.discard ?? 'hand'}
                className={`flex items-start gap-4 border-b border-white/5 py-3 last:border-0 ${top ? 'rounded-lg bg-emerald-500/10 px-2' : 'px-2'}`}
              >
                {o.discard ? (
                  <div className="flex w-[74px] shrink-0 flex-col items-center gap-1">
                    <span className="text-[11px] text-white/50">打</span>
                    <Tile tile={o.discard} w={34} />
                  </div>
                ) : (
                  <div className="w-[74px] shrink-0 pt-1 text-center text-[12px] text-white/50">当前手牌</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className={`text-[15px] font-bold ${o.shanten <= 0 ? 'text-amber-300' : ''}`}>{shantenText(o.shanten)}</span>
                    <span className="text-[14px]">
                      进张 <b className="tabular-nums">{o.tiles.length}</b> 种 <b className="tabular-nums">{o.total}</b> 枚
                    </span>
                    {top && i === 0 && result.discard && <span className="text-[12px] text-emerald-300">最多进张</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {o.tiles.map((t) => (
                      <div key={t.tile} className="flex flex-col items-center gap-0.5">
                        <Tile tile={t.tile} w={26} />
                        <span className={`font-mono text-[11px] tabular-nums ${t.left <= 1 ? 'text-rose-300' : 'text-white/60'}`}>×{t.left}</span>
                      </div>
                    ))}
                    {o.tiles.length === 0 && <span className="text-[12px] text-white/40">没有能减少向听的进张</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
