// Step-through viewer for a recorded game (log replay, and the backend-free UI preview).
// Frames are full mjai events, optionally with the seat-0 decision (actions / hint / chosen).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Review, ReviewDecision } from '../lib/api'
import { useAids } from '../lib/aids'
import { computeDanger, tileRisks } from '../lib/danger'
import { type Action, type Hint, type MjaiEvent, maskEvent } from '../lib/mjai'
import { type TableState, applyEvent, initialTable } from '../lib/table'
import { WIND_NAME, kind, tileName } from '../lib/tiles'
import { furitenAfter, isFuriten, useWaits } from '../lib/waits'
import { useRonWaits } from '../lib/dealin'
import { AidMenu } from './AidMenu'
import { RYUKYOKU_NAME } from '../lib/labels'
import { seatAvatars, useAppSettings } from '../lib/appearance'
import { ActionBar, EndModal, HintPanel, ResultModal } from './Overlays'
import { playClack, playVoice, voiceFor } from '../lib/sound'
import { UkeirePanel } from './UkeirePanel'
import { ScaledStage } from './Stage'
import { type DiscardFx, Table, calloutFor } from './Table'

const CALL_HINT: Record<string, { type: Hint['type']; name: string }> = {
  reach: { type: 'reach', name: '立直' },
  chi_low: { type: 'chi', name: '吃' },
  chi_mid: { type: 'chi', name: '吃' },
  chi_high: { type: 'chi', name: '吃' },
  pon: { type: 'pon', name: '碰' },
  kan_select: { type: 'kan', name: '杠' },
  hora: { type: 'hora', name: '和' },
  ryukyoku: { type: 'ryukyoku', name: '流局' },
  none: { type: 'none', name: '跳过' },
}

/** Q-gap of an action vs the AI's choice ("0" for the choice itself), from a review decision. */
export function qGap(d: ReviewDecision, label: string): string {
  const gap = (d.q[d.best] ?? 0) - (d.q[label] ?? d.q[d.best] ?? 0)
  return gap < 0.005 ? '0' : `−${gap.toFixed(2)}`
}

/** An on/off switch kept in localStorage (on unless turned off). */
function useStoredSwitch(key: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(key) !== '0'
    } catch {
      return true
    }
  })
  const set = (v: boolean) => {
    setOn(v)
    try {
      localStorage.setItem(key, v ? '1' : '0')
    } catch {
      // storage blocked: only this page
    }
  }
  return [on, set]
}

/** Human-readable name of an AI (Mortal-style) action label. */
export function labelName(label: string): string {
  return CALL_HINT[label]?.name ?? `打 ${tileName(label)}`
}

/** The AI's top three options, plus what you did when it is not among them. */
export function reviewHints(d: ReviewDecision): Hint[] {
  const ranked = Object.entries(d.probs).sort((a, b) => b[1] - a[1])
  const shown = ranked.slice(0, 3)
  const yours = ranked.find(([label]) => label === d.actual)
  if (yours && !shown.includes(yours)) shown.push(yours)
  return shown
    .map(([label, prob]) =>
      CALL_HINT[label]
        ? { type: CALL_HINT[label].type, label, tiles: [], prob }
        : { type: 'dahai' as const, label, tiles: [label], prob },
    )
}

export interface Frame {
  event: MjaiEvent
  actions?: Action[]
  chosen?: Action
  hint?: Hint[]
}

/** The human's seat in a log (seat 0 in older logs). */
function humanSeat(frames: Frame[]): number {
  const start = frames[0]?.event
  return start?.type === 'start_game' ? (start.human ?? 0) : 0
}

function buildStates(frames: Frame[], open: boolean): TableState[] {
  const me = humanSeat(frames)
  const out: TableState[] = []
  let s = initialTable()
  for (const f of frames) {
    s = applyEvent(s, open ? f.event : maskEvent(f.event, me))
    out.push(s)
  }
  return out
}

