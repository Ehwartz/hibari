import type { Tile } from './tiles'

// mjai events as produced by backend/engine (incl. our extra fields).
export type MjaiEvent =
  | {
      type: 'start_game'
      names: string[]
      id?: number // the receiving seat (masked stream)
      seed?: number[]
      human?: number // the human's seat (seat 0 is the first dealer)
      players?: string[] // per seat: 'human' | 'ai1' | 'ai2' | 'ai3'
      length?: 'hanchan' | 'tonpuu'
    }
  | {
      type: 'start_kyoku'
      bakaze: string
      dora_marker: Tile
      kyoku: number
      honba: number
      kyotaku: number
      oya: number
      scores: number[]
      tehais: Tile[][]
    }
  | { type: 'tsumo'; actor: number; pai: Tile }
  | { type: 'dahai'; actor: number; pai: Tile; tsumogiri: boolean }
  | { type: 'chi' | 'pon' | 'daiminkan'; actor: number; target: number; pai: Tile; consumed: Tile[] }
  | { type: 'ankan'; actor: number; consumed: Tile[] }
  | { type: 'kakan'; actor: number; pai: Tile; consumed: Tile[] }
  | { type: 'dora'; dora_marker: Tile }
  | { type: 'reach'; actor: number }
  | { type: 'reach_accepted'; actor: number }
  | {
      type: 'hora'
      actor: number
      target: number
      pai: Tile
      tehai?: Tile[] // winner's revealed hand, without the winning tile
      deltas: number[]
      ura_markers: Tile[]
      han: number
      fu: number
      yaku: [string, number][]
      scores: number[]
    }
  | { type: 'ryukyoku'; deltas: number[]; reason?: string; tenpai?: boolean[]; tehais?: (Tile[] | null)[] }
  | { type: 'end_kyoku' }
  | { type: 'end_game'; scores?: number[] }

// A concrete legal action offered to the human (backend/engine/actions.py).
export type Action =
  | { type: 'none' }
  | { type: 'dahai'; actor: number; pai: Tile; tsumogiri: boolean }
  | { type: 'reach' | 'ryukyoku'; actor: number }
  | { type: 'hora'; actor: number; target: number }
  | { type: 'chi' | 'pon' | 'daiminkan'; actor: number; target: number; pai: Tile; consumed: Tile[] }
  | { type: 'ankan'; actor: number; consumed: Tile[] }
  | { type: 'kakan'; actor: number; pai: Tile; consumed: Tile[] }

// One row of Mortal's suggestion (backend/mortal.top_actions).
export interface Hint {
  type: 'dahai' | 'reach' | 'chi' | 'pon' | 'kan' | 'hora' | 'ryukyoku' | 'none'
  label: string
  tiles: Tile[]
  prob: number
}

/** The event as seen from `seat` (mirrors backend mask_event). */
export function maskEvent(ev: MjaiEvent, seat: number): MjaiEvent {
  if (ev.type === 'start_game') return { ...ev, id: seat }
  if (ev.type === 'start_kyoku')
    return { ...ev, tehais: ev.tehais.map((h, i) => (i === seat ? h : h.map(() => '?'))) }
  if (ev.type === 'tsumo' && ev.actor !== seat) return { ...ev, pai: '?' }
  return ev
}
