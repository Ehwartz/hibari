// 复盘摘要 (replay): a drawer on the right of the table with the agreement, the bad moves, and every decision
// where you differed from the AI; a row jumps to that step. Also the marks on the replay's progress bar.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Review, ReviewDecision } from '../lib/api'
import type { MjaiEvent } from '../lib/mjai'
import { WIND_NAME } from '../lib/tiles'
import { Tile } from './Tile'

/** A bad move: the AI gave your choice less than 5 % (as the backend counts them). */
export const BAD_PROB = 0.05

/** How much worse your choice was than the AI's, in Q (its value estimate). */
export const gapOf = (d: ReviewDecision) => (d.q[d.best] ?? 0) - (d.q[d.actual] ?? d.q[d.best] ?? 0)

/** "东2局 1本场 5巡" for the decision replying to event `index`. */
export function where(events: MjaiEvent[], index: number, seat: number): string {
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

const CALL_NAME: Record<string, string> = {
  reach: '立直',
  chi_low: '吃',
  chi_mid: '吃',
  chi_high: '吃',
  pon: '碰',
  kan_select: '杠',
  hora: '和',
  ryukyoku: '流局',
  none: '跳过',
}

/** 「打 [tile]」 or the call's name. */
function Move({ label }: { label: string }) {
  if (CALL_NAME[label]) return <>{CALL_NAME[label]}</>
  return (
    <span className="inline-flex items-center gap-1">
      打<Tile tile={label} w={16} />
    </span>
  )
}

type Order = 'loss' | 'time' | 'bad'

export function ReviewDrawer({
  review,
  events,
  index,
  onJump,
  onClose,
}: {
  review: Review
  events: MjaiEvent[]
  index: number
  onJump: (index: number) => void
  onClose: () => void
}) {
  const [order, setOrder] = useState<Order>('loss')
  const s = review.summary
  const rows = useMemo(() => {
    const out = review.decisions
      .filter((d) => !d.match && (order !== 'bad' || d.actual_prob < BAD_PROB))
      .map((d) => ({ d, gap: gapOf(d), at: where(events, d.index, review.human) }))
    return order === 'time' ? out : out.sort((a, b) => b.gap - a.gap)
  }, [review, events, order])

  // keep the current step's row in view while stepping through the replay
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('[data-current]')?.scrollIntoView({ block: 'nearest' })
  }, [index, order])

  const stat = (label: string, value: React.ReactNode, cls = '') => (
    <div className="rounded-lg bg-white/5 px-2.5 py-1.5">
      <div className="text-[11px] text-white/50">{label}</div>
      <div className={`font-mono text-[18px] font-bold ${cls}`}>{value}</div>
    </div>
  )
  return (
    <div
      className="absolute top-0 right-0 bottom-0 z-40 flex w-[340px] flex-col bg-[#06100b]/95 p-3.5 text-white shadow-[-14px_0_32px_rgba(0,0,0,0.45)]"
      data-noadvance
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="flex items-center">
        <span className="text-[15px] font-bold">复盘摘要</span>
        <button className="ml-auto rounded-md px-2 py-0.5 text-white/60 hover:bg-white/10 hover:text-white" onClick={onClose} title="收起">
          ✕
        </button>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {stat(
          '一致率',
          <>
            {s.rate === null ? '—' : `${(s.rate * 100).toFixed(1)}%`}
            <span className="ml-1 text-[11px] font-normal text-white/45">
              {s.matches}/{s.decisions}
            </span>
          </>,
          'text-emerald-300',
        )}
        {stat('恶手', s.bad, s.bad ? 'text-rose-300' : 'text-emerald-300')}
        {stat('不一致', s.decisions - s.matches)}
      </div>
      <div className="mt-3 flex gap-1.5 text-[12px]">
        {(
          [
            ['loss', '按损失'],
            ['time', '按顺序'],
            ['bad', '只看恶手'],
          ] as [Order, string][]
        ).map(([o, name]) => (
          <button
            key={o}
            onClick={() => setOrder(o)}
            className={`rounded-full px-2.5 py-0.5 ${order === o ? 'bg-white/20 text-white' : 'bg-white/5 text-white/55 hover:bg-white/10'}`}
          >
            {name}
          </button>
        ))}
      </div>
      <div ref={list} className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
        {rows.length === 0 && <div className="py-6 text-center text-[13px] text-white/45">没有和 AI 不一致的地方</div>}
        {rows.map(({ d, gap, at }) => {
          const current = d.index === index
          return (
            <button
              key={d.index}
              data-current={current || undefined}
              onClick={() => onJump(d.index)}
              className={`grid w-full grid-cols-[78px_1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${current ? 'bg-emerald-500/15 shadow-[inset_2px_0_0_#34d399]' : 'hover:bg-white/10'}`}
            >
              <span className="text-white/55">{at}</span>
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span>
                  你 <Move label={d.actual} />
                </span>
                <span className="text-white/30">→</span>
                <span className="text-amber-200">
                  AI <Move label={d.best} />
                </span>
              </span>
              <span className={`font-mono tabular-nums ${d.actual_prob < BAD_PROB ? 'text-rose-300' : 'text-amber-300'}`}>
                −{gap.toFixed(2)}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-2 text-[11px] leading-snug text-white/40">数字是 Q 差：你的选择比 AI 首选差多少（AI 的价值估计之差，不是点数）。红色是恶手。</div>
    </div>
  )
}

/** Marks on the replay's progress bar: bad moves red, other differences amber; a mark jumps there. */
export function ReviewTicks({ review, last, onJump }: { review: Review; last: number; onJump: (index: number) => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-[8px] top-1/2 h-0">
      {review.decisions
        .filter((d) => !d.match)
        .map((d) => (
          <button
            key={d.index}
            onClick={() => onJump(d.index)}
            title={`第 ${d.index} 步`}
            className={`pointer-events-auto absolute top-[-7px] h-[14px] w-[3px] -translate-x-1/2 rounded-sm hover:w-[5px] ${d.actual_prob < BAD_PROB ? 'bg-rose-500' : 'bg-amber-400'}`}
            style={{ left: `${(d.index / Math.max(1, last)) * 100}%` }}
          />
        ))}
    </div>
  )
}
