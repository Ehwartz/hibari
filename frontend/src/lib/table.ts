// Table state rebuilt from (possibly masked) mjai events.
// Used by live play (events from the server) and replay (full logs) alike.

import type { MjaiEvent } from './mjai'
import { type Tile, kind, sortTiles } from './tiles'

export interface Meld {
  type: 'chi' | 'pon' | 'daiminkan' | 'ankan' | 'kakan'
  pai: Tile | null // called tile (kakan: the added tile); null for ankan
  consumed: Tile[]
  target: number | null
  calledPai?: Tile // kakan: the tile originally called for the pon
}

export interface RiverTile {
  pai: Tile
  tsumogiri: boolean
  riichi: boolean // declaration tile, shown sideways
  called: boolean // taken by another player
}

export interface SeatView {
  hand: Tile[] // arrangement order (dealt sorted, kept tiles appended); excludes the drawn tile
  drawn: Tile | null
  melds: Meld[]
  river: RiverTile[]
  riichi: boolean // declared (accepted or pending)
  riichiAccepted: boolean
}

export interface HoraInfo {
  actor: number
  target: number
  pai: Tile
  han: number
  fu: number
  yaku: [string, number][]
  deltas: number[]
  uraMarkers: Tile[]
  hand: Tile[] // winner's concealed tiles (excl. winning tile) at the moment of the win
  melds: Meld[]
}

export interface RyukyokuInfo {
  reason: string
  deltas: number[]
  tenpai: boolean[]
  hands: Tile[][]
}

export interface TableState {
  names: string[]
  bakaze: string
  kyoku: number
  honba: number
  kyotaku: number
  oya: number
  scores: number[]
  doraMarkers: Tile[]
  tilesLeft: number
  seats: SeatView[]
  turn: number | null // seat whose action we are waiting for
  lastDiscard: { actor: number; index: number } | null
  horas: HoraInfo[]
  ryukyoku: RyukyokuInfo | null
  finalScores: number[] | null
  started: boolean
  human: number // the human's seat
  players: string[] // per seat: 'human' | 'ai1' | 'ai2' | 'ai3'
}

export const DEFAULT_PLAYERS = ['human', 'ai1', 'ai2', 'ai3']

const emptySeat = (): SeatView => ({
  hand: [], drawn: null, melds: [], river: [], riichi: false, riichiAccepted: false,
})

export function initialTable(names: string[] = ['', '', '', '']): TableState {
  return {
    names,
    bakaze: 'E',
    kyoku: 1,
    honba: 0,
    kyotaku: 0,
    oya: 0,
    scores: [25000, 25000, 25000, 25000],
    doraMarkers: [],
    tilesLeft: 70,
    seats: [0, 1, 2, 3].map(emptySeat),
    turn: null,
    lastDiscard: null,
    horas: [],
    ryukyoku: null,
    finalScores: null,
    started: false,
    human: 0,
    players: DEFAULT_PLAYERS,
  }
}

/** Remove one copy of each tile; hidden hands remove a "?" instead. */
function removeTiles(hand: Tile[], tiles: Tile[]): Tile[] {
  const out = [...hand]
  for (const t of tiles) {
    let i = out.indexOf(t)
    if (i < 0) i = out.indexOf('?')
    if (i >= 0) out.splice(i, 1)
  }
  return out
}

/** Keep the drawn tile (after a discard from hand or a call): it goes to the right end.
 * Sorting is a display choice (auto-sort), see `arrange`. */
function settle(seat: SeatView): SeatView {
  if (seat.drawn === null) return seat
  return { ...seat, hand: [...seat.hand, seat.drawn], drawn: null }
}

/** The hand as displayed: sorted when auto-sort is on. */
export const arrange = (hand: Tile[], sort: boolean) => (sort ? sortTiles(hand) : hand)

function updateSeat(s: TableState, i: number, f: (seat: SeatView) => SeatView): SeatView[] {
  return s.seats.map((seat, j) => (j === i ? f(seat) : seat))
}