function describe(ev: MjaiEvent, names: string[]): string {
  const who = 'actor' in ev ? names[ev.actor] : ''
  switch (ev.type) {
    case 'tsumo':
      return `${who} 摸牌${ev.pai !== '?' ? ` ${tileName(ev.pai)}` : ''}`
    case 'dahai':
      return `${who} 打 ${tileName(ev.pai)}${ev.tsumogiri ? '（摸切）' : ''}`
    case 'chi':
    case 'pon':
    case 'daiminkan':
      return `${who} ${{ chi: '吃', pon: '碰', daiminkan: '明杠' }[ev.type]} ${tileName(ev.pai)}`
    case 'ankan':
      return `${who} 暗杠`
    case 'kakan':
      return `${who} 加杠`
    case 'reach':
      return `${who} 立直`
    case 'hora':
      return `${who} ${ev.actor === ev.target ? '自摸' : '荣和'}`
    case 'reach_accepted':
      return `${who} 立直成立`
    case 'start_game':
      return '对局开始'
    case 'start_kyoku':
      return `${WIND_NAME[ev.bakaze]}${ev.kyoku}局 ${ev.honba}本场 开始`
    case 'dora':
      return `新宝牌指示牌 ${tileName(ev.dora_marker)}`
    case 'ryukyoku':
      return RYUKYOKU_NAME[ev.reason ?? 'exhaustive'] ?? '流局'
    case 'end_kyoku':
      return '本局结束'
    case 'end_game':
      return '终局'
  }
}

function actionLabel(a: Action): string {
  if (a.type === 'dahai') return `打 ${tileName(a.pai)}`
  if (a.type === 'none') return '跳过'
  return { reach: '立直', ryukyoku: '流局', hora: '和', chi: '吃', pon: '碰', daiminkan: '杠', ankan: '暗杠', kakan: '加杠' }[a.type]
}

// Start somewhere interesting: our first discard decision after a few turns, with someone in riichi if possible.
export function interestingFrame(frames: Frame[], states: TableState[] = buildStates(frames, false)): number {
  const isDecision = (i: number) => frames[i].actions?.some((a) => a.type === 'dahai')
  const turns = (i: number) => states[i].seats.reduce((n, s) => n + s.river.length, 0)
  const withRiichi = frames.findIndex((_, i) => isDecision(i) && turns(i) >= 24 && states[i].seats.some((s) => s.riichiAccepted))
  if (withRiichi >= 0) return withRiichi
  const busy = frames.findIndex((_, i) => isDecision(i) && turns(i) >= 24)
  return busy >= 0 ? busy : 0
}

interface Props {
  frames: Frame[]
  title: string
  backHref: string
  initialIndex?: number
  /** Show every hand (review) instead of seat 0's view. */
  defaultOpen?: boolean
  /** Extra header content (e.g. game info). */
  extra?: React.ReactNode
  /** AI review of this log (log replay only). */
  review?: Review | null
  onRunReview?: () => void
  reviewing?: boolean
}

