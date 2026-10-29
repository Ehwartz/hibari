// 铳牌 marks in the replay: tiles in a hand that another player could ron right now. Needs every hand, so
// it runs on the open table. A player counts when waiting (3n+1 tiles), not furiten (decided on all
// waits), and the tile has a yaku for them (decided by /api/ron_waits).

import { useEffect, useState } from 'react'
import { type RonSeat, api } from './api'
import type { Meld, TableState } from './table'
import { deaka, kind } from './tiles'
import { isFuriten } from './waits'

const WINDS = ['E', 'S', 'W', 'N']

function meldTiles(m: Meld): string[] {
  if (m.type === 'chi' || m.type === 'pon') return [...m.consumed, m.pai!]
  const t = deaka(m.consumed[0] ?? m.pai!)
  return [t, t, t, t] // kans: four of a kind (red fives don't matter for yaku)
}

/** Per seat, the tile kinds in its hand that someone else could ron; null while off or loading. */
export function useDealIn(table: TableState, enabled: boolean): Set<number>[] | null {
  const seats: RonSeat[] = table.seats.map((s, i) => ({
    hand: [...s.hand, ...(s.drawn ? [s.drawn] : [])],
    melds: s.melds.map((m) => ({ type: m.type, tiles: meldTiles(m) })),
    riichi: s.riichiAccepted,
    wind: WINDS[(i - table.oya + 4) % 4],
  }))
  const usable = enabled && table.seats.length === 4 && seats.every((s) => !s.hand.includes('?'))
  const key = usable ? JSON.stringify([table.bakaze, seats]) : ''
  const [result, setResult] = useState<{ key: string; seats: { waits: string[]; ron: string[] }[] } | null>(null)

  useEffect(() => {
    if (!key) return
    let live = true
    const [bakaze, s] = JSON.parse(key) as [string, RonSeat[]]
    api
      .ronWaits(bakaze, s)
      .then((r) => live && setResult({ key, seats: r.seats }))
      .catch(() => live && setResult(null))
    return () => {
      live = false
    }
  }, [key])

  if (!key || result?.key !== key) return null
  const threats = result.seats.map((s, i) =>
    s.ron.length && !isFuriten(table, i, s.waits.map((tile) => ({ tile }))) ? new Set(s.ron.map(kind)) : new Set<number>(),
  )
  return table.seats.map((_, holder) => new Set(threats.flatMap((t, i) => (i === holder ? [] : [...t]))))
}
