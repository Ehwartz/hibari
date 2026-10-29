// Waits for the 听牌提示 / 振听 aids: which discards leave the own hand tenpai and on what, and whether
// the waiting hand is furiten. The waits come from /api/ukeire with nothing counted as visible, so a wait
// stays a wait even when all its copies are out (that matters for furiten); `left` is then counted here.

import { useEffect, useState } from 'react'
import { visibleCounts } from '../components/UkeirePanel'
import { api } from './api'
import type { TableState } from './table'
import { kind, type Tile } from './tiles'

export interface Wait {
  tile: Tile
  left: number // copies you can't see (rivers, melds, dora indicators, your hand)
}

export interface Waits {
  /** Your turn (3n+2 tiles): the waits after each tenpai discard, by tile kind. */
  byDiscard: Map<number, Wait[]>
  /** Waiting (3n+1 tiles) and tenpai: the waits; otherwise null. */
  hand: Wait[] | null
}

const ZEROS = new Array(34).fill(0)

/** Waits of `me`'s concealed hand; null while off, hidden or loading. */
export function useWaits(table: TableState, me: number, enabled: boolean): Waits | null {
  const seat = table.seats[me]
  const concealed = seat ? [...seat.hand, ...(seat.drawn ? [seat.drawn] : [])] : []
  const usable = enabled && concealed.length % 3 !== 0 && !concealed.includes('?')
  const key = usable ? JSON.stringify(concealed) : ''
  const [shape, setShape] = useState<{ key: string; byDiscard: Map<number, Tile[]>; hand: Tile[] | null } | null>(null)

  useEffect(() => {
    if (!key) return
    let live = true
    api
      .ukeire(JSON.parse(key), ZEROS)
      .then((r) => {
        if (!live) return
        const byDiscard = new Map<number, Tile[]>()
        let hand: Tile[] | null = null
        for (const o of r.options) {
          if (o.shanten !== 0) continue
          const tiles = o.tiles.map((t) => t.tile)
          if (o.discard === null) hand = tiles
          else byDiscard.set(kind(o.discard), tiles)
        }
        setShape({ key, byDiscard, hand })
      })
      .catch(() => live && setShape(null))
    return () => {
      live = false
    }
  }, [key])

  if (!key || shape?.key !== key) return null
  const seen = visibleCounts(table)
  for (const t of concealed) seen[kind(t)]++
  const withLeft = (tiles: Tile[]) => tiles.map((tile) => ({ tile, left: Math.max(0, 4 - seen[kind(tile)]) }))
  return {
    byDiscard: new Map([...shape.byDiscard].map(([k, tiles]) => [k, withLeft(tiles)])),
    hand: shape.hand && withLeft(shape.hand),
  }
}

/** Furiten of a waiting hand: a wait in your own river (舍张), a wait let pass since your last discard
 * (同巡, also when there was no yaku to ron with), or since your riichi (立直后). The newest discard
 * counts only once it has been let pass: until the next draw (`turn` is null) you may still ron it. */
export function isFuriten(table: TableState, me: number, waits: Wait[]): boolean {
  const want = new Set(waits.map((w) => kind(w.tile)))
  const seat = table.seats[me]
  if (seat.river.some((r) => want.has(kind(r.pai)))) return true
  const lastOwn = seat.river.length ? seat.river[seat.river.length - 1].seq : -1
  const since = seat.riichiAccepted && seat.riichiSeq !== null ? Math.min(lastOwn, seat.riichiSeq) : lastOwn
  const onOffer = table.turn === null && table.lastDiscard ? table.discardSeq - 1 : -1
  return table.seats.some((s, i) => i !== me && s.river.some((r) => r.seq > since && r.seq !== onOffer && want.has(kind(r.pai))))
}