export function ReplayViewer({
  frames,
  title,
  backHref,
  initialIndex = 0,
  defaultOpen = false,
  extra,
  review,
  onRunReview,
  reviewing,
}: Props) {
  const masked = useMemo(() => buildStates(frames, false), [frames])
  const open = useMemo(() => buildStates(frames, true), [frames])
  const settings = useAppSettings()
  const ai = settings?.ai_name || 'AI'
  const [index, setIndex] = useState(initialIndex)
  const [openHands, setOpenHands] = useState(defaultOpen)
  const [showHints, setShowHints] = useState(true)
  const [showTsumogiri, setShowTsumogiri] = useState(() => new URLSearchParams(location.search).has('review'))
  const [aids, setAid] = useAids() // shared with the game page
  // replay only: 铳牌 (tiles someone else could ron, in your hand and in open hands) and 别家听牌
  const [showDealIn, toggleDealIn] = useStoredSwitch('dealin')
  const [showOtherWaits, toggleOtherWaits] = useStoredSwitch('otherwaits')
  const [showUkeire, setShowUkeire] = useState(false)
  // AI numbers as probabilities, or as the q-gap to the AI's choice (how much worse each option is)
  const [qView, setQView] = useState(false)
  const lastWheel = useRef(0)
  // the header may wrap to two lines on a narrow window: the stage scales to its real height
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerH, setHeaderH] = useState(81)
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [playing, setPlaying] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const last = frames.length - 1
  const go = (i: number) => setIndex(Math.max(0, Math.min(last, i)))
  const frame = frames[index]
  const view = openHands ? open : masked
  const table = view[index]
  const ev = frame.event
  const discardFx: DiscardFx | null =
    ev.type === 'dahai' && index > 0
      ? { key: index, actor: ev.actor, pai: ev.pai, tsumogiri: ev.tsumogiri, prev: view[index - 1].seats[ev.actor] }
      : null
  const names = table.names
  const me = table.human
  const hasDecisions = frames.some((f) => f.actions)
  const hasHints = frames.some((f) => f.hint) || !!review

  // Mortal review of the current frame, if any
  const decisions = useMemo(() => new Map((review?.decisions ?? []).map((d) => [d.index, d])), [review])
  const dec = decisions.get(index)
  // the discard actually made after this decision (to mark drawn vs hand tile)
  const actualDahai = useMemo(() => {
    if (!dec?.discard) return null
    for (let i = index + 1; i <= last; i++) {
      const e = frames[i].event
      if (e.type === 'dahai' && e.actor === me) return e
      if (e.type !== 'dora') return null
    }
    return null
  }, [dec, index, frames, last, me])
  const danger = useMemo(() => (aids.danger ? computeDanger(table, me) : []), [aids.danger, table, me])
  const waits = useWaits(table, me, aids.waits || aids.furiten)
  const furiten = aids.furiten && !!waits?.hand && isFuriten(table, me, waits.hand)
  const ron = useRonWaits(open[index], showDealIn || showOtherWaits)

  // sounds when stepping forward one event (click, wheel, →, auto-play); not on jumps or going back
  const prevIndex = useRef(index)
  useEffect(() => {
    const forward = index === prevIndex.current + 1
    prevIndex.current = index
    if (!forward || !settings) return
    const e = frames[index].event
    if (e.type === 'dahai') playClack(settings.sound_tiles ?? 0)
    const voice = voiceFor(e)
    if (voice && 'actor' in e) playVoice(table.players[e.actor] ?? 'ai1', voice, settings.sound_voice ?? 0)
  }, [index, frames, settings, table.players])

  const findFrom = (from: number, step: number, pred: (f: Frame) => boolean) => {
    for (let i = from + step; i >= 0 && i <= last; i += step) if (pred(frames[i])) return i
    return from
  }
  const nextDecision = () => go(findFrom(index, 1, (f) => !!f.actions))
  const nextMismatch = () => {
    const next = review?.decisions.find((d) => d.index > index && !d.match)
    if (next) go(next.index)
  }
  const kyokuStart = (step: number) => go(findFrom(index, step, (f) => f.event.type === 'start_kyoku'))

  // every kyoku as "东1局 0本场 — outcome", for the jump menu
  const kyokus = useMemo(() => {
    const list: { index: number; label: string }[] = []
    let names: string[] = []
    frames.forEach((f, i) => {
      const e = f.event
      if (e.type === 'start_game') names = e.names
      if (e.type === 'start_kyoku') list.push({ index: i, label: `${WIND_NAME[e.bakaze]}${e.kyoku}局 ${e.honba}本场` })
      const cur = list[list.length - 1]
      if (!cur || cur.label.includes('—')) return
      if (e.type === 'hora') cur.label += ` — ${names[e.actor] ?? ''} ${e.actor === e.target ? '自摸' : '荣和'}`
      else if (e.type === 'ryukyoku') cur.label += ` — ${RYUKYOKU_NAME[e.reason ?? 'exhaustive'] ?? '流局'}`
    })
    return list
  }, [frames])
  const currentKyoku = kyokus.reduce((cur, k) => (k.index <= index ? k.index : cur), kyokus[0]?.index ?? 0)

  useEffect(() => {
    if (!playing) return
    const t = setTimeout(() => (index < last ? go(index + 1) : setPlaying(false)), 600)
    return () => clearTimeout(t)
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(index + 1)
      if (e.key === 'ArrowLeft') go(index - 1)
      if (e.key === ' ') setPlaying((p) => !p)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])

  const onAction = (a: Action) => {
    setToast(`（预览）你选择了：${actionLabel(a)}`)
    go(index + 1)
  }

  const actions = frame.actions ?? []
  const discards = actions.filter((a) => a.type === 'dahai')
  const discardable = discards.length ? new Set(discards.map((a) => (a as { pai: string }).pai)) : undefined
  const hints = dec ? reviewHints(dec) : (frame.hint ?? null)
  const topHint = showHints && !dec && frame.hint?.[0]?.type === 'dahai' ? frame.hint[0].tiles[0] : null
  const t = frame.event.type
  const showResult = (t === 'hora' || t === 'ryukyoku' || t === 'end_kyoku') && (table.horas.length > 0 || !!table.ryukyoku)
  // with a review, what you did is tagged 「你」 in the hint list instead
  const chosenText = !dec && frame.chosen ? `${ai} 实际：${actionLabel(frame.chosen)}` : undefined

  const tileInfo = (tile: string, fromDrawn: boolean) => {
    const annotate = dec?.discard && showHints
    // after riichi only the drawn tile can go
    const w = aids.waits && (fromDrawn || !table.seats[me].riichiAccepted) ? waits?.byDiscard.get(kind(tile)) : undefined
    if (!annotate && !danger.length && !w) return undefined
    return {
      waits: w,
      waitsFuriten: !!w && aids.furiten && furitenAfter(table, me, tile, w),
      risks: danger.length ? tileRisks(danger, tile) : undefined,
      prob: annotate ? (dec!.probs[tile] ?? 0) : undefined,
      text: annotate && qView && tile in dec!.q ? qGap(dec!, tile) : undefined,
      best: annotate ? dec!.best === tile : undefined,
      actual: annotate && actualDahai ? actualDahai.pai === tile && actualDahai.tsumogiri === fromDrawn : undefined,
    }
  }

  // click = next step, wheel = step forward / back (not on controls, not on preview decisions)
  const onStageClick = (e: React.MouseEvent) => {
    if (actions.length || (e.target as HTMLElement).closest('button, a, input, label, [data-noadvance]')) return
    go(index + 1)
  }
  const onStageContextMenu = (e: React.MouseEvent) => {
    e.preventDefault() // no browser menu (back / forward …) while reviewing
    go(index - 1)
  }
  const onStageWheel = (e: React.WheelEvent) => {
    const now = performance.now()
    if (now - lastWheel.current < 60 || e.deltaY === 0) return
    lastWheel.current = now
    go(index + (e.deltaY > 0 ? 1 : -1))
  }

  const btn = 'rounded-md bg-white/10 px-2.5 py-1 text-[13px] hover:bg-white/20 disabled:opacity-30'
  return (
    <div className="flex h-full flex-col items-center" onContextMenu={onStageContextMenu}>
      {/* two rows: controls + review / display toggles, then a full-width progress bar with the step
          description; the stage scales to the header's real height */}
      <div ref={headerRef} className="w-full shrink-0 border-b border-white/10 bg-black/40 text-white whitespace-nowrap">
      <div className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-1.5">
        <div className="flex items-center gap-2">
        <a href={backHref} className="mr-1 text-white/60 hover:text-white">←</a>
        <span className="mr-3 font-bold tracking-wide">{title}</span>
        <button className={btn} onClick={() => kyokuStart(-1)} title="上一局">⏮</button>
        <button className={btn} onClick={() => go(index - 1)} title="上一步 (←)">◀</button>
        <button className={`${btn} w-10`} onClick={() => setPlaying(!playing)} title="播放 (空格)">{playing ? '⏸' : '▶'}</button>
        <button className={btn} onClick={() => go(index + 1)} title="下一步 (→)">▶︎|</button>
        <button className={btn} onClick={() => kyokuStart(1)} title="下一局">⏭</button>
        {hasDecisions && (
          <button className={btn} onClick={nextDecision}>
            下一个我的决策
          </button>
        )}
        {kyokus.length > 0 && (
          <select
            value={currentKyoku}
            onChange={(e) => go(Number(e.target.value))}
            title="跳到某一局"
            className="max-w-[240px] rounded-md bg-white/10 px-2 py-1 text-[13px] text-white outline-none hover:bg-white/20"
          >
            {kyokus.map((k) => (
              <option key={k.index} value={k.index} className="bg-[#13241c]">
                {k.label}
              </option>
            ))}
          </select>
        )}
        {extra}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
        {review ? (
          <>
            <span
              className="rounded-md bg-emerald-700/50 px-2 py-1 text-[12px]"
              title={`${ai} 一致 ${review.summary.matches}/${review.summary.decisions}，恶手（实际选择 < 5%）${review.summary.bad} 处`}
            >
              一致率 {review.summary.rate === null ? '—' : `${(review.summary.rate * 100).toFixed(1)}%`}
            </span>
            <button className={btn} onClick={nextMismatch}>
              下一处不一致
            </button>
          </>
        ) : (
          onRunReview && (
            <button className={`${btn} bg-emerald-700/70 hover:bg-emerald-600`} onClick={onRunReview} disabled={reviewing}>
              {reviewing ? `${ai} 复盘中…` : `${ai} 复盘`}
            </button>
          )
        )}
        {review && (
          <label
            className="ml-3 flex items-center gap-1.5 text-[13px]"
            title="把概率换成 Q 差：每个选项比 AI 首选差多少（AI 的价值估计之差，0 = 首选，越大越亏；不是点数）"
          >
            <input type="checkbox" checked={qView} onChange={(e) => setQView(e.target.checked)} /> Q 差
          </label>
        )}
        {/* same controls, same order as the game page; 明牌 / 摸切明暗 only exist here */}
        <span className="ml-2 h-5 w-px bg-white/15" />
        {hasHints && (
          <label className="ml-2 flex items-center gap-1.5 text-[13px]">
            <input type="checkbox" checked={showHints} onChange={(e) => setShowHints(e.target.checked)} /> AI 提示
          </label>
        )}
        <AidMenu
          aids={aids}
          setAid={setAid}
          extra={[
            { label: '铳牌', on: showDealIn, set: toggleDealIn },
            { label: '别家听牌', on: showOtherWaits, set: toggleOtherWaits },
            { label: '明牌', on: openHands, set: setOpenHands },
            { label: '摸切明暗', on: showTsumogiri, set: setShowTsumogiri },
          ]}
        />
        <button
          onClick={() => setShowUkeire((v) => !v)}
          title="每种打法的向听数和进张（扣除这一步你能看到的牌）"
          className={`ml-2 rounded-full px-3 py-1 text-[12px] font-bold ${showUkeire ? 'bg-emerald-600' : 'bg-white/10 hover:bg-white/20'}`}
        >
          进张分析
        </button>
        </div>
      </div>
      <div className="flex h-8 items-center gap-3 border-t border-white/5 bg-black/20 px-4">
        <input
          type="range"
          min={0}
          max={last}
          value={index}
          onChange={(e) => go(Number(e.target.value))}
          className="min-w-0 flex-1 accent-emerald-400"
        />
        <span className="w-[72px] shrink-0 text-right font-mono text-[12px] text-white/60 tabular-nums">
          {index}/{last}
        </span>
        <span className="w-[300px] shrink-0 truncate text-[13px] text-white/80">{describe(frame.event, names)}</span>
      </div>
      </div>

      {/* your own view at this step (never the open hands) */}
      {showUkeire && <UkeirePanel table={masked[index]} onClose={() => setShowUkeire(false)} />}

      <div className="flex w-full flex-1" onClick={onStageClick} onWheel={onStageWheel}>
      <ScaledStage reserved={headerH}>
        {(width) => (
            <Table
          width={width}
              table={table}
              me={table.human}
              openHands={openHands}
              discardable={discardable}
              hover={topHint}
              showTsumogiri={showTsumogiri}
              discardFx={discardFx}
              avatars={seatAvatars(settings, table.players)}
              danger={danger}
              tileInfo={tileInfo}
              sameTileHighlight={aids.sameTile}
              furiten={furiten}
              dealIn={showDealIn ? ron?.dealIn : null}
              ownWaits={aids.waits ? (waits?.hand ?? null) : null}
              seatWaits={showOtherWaits && ron ? ron.seats.map((w, i) => (i === me ? null : w)) : null}
              callouts={[calloutFor(ev, index)].filter((c) => c !== null)}
              onDiscard={(pai) => onAction(discards.find((a) => a.type === 'dahai' && a.pai === pai)!)}
            >
              {hasHints && showHints && <HintPanel
                  hints={hints}
                  chosen={chosenText}
                  actual={dec?.actual}
                  title={`${ai} 推荐`}
                  value={dec && qView ? (h) => qGap(dec, h.label) : undefined}
                />}
              {actions.some((a) => a.type !== 'dahai') && <ActionBar key={index} actions={actions} onAction={onAction} />}
              {toast && (
                <div className="absolute top-[612px] left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-[14px] text-white">
                  {toast}
                </div>
              )}
              {showResult && <ResultModal table={table} />}
              {t === 'end_game' && <EndModal table={table} settings={settings} />}
            </Table>
              )}
      </ScaledStage>
      </div>
    </div>
  )
}
