// UI preview without a backend: steps through a recorded Mortal x4 game
// (src/mock/game.json, exported by scripts/export_mock.py) from seat 0's view.

import { useEffect, useMemo, useState } from 'react'
import { ActionBar, EndModal, HintPanel, ResultModal } from '../components/Overlays'
import { type DiscardFx, STAGE_H, STAGE_W, Table } from '../components/Table'
import { type Action, type Hint, type MjaiEvent, maskEvent } from '../lib/mjai'
import { type TableState, applyEvent, initialTable } from '../lib/table'
import { tileName } from '../lib/tiles'
import mock from '../mock/game.json'

interface Frame {
  event: MjaiEvent
  actions?: Action[]
  chosen?: Action
  hint?: Hint[]
}

const frames = (mock as unknown as { names: string[]; frames: Frame[] }).frames
const ME = 0

function buildStates(open: boolean): TableState[] {
  const out: TableState[] = []
  let s = initialTable()
  for (const f of frames) {
    s = applyEvent(s, open ? f.event : maskEvent(f.event, ME))
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
    default:
      return ev.type
  }
}

function actionLabel(a: Action): string {
  if (a.type === 'dahai') return `打 ${tileName(a.pai)}`
  if (a.type === 'none') return '跳过'
  return { reach: '立直', ryukyoku: '流局', hora: '和', chi: '吃', pon: '碰', daiminkan: '杠', ankan: '暗杠', kakan: '加杠' }[a.type]
}

// Start somewhere interesting: our first discard decision after a few turns, with someone in riichi if possible.
function interestingFrame(states: TableState[]): number {
  const isDecision = (i: number) => frames[i].actions?.some((a) => a.type === 'dahai')
  const turns = (i: number) => states[i].seats.reduce((n, s) => n + s.river.length, 0)
  const withRiichi = frames.findIndex((_, i) => isDecision(i) && turns(i) >= 24 && states[i].seats.some((s) => s.riichiAccepted))
  if (withRiichi >= 0) return withRiichi
  const busy = frames.findIndex((_, i) => isDecision(i) && turns(i) >= 24)
  return busy >= 0 ? busy : 0
}

function useStageScale(reserved: number) {
  const calc = () => Math.min(window.innerWidth / (STAGE_W + 32), (window.innerHeight - reserved) / (STAGE_H + 24))
  const [scale, setScale] = useState(calc)
  useEffect(() => {
    const onResize = () => setScale(calc())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  })
  return scale
}

export function Preview() {
  const masked = useMemo(() => buildStates(false), [])
  const open = useMemo(() => buildStates(true), [])
  const [index, setIndex] = useState(() => {
    const q = new URLSearchParams(location.search).get('frame')
    return q ? Number(q) : interestingFrame(masked)
  })
  const [openHands, setOpenHands] = useState(false)
  const [showHints, setShowHints] = useState(true)
  const [showTsumogiri, setShowTsumogiri] = useState(() => new URLSearchParams(location.search).has('review'))
  const [playing, setPlaying] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const scale = useStageScale(56)

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
  const names = (mock as { names: string[] }).names

  const findFrom = (from: number, step: number, pred: (f: Frame) => boolean) => {
    for (let i = from + step; i >= 0 && i <= last; i += step) if (pred(frames[i])) return i
    return from
  }
  const nextDecision = () => go(findFrom(index, 1, (f) => !!f.actions))
  const kyokuStart = (step: number) => go(findFrom(index, step, (f) => f.event.type === 'start_kyoku'))

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
  const topHint = showHints && frame.hint?.[0]?.type === 'dahai' ? frame.hint[0].tiles[0] : null
  const t = frame.event.type
  const showResult = (t === 'hora' || t === 'ryukyoku' || t === 'end_kyoku') && (table.horas.length > 0 || !!table.ryukyoku)
  const chosenText = frame.chosen ? `Mortal 实际：${actionLabel(frame.chosen)}` : undefined

  const btn = 'rounded-md bg-white/10 px-2.5 py-1 text-[13px] hover:bg-white/20 disabled:opacity-30'
  return (
    <div className="flex h-full flex-col items-center">
      <div className="flex h-14 w-full shrink-0 items-center gap-2 border-b border-white/10 bg-black/40 px-4 text-white">
        <span className="mr-3 font-bold tracking-wide">界面预览</span>
        <button className={btn} onClick={() => kyokuStart(-1)} title="上一局">⏮</button>
        <button className={btn} onClick={() => go(index - 1)} title="上一步 (←)">◀</button>
        <button className={`${btn} w-10`} onClick={() => setPlaying(!playing)} title="播放 (空格)">{playing ? '⏸' : '▶'}</button>
        <button className={btn} onClick={() => go(index + 1)} title="下一步 (→)">▶︎|</button>
        <button className={btn} onClick={() => kyokuStart(1)} title="下一局">⏭</button>
        <button className={btn} onClick={nextDecision}>下一个我的决策</button>
        <input
          type="range"
          min={0}
          max={last}
          value={index}
          onChange={(e) => go(Number(e.target.value))}
          className="mx-2 w-56 accent-emerald-400"
        />
        <span className="w-20 font-mono text-[12px] text-white/60 tabular-nums">
          {index}/{last}
        </span>
        <span className="flex-1 truncate text-[13px] text-white/80">{describe(frame.event, names)}</span>
        <label className="flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={openHands} onChange={(e) => setOpenHands(e.target.checked)} /> 明牌
        </label>
        <label className="ml-3 flex items-center gap-1.5 text-[13px]" title="复盘用：牌河里摸切的牌变暗，手切的牌保持明亮">
          <input type="checkbox" checked={showTsumogiri} onChange={(e) => setShowTsumogiri(e.target.checked)} /> 摸切明暗
        </label>
        <label className="ml-3 flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={showHints} onChange={(e) => setShowHints(e.target.checked)} /> AI 提示
        </label>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div style={{ width: STAGE_W * scale, height: STAGE_H * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <Table
              table={table}
              me={ME}
              openHands={openHands}
              discardable={discardable}
              hover={topHint}
              showTsumogiri={showTsumogiri}
              discardFx={discardFx}
              onDiscard={(pai) => onAction(discards.find((a) => a.type === 'dahai' && a.pai === pai)!)}
            >
              {showHints && <HintPanel hints={frame.hint ?? null} chosen={chosenText} />}
              {actions.some((a) => a.type !== 'dahai') && <ActionBar key={index} actions={actions} onAction={onAction} />}
              {toast && (
                <div className="absolute top-[612px] left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-[14px] text-white">
                  {toast}
                </div>
              )}
              {showResult && <ResultModal table={table} />}
              {t === 'end_game' && <EndModal table={table} uma={[20, 10, -10, -20]} />}
            </Table>
          </div>
        </div>
      </div>
    </div>
  )
}
