// Live game against three Mortal bots.
//
// Server messages are queued and played back at a human pace: discards
// animate, results wait for "确定". When a message carries `actions`, playback
// stops until the player picks one. On (re)connect the server replays the
// whole history (flagged `replay`), which rebuilds the table without delays.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionBar,
  AutoPanel,
  type AutoSettings,
  DEFAULT_AUTO,
  EndModal,
  HintPanel,
  ResultModal,
} from '../components/Overlays'
import { computeDanger, tileRisks } from '../lib/danger'
import { ScaledStage } from '../components/Stage'
import { type Callout, DEAL_STEP_MS, type DiscardFx, Table, calloutFor } from '../components/Table'
import { type ServerMsg, wsUrl } from '../lib/api'
import { seatAvatars, useAppSettings } from '../lib/appearance'
import type { Action, Hint, MjaiEvent } from '../lib/mjai'
import { type TableState, applyEvent, initialTable } from '../lib/table'
import { WIND_NAME } from '../lib/tiles'


// Pause after each event (ms) so the game can be followed.
const DELAY: Partial<Record<MjaiEvent['type'], number>> = {
  tsumo: 120,
  dahai: 520,
  // calls / riichi / wins get a callout and time to take it in
  chi: 1100,
  pon: 1100,
  daiminkan: 1100,
  ankan: 1100,
  kakan: 1100,
  reach: 1000,
  reach_accepted: 150,
  dora: 300,
  hora: 1400,
  ryukyoku: 400,
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Start of a kyoku: the "东1局 0本场" banner, then the deal (16 groups) — see Table's deal prop.
const INTRO_MS = 1300
const DEAL_START_MS = 1100 // the deal starts while the banner fades out
const DEAL_MS = DEAL_START_MS + 15 * DEAL_STEP_MS + 300

interface Intro {
  key: number
  round: string
  sub: string
}

function usePlaySession(gameId: string) {
  const [table, setTable] = useState<TableState>(initialTable)
  const [fx, setFx] = useState<DiscardFx | null>(null)
  const [callouts, setCallouts] = useState<Callout[]>([])
  const [pending, setPending] = useState<{ actions: Action[]; hint?: Hint[] } | null>(null)
  const [modal, setModal] = useState<'result' | 'end' | null>(null)
  const [status, setStatus] = useState<'connecting' | 'live' | 'reconnecting'>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [intro, setIntro] = useState<Intro | null>(null)

  const r = useRef({
    table: initialTable(),
    queue: [] as ServerMsg[],
    busy: false,
    gen: 0, // bumped on every (re)connect; stale handlers stop
    resume: null as (() => void) | null,
    fxKey: 0,
    ws: null as WebSocket | null,
    autoplay: false,
    quitting: false, // the player left: no reconnect
  })
  const [autoplay, setAutoplay] = useState(false)

  const waitUser = () => new Promise<void>((res) => (r.current.resume = res))
  const resume = () => {
    const f = r.current.resume
    r.current.resume = null
    f?.()
  }

  const handle = useCallback(async (m: ServerMsg) => {
    const s = r.current
    const gen = s.gen
    if (m.type === 'error') {
      if (m.fatal) setError(m.message)
      else setNotice(m.message)
      return
    }
    if (m.type === 'saved') {
      setNotice(`牌谱已保存：${m.path}`)
      return
    }
    if (m.type === 'autoplay') {
      s.autoplay = m.on
      setAutoplay(m.on)
      return
    }
    if (m.type === 'quit') return // handled in onmessage
    const ev = m.event
    const prev = s.table
    s.table = applyEvent(prev, ev)
    setTable(s.table)
    const callout = m.replay ? null : calloutFor(ev, ++s.fxKey)
    if (callout) {
      setCallouts((cs) => [...cs, callout])
      setTimeout(() => setCallouts((cs) => cs.filter((c) => c !== callout)), 1400)
    }
    if (ev.type === 'dahai' && !m.replay) {
      const before = prev.seats[ev.actor]
      setFx({
        key: ++s.fxKey,
        actor: ev.actor,
        pai: ev.pai,
        tsumogiri: ev.tsumogiri,
        prev: before,
        // opponents' hands are in no particular order: a hand discard comes from a random slot
        slot: Math.floor(Math.random() * Math.max(1, before.hand.length)),
      })
    }
    if (m.actions) {
      setPending({ actions: m.actions, hint: m.hint })
      await waitUser()
      return
    }
    if (ev.type === 'end_game') {
      setModal('end')
      return
    }
    if (m.replay) return
    if (ev.type === 'start_kyoku') {
      const t = s.table
      setIntro({
        key: ++s.fxKey,
        round: `${WIND_NAME[t.bakaze]}${t.kyoku}局`,
        sub: [`${t.honba} 本场`, t.kyotaku ? `供托 ${t.kyotaku}` : '', `亲家 ${t.names[t.oya]}`].filter(Boolean).join(' · '),
      })
      await sleep(DEAL_MS)
      if (gen === r.current.gen) setIntro(null)
      return
    }
    if (ev.type === 'end_kyoku' && (s.table.horas.length > 0 || s.table.ryukyoku)) {
      setModal('result')
      // with AI 代打 on, results close by themselves
      const auto = s.autoplay ? setTimeout(() => resume(), 3000) : undefined
      await waitUser()
      clearTimeout(auto)
      if (gen === r.current.gen) setModal(null)
      return
    }
    await sleep(DELAY[ev.type] ?? 0)
  }, [])

  const pump = useCallback(async () => {
    const s = r.current
    if (s.busy) return
    s.busy = true
    while (s.queue.length) await handle(s.queue.shift()!)
    s.busy = false
  }, [handle])

  useEffect(() => {
    let closed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const connect = () => {
      const ws = new WebSocket(wsUrl(gameId))
      r.current.ws = ws
      ws.onopen = () => {
        // The server replays everything: start from a clean table.
        const s = r.current
        s.gen++
        s.queue = []
        s.table = initialTable()
        setTable(s.table)
        setPending(null)
        setModal(null)
        resume()
        setStatus('live')
      }
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMsg
        if (msg.type === 'quit') {
          // the server stopped the game (we asked it to): leave right away, whatever is queued
          r.current.quitting = true
          location.hash = '#/'
          return
        }
        r.current.queue.push(msg)
        pump()
      }
      ws.onclose = (e) => {
        if (closed || r.current.quitting) return
        if (e.code === 4404) {
          setError('找不到这个对局（服务器可能已重启）')
          return
        }
        setStatus('reconnecting')
        retry = setTimeout(connect, 1500)
      }
    }
    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      r.current.ws?.close()
    }
  }, [gameId, pump])

  const act = (a: Action) => {
    r.current.ws?.send(JSON.stringify({ type: 'action', action: a }))
    setPending(null)
    resume()
  }
  const closeModal = () => resume()
  /** Leave the game: the server stops it (and saves the log so far with `save`), then we go home. */
  const quit = (save: boolean) => {
    const ws = r.current.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      location.hash = '#/'
      return
    }
    r.current.quitting = true
    ws.send(JSON.stringify({ type: 'quit', save }))
    setTimeout(() => (location.hash = '#/'), 3000) // in case the answer never comes
  }
  // manual arrangement of your hand (auto-sort off); kept across draws / discards / calls
  const reorder = (from: number, to: number) => {
    const s = r.current
    const me = s.table.human
    const hand = [...s.table.seats[me].hand]
    const [t] = hand.splice(from, 1)
    hand.splice(to, 0, t)
    s.table = { ...s.table, seats: s.table.seats.map((x, i) => (i === me ? { ...x, hand } : x)) }
    setTable(s.table)
  }
  const toggleAutoplay = (on: boolean) => {
    r.current.ws?.send(JSON.stringify({ type: 'autoplay', on }))
    if (on && r.current.resume && pending) {
      // the server resolves the open decision itself
      setPending(null)
      resume()
    }
  }

  return {
    table,
    fx,
    callouts,
    pending,
    modal,
    status,
    error,
    notice,
    setNotice,
    act,
    closeModal,
    autoplay,
    toggleAutoplay,
    reorder,
    intro,
    quit,
  }
}

