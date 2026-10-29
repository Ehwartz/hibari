// 点差: the smallest hand that lets you overtake another player, by ron off them (直击), ron off someone
// else (出和) or tsumo, honba and riichi deposits included. Scoring as in the engine: no kiriage mangan
// (30 fu 4 han = 7700), honba 300 per ron / 100 per payer on tsumo, deposits to the winner.

interface Hand {
  label: string
  han: number
  fu: number // 0 for limit hands
  base: number // basic points (fu × 2^(han+2), or the limit)
  ron: boolean // can be won by ron (20 fu hands are tsumo-only pinfu)
}

const ceil100 = (x: number) => Math.ceil(x / 100) * 100

const LIMITS: [number, string, number][] = [
  [5, '满贯', 2000],
  [6, '跳满', 3000],
  [8, '倍满', 4000],
  [11, '三倍满', 6000],
  [13, '役满', 8000],
]

const HANDS: Hand[] = (() => {
  const out: Hand[] = []
  for (let han = 1; han <= 4; han++) {
    const fus = han === 1 ? [30, 40, 50, 60, 70, 80, 90, 100, 110] : [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110]
    for (const fu of fus) {
      const base = fu * 2 ** (han + 2)
      if (base >= 2000) continue // a mangan, listed below
      out.push({ label: `${fu}符${han}番`, han, fu, base, ron: fu !== 20 })
    }
  }
  for (const [han, label, base] of LIMITS) out.push({ label, han, fu: 0, base, ron: true })
  return out
})()

const fuRank = (h: Hand) => (h.fu === 25 ? 1000 : h.fu)

export type WinWay = 'direct' | 'other' | 'tsumo'

/** How my score minus `target`'s changes when I win `hand` that way. */
function swing(h: Hand, way: WinWay, dealer: boolean, targetDealer: boolean, honba: number, kyotaku: number): number {
  const pot = 1000 * kyotaku
  if (way !== 'tsumo') {
    const ron = ceil100(h.base * (dealer ? 6 : 4)) + 300 * honba
    return ron + pot + (way === 'direct' ? ron : 0)
  }
  const fromDealer = ceil100(h.base * 2)
  const fromChild = ceil100(h.base * (dealer ? 2 : 1))
  const total = dealer ? 3 * fromChild : fromDealer + 2 * fromChild
  const share = dealer || !targetDealer ? fromChild : fromDealer
  return total + 300 * honba + pot + share + 100 * honba
}

export interface Comeback {
  seat: number
  gap: number // my score minus theirs
  /** Smallest hand to overtake per way: a label, null when even a yakuman is not enough. Absent when ahead. */
  need?: Record<WinWay, string | null>
}

/** Ties go to the seat closer to the first dealer (seat 0). */
export function comebacks(scores: number[], me: number, oya: number, honba: number, kyotaku: number): Comeback[] {
  return [0, 1, 2, 3]
    .filter((s) => s !== me)
    .map((seat) => {
      const gap = scores[me] - scores[seat]
      const passes = (d: number) => d > 0 || (d === 0 && me < seat)
      if (passes(gap)) return { seat, gap }
      const need = {} as Record<WinWay, string | null>
      for (const way of ['direct', 'other', 'tsumo'] as WinWay[]) {
        const fits = HANDS.filter((h) => (way === 'tsumo' || h.ron) && passes(gap + swing(h, way, me === oya, seat === oya, honba, kyotaku)))
        // the cheapest hand that is enough; equal points: lower fu (50符2番 rather than 100符1番), 25 fu (七对子 only) last
        fits.sort(
          (a, b) =>
            swing(a, way, me === oya, seat === oya, honba, kyotaku) - swing(b, way, me === oya, seat === oya, honba, kyotaku) ||
            fuRank(a) - fuRank(b),
        )
        need[way] = fits[0]?.label ?? null
      }
      return { seat, gap, need }
    })
}
