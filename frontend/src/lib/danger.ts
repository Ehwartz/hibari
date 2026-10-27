// Deal-in risk ("铳率") from public information only: rivers (incl. called tiles),
// melds, riichi, dora indicators and the viewer's own hand. Heuristic:
//
//   risk(tile vs opponent) = P(opponent tenpai) × P(deal in | tenpai, tile category)
//
// P(tenpai): 1 after riichi; otherwise rises with turn and number of open melds.
// P(deal in | tenpai) by category, roughly the usual statistics against a riichi:
// genbutsu 0; honors by unseen copies; number tiles by how many ryanmen sides are
// still possible (a side is ruled out by suji = genbutsu on the other end, or by
// kabe = all 4 copies of a needed neighbour visible), e.g. musuji 4-6 ≈ 12.5 %,
// suji 1/9 ≈ 1.8 %.  An estimate for ranking danger, not an exact probability.

import type { TableState } from './table'
import { type Tile, deaka, kind } from './tiles'

export interface OpponentDanger {
  seat: number
  rel: 1 | 2 | 3 // 3 = 上家 (left), 2 = 对家 (across), 1 = 下家 (right)
  tenpai: number
  riichi: boolean
  risk: number[] // by 34-kind, 0..1
}

/** Display order and colors: 上家, 对家, 下家 (validated categorical set, dark track #10201a). */
export const DANGER_SIDES: { rel: 1 | 2 | 3; label: string; color: string }[] = [
  { rel: 3, label: '上家', color: '#3d93dc' },
  { rel: 2, label: '对家', color: '#c98420' },
  { rel: 1, label: '下家', color: '#d9579a' },
]
export const DANGER_TRACK = '#10201a'

const ONE_SIDE_OPEN = [5.5, 7.5, 8.5] // 1/9, 2/8, 3/7 with their ryanmen side possible
const ONE_SIDE_BLOCKED = [1.8, 3.3, 4.5]
const HONOR_BY_UNSEEN = [0, 1.2, 3.0, 7.0, 8.0] // unseen copies 0..4

function visibleCounts(t: TableState, me: number): number[] {
  const c = new Array(34).fill(0)
  const add = (x: Tile) => {
    if (x !== '?') c[kind(x)]++
  }
  const mine = t.seats[me]
  mine.hand.forEach(add)
  if (mine.drawn) add(mine.drawn)
  for (const s of t.seats) {
    s.river.forEach((r) => !r.called && add(r.pai)) // called tiles are counted in the meld
    for (const m of s.melds) {
      m.consumed.forEach(add)
      if (m.pai) add(m.pai)
      if (m.calledPai) add(m.calledPai)
    }
  }
  t.doraMarkers.forEach(add)
  return c.map((n) => Math.min(4, n))
}

function tenpaiProb(t: TableState, seat: number): number {
  const s = t.seats[seat]
  if (s.riichi) return 1
  const calls = s.melds.filter((m) => m.type !== 'ankan').length
  const turn = s.river.length
  if (calls === 0) return Math.min(0.6, Math.max(0.02, 0.02 + (turn - 5) * 0.045))
  const base = [0.25, 0.5, 0.75, 0.92][Math.min(calls, 4) - 1]
  return Math.min(0.95, base * (0.6 + 0.04 * turn))
}

/** Kinds the opponent cannot ron: their own discards, and anything discarded after their riichi. */
function genbutsu(t: TableState, seat: number): Set<number> {
  const safe = new Set<number>()
  const s = t.seats[seat]
  s.river.forEach((r) => safe.add(kind(r.pai)))
  if (s.riichiSeq !== null) {
    for (const o of t.seats) for (const r of o.river) if (r.seq > s.riichiSeq) safe.add(kind(r.pai))
  }
  return safe
}

function conditionalRate(k: number, safe: Set<number>, visible: number[]): number {
  if (safe.has(k)) return 0
  if (k >= 27) return HONOR_BY_UNSEEN[4 - visible[k]] / 100
  const n = (k % 9) + 1
  const base = k - (n - 1)
  const at = (m: number) => base + m - 1
  const wall = (m: number) => visible[at(m)] >= 4
  const lowSide = n <= 6 ? !(safe.has(at(n + 3)) || wall(n + 1) || wall(n + 2)) : null
  const highSide = n >= 4 ? !(safe.has(at(n - 3)) || wall(n - 1) || wall(n - 2)) : null
  let rate: number
  if (lowSide === null || highSide === null) {
    const edge = Math.min(n, 10 - n) - 1 // 0,1,2 for 1/9, 2/8, 3/7
    rate = (lowSide ?? highSide) ? ONE_SIDE_OPEN[edge] : ONE_SIDE_BLOCKED[edge]
  } else {
    const open = Number(lowSide) + Number(highSide)
    rate = open === 2 ? 12.5 : open === 1 ? (n === 5 ? 8.5 : 8.0) : n === 5 ? 4.5 : 4.0
  }
  // only one unseen copy left: shanpon impossible, tanki unlikely
  if (visible[k] >= 3) rate *= 0.7
  return rate / 100
}

export function computeDanger(t: TableState, me: number): OpponentDanger[] {
  if (!t.started || t.seats[me].hand.length === 0) return []
  const visible = visibleCounts(t, me)
  return DANGER_SIDES.map(({ rel }) => {
    const seat = (me + rel) % 4
    const tenpai = tenpaiProb(t, seat)
    const safe = genbutsu(t, seat)
    const risk = Array.from({ length: 34 }, (_, k) => tenpai * conditionalRate(k, safe, visible))
    return { seat, rel, tenpai, riichi: t.seats[seat].riichi, risk }
  })
}

/** Risks of one tile, in DANGER_SIDES order. */
export function tileRisks(danger: OpponentDanger[], tile: Tile): number[] {
  const k = kind(deaka(tile))
  return danger.map((d) => d.risk[k])
}
