// End-of-game review summary (终局画面): agreement with the AI, bad moves, and the costliest decisions, each a
// link to that step of the replay. Runs the review itself when 对局结束后自动复盘 is on, with its progress.

import { useEffect, useState } from 'react'
import { type Review, type ReviewDecision, api } from '../lib/api'
import type { MjaiEvent } from '../lib/mjai'
import { WIND_NAME } from '../lib/tiles'
import { labelName } from './ReplayViewer'

/** How much worse your choice was than the AI's, in Q (its value estimate). */
const gapOf = (d: ReviewDecision) => (d.q[d.best] ?? 0) - (d.q[d.actual] ?? d.q[d.best] ?? 0)

/** "东2局 1本场 5巡" for the decision replying to event `index`. */
function where(events: MjaiEvent[], index: number, seat: number): string {
  let label = ''
  let turn = 0
  for (let i = 0; i <= index && i < events.length; i++) {
    const e = events[i]
    if (e.type === 'start_kyoku') {
      label = `${WIND_NAME[e.bakaze]}${e.kyoku}局${e.honba ? ` ${e.honba}本场` : ''}`
      turn = 0
    } else if (e.type === 'tsumo' && e.actor === seat) turn++
  }
  return turn ? `${label} ${turn}巡` : label
}

export function GameSummary({ gameId, saved, auto }: { gameId: string; saved: boolean; auto: boolean }) {
  const [review, setReview] = useState<Review | null>(null)
  const [events, setEvents] = useState<MjaiEvent[] | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<[number, number]>([0, 0])
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      setReview(await api.runReview(gameId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  // once the log is saved: an existing review, or a new one when auto-review is on
  useEffect(() => {
    if (!saved) return
    let live = true
    api
      .review(gameId)
      .then((r) => {
        if (!live) return
        if (r) setReview(r)
        else if (auto) run()
      })
      .catch(() => {
        if (live && auto) run()
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, gameId])

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => api.reviewProgress(gameId).then((p) => p.running && setProgress([p.done, p.total])).catch(() => {}), 400)
    return () => clearInterval(t)
  }, [running, gameId])

  useEffect(() => {
    if (review && !events) api.log(gameId).then((r) => setEvents(r.events)).catch(() => {})
  }, [review, events, gameId])

  if (!saved) return <div className="mt-5 text-center text-[13px] text-white/45">保存牌谱中…</div>
  if (running) {
    const [done, total] = progress
    return (
      <div className="mt-5">
        <div className="text-[13px] text-white/65">AI 复盘中… {total ? `${done} / ${total}` : ''}</div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-white/10">
          <div className="h-full rounded bg-emerald-400 transition-[width]" style={{ width: total ? `${(done / total) * 100}%` : '4%' }} />
        </div>
      </div>
    )
  }
  if (!review)
    return (
      <div className="mt-5 flex items-center gap-3">
        <button onClick={run} className="rounded-full bg-white/10 px-5 py-1.5 text-[14px] font-bold hover:bg-white/20">
          AI 复盘
        </button>
        {error && <span className="text-[13px] text-rose-300">复盘失败：{error}</span>}
      </div>
    )

  const s = review.summary
  const worst = review.decisions
    .filter((d) => !d.match)
    .map((d) => ({ d, gap: gapOf(d) }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5)
  return (
    <div className="mt-5 rounded-xl bg-white/5 px-4 py-3">
      <div className="flex items-baseline gap-5 text-[14px]">
        <span className="font-semibold">AI 复盘</span>
        <span>
          一致率 <b className="font-mono text-emerald-300">{s.rate === null ? '—' : `${(s.rate * 100).toFixed(1)}%`}</b>
          <span className="ml-1 text-[12px] text-white/45">
            {s.matches}/{s.decisions}
          </span>
        </span>
        <span>
          恶手 <b className={`font-mono ${s.bad ? 'text-rose-300' : 'text-emerald-300'}`}>{s.bad}</b>
        </span>
      </div>
      {worst.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[12px] text-white/45">损失最大的几手（点击跳到牌谱回放）</div>
          <div className="mt-1 flex flex-col">
            {worst.map(({ d, gap }) => (
              <a
                key={d.index}
                href={`#/replay/${gameId}?frame=${d.index}`}
                className="flex items-center gap-3 rounded-md px-2 py-1 text-[13px] hover:bg-white/10"
              >
                <span className="w-32 shrink-0 text-white/55">{events ? where(events, d.index, review.human) : ''}</span>
                <span className="flex-1">
                  你：{labelName(d.actual)}
                  <span className="mx-1.5 text-white/35">→</span>
                  <span className="text-amber-200">AI：{labelName(d.best)}</span>
                </span>
                <span className="font-mono text-rose-300 tabular-nums">−{gap.toFixed(2)}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