export function applyEvent(s: TableState, ev: MjaiEvent): TableState {
  switch (ev.type) {
    case 'start_game':
      return {
        ...initialTable(ev.names),
        started: true,
        human: ev.human ?? ev.id ?? 0,
        players: ev.players ?? DEFAULT_PLAYERS,
      }
    case 'start_kyoku':
      return {
        ...s,
        bakaze: ev.bakaze,
        kyoku: ev.kyoku,
        honba: ev.honba,
        kyotaku: ev.kyotaku,
        oya: ev.oya,
        scores: [...ev.scores],
        doraMarkers: [ev.dora_marker],
        tilesLeft: 70,
        seats: ev.tehais.map((h) => ({ ...emptySeat(), hand: sortTiles(h) })),
        turn: ev.oya,
        lastDiscard: null,
        horas: [],
        ryukyoku: null,
      }
    case 'tsumo':
      return {
        ...s,
        tilesLeft: s.tilesLeft - 1,
        turn: ev.actor,
        seats: updateSeat(s, ev.actor, (seat) => ({ ...settle(seat), drawn: ev.pai })),
      }
    case 'dahai': {
      const seats = updateSeat(s, ev.actor, (seat) => {
        let next: SeatView
        if (seat.drawn !== null && (seat.drawn === ev.pai || (ev.tsumogiri && seat.drawn === '?'))) {
          next = { ...seat, drawn: null }
        } else {
          next = settle({ ...seat, hand: removeTiles(seat.hand, [ev.pai]) })
        }
        const riichi = seat.riichi && !seat.riichiAccepted && !seat.river.some((r) => r.riichi)
        return { ...next, river: [...seat.river, { pai: ev.pai, tsumogiri: ev.tsumogiri, riichi, called: false }] }
      })
      return {
        ...s,
        seats,
        turn: null,
        lastDiscard: { actor: ev.actor, index: seats[ev.actor].river.length - 1 },
      }
    }
    case 'chi':
    case 'pon':
    case 'daiminkan': {
      const seats = s.seats.map((seat, j) => {
        if (j === ev.target) {
          const river = seat.river.map((r, k) => (k === seat.river.length - 1 ? { ...r, called: true } : r))
          return { ...seat, river }
        }
        if (j === ev.actor) {
          const meld: Meld = { type: ev.type, pai: ev.pai, consumed: ev.consumed, target: ev.target }
          return { ...settle(seat), hand: removeTiles(settle(seat).hand, ev.consumed), melds: [...seat.melds, meld] }
        }
        return seat
      })
      return { ...s, seats, turn: ev.actor, lastDiscard: null }
    }
    case 'ankan':
      return {
        ...s,
        seats: updateSeat(s, ev.actor, (seat) => {
          const st = settle(seat)
          const meld: Meld = { type: 'ankan', pai: null, consumed: ev.consumed, target: null }
          return { ...st, hand: removeTiles(st.hand, ev.consumed), melds: [...st.melds, meld] }
        }),
      }
    case 'kakan':
      return {
        ...s,
        seats: updateSeat(s, ev.actor, (seat) => {
          const st = settle(seat)
          const melds = st.melds.map((m) =>
            m.type === 'pon' && m.pai !== null && kind(m.pai) === kind(ev.pai)
              ? { ...m, type: 'kakan' as const, calledPai: m.pai, pai: ev.pai }
              : m,
          )
          return { ...st, hand: removeTiles(st.hand, [ev.pai]), melds }
        }),
      }
    case 'dora':
      return { ...s, doraMarkers: [...s.doraMarkers, ev.dora_marker] }
    case 'reach':
      return { ...s, seats: updateSeat(s, ev.actor, (seat) => ({ ...seat, riichi: true })) }
    case 'reach_accepted':
      return {
        ...s,
        kyotaku: s.kyotaku + 1,
        scores: s.scores.map((v, i) => (i === ev.actor ? v - 1000 : v)),
        seats: updateSeat(s, ev.actor, (seat) => ({ ...seat, riichiAccepted: true })),
      }
    case 'hora': {
      const w = s.seats[ev.actor]
      let hand = [...w.hand, ...(w.drawn !== null ? [w.drawn] : [])]
      if (ev.actor === ev.target) hand = removeTiles(hand, [ev.pai])
      if (ev.tehai) hand = ev.tehai
      const info: HoraInfo = {
        actor: ev.actor,
        target: ev.target,
        pai: ev.pai,
        han: ev.han,
        fu: ev.fu,
        yaku: ev.yaku,
        deltas: ev.deltas,
        uraMarkers: ev.ura_markers,
        hand: sortTiles(hand),
        melds: w.melds,
      }
      return {
        ...s,
        scores: s.scores.map((v, i) => v + ev.deltas[i]),
        kyotaku: 0,
        horas: [...s.horas, info],
        turn: null,
      }
    }
    case 'ryukyoku':
      return {
        ...s,
        scores: s.scores.map((v, i) => v + ev.deltas[i]),
        ryukyoku: {
          reason: ev.reason ?? 'exhaustive',
          deltas: ev.deltas,
          tenpai: ev.tenpai ?? [false, false, false, false],
          hands: s.seats.map((seat, i) => ev.tehais?.[i] ?? sortTiles([...seat.hand, ...(seat.drawn ? [seat.drawn] : [])])),
        },
        turn: null,
      }
    case 'end_kyoku':
      return s
    case 'end_game':
      return { ...s, finalScores: ev.scores ?? s.scores }
  }
}