export function Play({ gameId }: { gameId: string }) {
  const {
    table,
    fx,
    callouts,
    pending,
    modal,
    status,
    error,
    notice,
    setNotice,
    act,
    closeModal,
    autoplay,
    toggleAutoplay,
    reorder,
    intro,
    quit,
  } = usePlaySession(gameId)
  const [confirmQuit, setConfirmQuit] = useState(false)
  const gameOver = modal === 'end' || !!table.finalScores
  const settings = useAppSettings()
  const [showHints, setShowHints] = useState(() => localStorageGet('hints') !== '0')
  const [auto, setAuto] = useState<AutoSettings>(() => {
    try {
      return { ...DEFAULT_AUTO, ...JSON.parse(localStorageGet('auto') ?? '{}') }
    } catch {
      return DEFAULT_AUTO
    }
  })
  const [showDanger, setShowDanger] = useState(() => localStorageGet('danger') === '1')
  const toggleDanger = (v: boolean) => {
    setShowDanger(v)
    localStorageSet('danger', v ? '1' : '0')
  }
  const danger = useMemo(() => (showDanger ? computeDanger(table, table.human) : []), [showDanger, table])
  const changeAuto = (v: AutoSettings) => {
    setAuto(v)
    localStorageSet('auto', JSON.stringify(v))
  }

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(t)
  }, [notice, setNotice])

  // Automatic moves. A win on offer is never skipped automatically.
  useEffect(() => {
    if (!pending) return
    const acts = pending.actions
    const hora = acts.find((a) => a.type === 'hora')
    const pass = acts.find((a) => a.type === 'none')
    const tsumogiri = acts.find((a) => a.type === 'dahai' && a.tsumogiri)
    let move: Action | undefined
    if (hora) move = auto.autoWin ? hora : undefined
    else if (acts.length === 1 && acts[0].type === 'dahai') move = acts[0] // forced, e.g. after riichi
    else if (auto.noCalls && pass) move = pass
    else if (auto.autoTsumogiri && tsumogiri) move = tsumogiri
    if (!move) return
    const chosen = move
    const t = setTimeout(() => act(chosen), chosen.type === 'none' ? 0 : 450)
    return () => clearTimeout(t)
  }, [pending, auto])

  const actions = pending?.actions ?? []
  const discards = actions.filter((a): a is Extract<Action, { type: 'dahai' }> => a.type === 'dahai')
  const discardable = discards.length ? new Set(discards.map((a) => a.pai)) : undefined
  const hint = pending?.hint ?? null
  const topHint = showHints && hint?.[0]?.type === 'dahai' ? hint[0].tiles[0] : null

  const onDiscard = (pai: string, fromDrawn: boolean) => {
    const a = discards.find((d) => d.pai === pai && d.tsumogiri === fromDrawn) ?? discards.find((d) => d.pai === pai)
    if (a) act(a)
  }

  // Right click = the "default" move: pass on a call, or tsumogiri (which also skips riichi).
  // Never when a win is on offer, so a stray right click can't throw it away.
  const onRightClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!pending || actions.some((a) => a.type === 'hora')) return
    const pass = actions.find((a) => a.type === 'none') ?? discards.find((a) => a.tsumogiri)
    if (pass) act(pass)
  }

  const toggleHints = (v: boolean) => {
    setShowHints(v)
    localStorageSet('hints', v ? '1' : '0')
  }

  return (
    <div className="flex h-full flex-col items-center" onContextMenu={onRightClick}>
      <div className="flex h-12 w-full shrink-0 items-center gap-3 border-b border-white/10 bg-black/40 px-4 text-[13px] text-white">
        <button
          onClick={() => (gameOver ? (location.hash = '#/') : setConfirmQuit(true))}
          className="rounded-full bg-white/10 px-3 py-1 text-[12px] font-bold hover:bg-rose-700/80"
        >
          退出对局
        </button>
        <span className="font-bold tracking-wide">对局</span>
        <span className="font-mono text-white/35">{gameId}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[12px] ${status === 'live' ? 'bg-emerald-600/40 text-emerald-200' : 'bg-amber-600/40 text-amber-200'}`}
        >
          {status === 'live' ? '已连接' : status === 'connecting' ? '连接中…' : '重连中…'}
        </span>
        <span className="flex-1" />
        <button
          onClick={() => toggleAutoplay(!autoplay)}
          title="让 AI 替你打（温度在「设置」中调整），可随时关闭"
          className={`rounded-full px-3 py-1 text-[12px] font-bold ${autoplay ? 'bg-amber-500 text-black' : 'bg-white/10 hover:bg-white/20'}`}
        >
          {autoplay ? 'AI 代打中 · 点击接管' : 'AI 代打'}
        </button>
        <span className="text-white/40">右键：摸切 / 跳过</span>
        <label className="ml-3 flex items-center gap-1.5" title="根据牌河、副露、立直估算每张牌对三家的放铳率">
          <input type="checkbox" checked={showDanger} onChange={(e) => toggleDanger(e.target.checked)} /> 铳率
        </label>
        <label className="ml-3 flex items-center gap-1.5">
          <input type="checkbox" checked={showHints} onChange={(e) => toggleHints(e.target.checked)} /> AI 提示
        </label>
      </div>

      {confirmQuit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setConfirmQuit(false)}>
          <div className="w-[420px] rounded-2xl bg-[#13241c] p-6 text-white shadow-2xl ring-1 ring-white/15" onClick={(e) => e.stopPropagation()}>
            <div className="text-[18px] font-bold">退出这局对局？</div>
            <div className="mt-2 text-[13px] leading-relaxed text-white/65">
              对局还没有结束。可以保存已经打完的部分（记为未完成，可在「牌谱」里回放，不计入数据和练习），也可以直接放弃。
            </div>
            <div className="mt-5 flex flex-col gap-2">
              <button className="rounded-lg bg-emerald-600 py-2 font-bold hover:bg-emerald-500" onClick={() => quit(true)}>
                保存牌谱并退出
              </button>
              <button className="rounded-lg bg-white/10 py-2 hover:bg-rose-700/80" onClick={() => quit(false)}>
                不保存，直接退出
              </button>
              <button className="rounded-lg py-2 text-white/60 hover:text-white" onClick={() => setConfirmQuit(false)}>
                继续对局
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="w-full bg-rose-900/70 px-4 py-2 text-center text-[13px] text-rose-100">
          {error} <a href="#/" className="ml-3 underline">返回首页</a>
        </div>
      )}

      <ScaledStage reserved={48 + (error ? 36 : 0)}>
        {(width) => (
        <Table
          width={width}
          table={table}
          me={table.human}
          discardable={discardable}
          hover={topHint}
          onDiscard={onDiscard}
          sortHand={auto.autoSort}
          onReorder={reorder}
          deal={intro ? { key: intro.key, start: DEAL_START_MS } : null}
          discardFx={fx}
          callouts={callouts}
          avatars={seatAvatars(settings, table.players)}
          danger={danger}
          tileInfo={danger.length ? (t) => ({ risks: tileRisks(danger, t) }) : undefined}
        >
          <AutoPanel value={auto} onChange={changeAuto} />
          {intro && (
            <div key={intro.key} className="kyoku-intro pointer-events-none absolute inset-x-0 z-20 flex justify-center" style={{ top: 300, animationDuration: `${INTRO_MS}ms` }}>
              <div className="rounded-2xl bg-[#0b1611] px-14 py-6 text-center text-white shadow-2xl ring-1 ring-amber-300/40">
                <div className="text-[56px] leading-tight font-black tracking-[0.2em] text-amber-200">{intro.round}</div>
                <div className="mt-1 text-[18px] tracking-wider text-white/80">{intro.sub}</div>
              </div>
            </div>
          )}
          {showHints && <HintPanel hints={hint} title={`${settings?.ai_name || 'AI'} 推荐`} />}
          {actions.some((a) => a.type !== 'dahai') && <ActionBar key={JSON.stringify(actions)} actions={actions} onAction={act} />}
          {notice && (
            <div className="absolute top-[612px] left-1/2 max-w-[700px] -translate-x-1/2 truncate rounded-full bg-black/70 px-4 py-1.5 text-[14px] text-white">
              {notice}
            </div>
          )}
          {modal === 'result' && <ResultModal table={table} onClose={closeModal} />}
          {modal === 'end' && (
            <EndModal
              table={table}
              settings={settings}
              actions={
                <>
                  <a href={`#/replay/${gameId}`} className="rounded-full bg-white/10 px-5 py-2 font-bold hover:bg-white/20">
                    查看牌谱
                  </a>
                  <a href="#/" className="rounded-full bg-emerald-600 px-6 py-2 font-bold hover:bg-emerald-500">
                    返回主界面
                  </a>
                </>
              }
            />
          )}
        </Table>
              )}
      </ScaledStage>
    </div>
  )
}

function localStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function localStorageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode etc. */
  }
}
