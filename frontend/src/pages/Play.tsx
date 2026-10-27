// Live game against three Mortal bots.
//
// Server messages are queued and played back at a human pace: discards
// animate, results wait for "确定". When a message carries `actions`, playback
// stops until the player picks one. On (re)connect the server replays the
// whole history (flagged `replay`), which rebuilds the table without delays.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionBar, EndModal, HintPanel, ResultModal } from '../components/Overlays'
import { ScaledStage } from '../components/Stage'
import { type DiscardFx, Table } from '../components/Table'
import { type ServerMsg, wsUrl } from '../lib/api'
import type { Action, Hint, MjaiEvent } from '../lib/mjai'
import { type TableState, applyEvent, initialTable } from '../lib/table'

const ME = 0
const UMA = [20, 10, -10, -20]

// Pause after each event (ms) so the game can be followed.
const DELAY: Partial<Record<MjaiEvent['type'], number>> = {
  start_kyoku: 900,
  tsumo: 120,
  dahai: 520,
  chi: 650,
  pon: 650,
  daiminkan: 650,
  ankan: 650,
  kakan: 650,
  reach: 450,
  reach_accepted: 150,
  dora: 300,
  hora: 400,
  ryukyoku: 400,
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function usePlaySession(gameId: string) {
  const [table, setTable] = useState<TableState>(initialTable)
  const [fx, setFx] = useState<DiscardFx | null>(null)
  const [pending, setPending] = useState<{ actions: Action[]; hint?: Hint[] } | null>(null)
  const [modal, setModal] = useState<'result' | 'end' | null>(null)
  const [status, setStatus] = useState<'connecting' | 'live' | 'reconnecting'>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const r = useRef({
    table: initialTable(),
    queue: [] as ServerMsg[],
    busy: false,
    gen: 0, // bumped on every (re)connect; stale handlers stop
    resume: null as (() => void) | null,
    fxKey: 0,
    ws: null as WebSocket | null,
  })

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
    const ev = m.event
    const prev = s.table
    s.table = applyEvent(prev, ev)
    setTable(s.table)
    if (ev.type === 'dahai' && !m.replay) {
      setFx({ key: ++s.fxKey, actor: ev.actor, pai: ev.pai, tsumogiri: ev.tsumogiri, prev: prev.seats[ev.actor] })
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
    if (ev.type === 'end_kyoku' && (s.table.horas.length > 0 || s.table.ryukyoku)) {
      setModal('result')
      await waitUser()
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
        r.current.queue.push(JSON.parse(e.data))
        pump()
      }
      ws.onclose = (e) => {
        if (closed) return
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

  return { table, fx, pending, modal, status, error, notice, setNotice, act, closeModal }
}

export function Play({ gameId }: { gameId: string }) {
  const { table, fx, pending, modal, status, error, notice, setNotice, act, closeModal } = usePlaySession(gameId)
  const [showHints, setShowHints] = useState(() => localStorageGet('hints') !== '0')

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(t)
  }, [notice, setNotice])

  // After riichi the only choice is often the forced tsumogiri: play it automatically.
  useEffect(() => {
    if (!pending) return
    const only = pending.actions.length === 1 ? pending.actions[0] : null
    if (only?.type !== 'dahai' || !table.seats[ME].riichiAccepted) return
    const t = setTimeout(() => act(only), 450)
    return () => clearTimeout(t)
  }, [pending])

  const actions = pending?.actions ?? []
  const discards = actions.filter((a): a is Extract<Action, { type: 'dahai' }> => a.type === 'dahai')
  const discardable = discards.length ? new Set(discards.map((a) => a.pai)) : undefined
  const hint = pending?.hint ?? null
  const topHint = showHints && hint?.[0]?.type === 'dahai' ? hint[0].tiles[0] : null

  const onDiscard = (pai: string, fromDrawn: boolean) => {
    const a = discards.find((d) => d.pai === pai && d.tsumogiri === fromDrawn) ?? discards.find((d) => d.pai === pai)
    if (a) act(a)
  }

  const toggleHints = (v: boolean) => {
    setShowHints(v)
    localStorageSet('hints', v ? '1' : '0')
  }

  return (
    <div className="flex h-full flex-col items-center">
      <div className="flex h-12 w-full shrink-0 items-center gap-3 border-b border-white/10 bg-black/40 px-4 text-[13px] text-white">
        <a href="#/" className="text-white/60 hover:text-white">← 返回</a>
        <span className="font-bold tracking-wide">对局</span>
        <span className="font-mono text-white/35">{gameId}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[12px] ${status === 'live' ? 'bg-emerald-600/40 text-emerald-200' : 'bg-amber-600/40 text-amber-200'}`}
        >
          {status === 'live' ? '已连接' : status === 'connecting' ? '连接中…' : '重连中…'}
        </span>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showHints} onChange={(e) => toggleHints(e.target.checked)} /> AI 提示
        </label>
      </div>

      {error && (
        <div className="w-full bg-rose-900/70 px-4 py-2 text-center text-[13px] text-rose-100">
          {error} <a href="#/" className="ml-3 underline">返回首页</a>
        </div>
      )}

      <ScaledStage reserved={48 + (error ? 36 : 0)}>
        <Table
          table={table}
          me={ME}
          discardable={discardable}
          hover={topHint}
          onDiscard={onDiscard}
          discardFx={fx}
        >
          {showHints && <HintPanel hints={hint} />}
          {actions.some((a) => a.type !== 'dahai') && <ActionBar key={JSON.stringify(actions)} actions={actions} onAction={act} />}
          {notice && (
            <div className="absolute top-[612px] left-1/2 max-w-[700px] -translate-x-1/2 truncate rounded-full bg-black/70 px-4 py-1.5 text-[14px] text-white">
              {notice}
            </div>
          )}
          {modal === 'result' && <ResultModal table={table} onClose={closeModal} />}
          {modal === 'end' && <EndModal table={table} uma={UMA} onClose={() => (location.hash = '#/')} />}
        </Table>
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
