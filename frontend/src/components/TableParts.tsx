import type { Meld, RiverTile } from '../lib/table'
import type { Tile as TileT } from '../lib/tiles'
import { Tile } from './Tile'

interface RiverProps {
  river: RiverTile[]
  w: number
  lastIndex: number | null
  /** Review mode: tsumogiri tiles dark, tedashi tiles light. */
  showTsumogiri?: boolean
}

export function River({ river, w, lastIndex, showTsumogiri }: RiverProps) {
  const rows: RiverTile[][] = []
  for (let i = 0; i < river.length; i += 6) rows.push(river.slice(i, i + 6))
  return (
    <div className="flex flex-col gap-[3px]">
      {rows.map((row, r) => (
        <div key={r} className="flex items-end gap-px">
          {row.map((t, c) => {
            const i = r * 6 + c
            return (
              <div
                key={i}
                className={`relative ${i === lastIndex ? 'last-discard' : ''} ${t.called ? 'opacity-45' : ''}`}
                title={showTsumogiri ? (t.tsumogiri ? '摸切' : '手切') : undefined}
              >
                <Tile tile={t.pai} w={w} sideways={t.riichi} dim={showTsumogiri && t.tsumogiri} />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Tiles of a meld in display order, with the called tile sideways (Tenhou layout). */
function meldTiles(m: Meld, actor: number): { tile: TileT; sideways?: boolean; back?: boolean; stacked?: TileT }[] {
  if (m.type === 'ankan') {
    const [a, b, c, d] = m.consumed
    return [{ tile: a, back: true }, { tile: b }, { tile: c }, { tile: d, back: true }]
  }
  const rel = ((m.target ?? actor) - actor + 4) % 4 // 3 = kamicha (left), 2 = toimen, 1 = shimocha (right)
  const called = m.type === 'kakan' ? m.calledPai! : m.pai!
  const own = m.type === 'kakan' ? m.consumed.filter((_, i) => i < 2) : m.consumed
  const tiles: { tile: TileT; sideways?: boolean; stacked?: TileT }[] = own.map((t) => ({ tile: t }))
  const calledTile = { tile: called, sideways: true, stacked: m.type === 'kakan' ? m.pai! : undefined }
  const pos = rel === 3 ? 0 : rel === 2 ? 1 : tiles.length
  tiles.splice(pos, 0, calledTile)
  return tiles
}

export function Melds({ melds, actor, w }: { melds: Meld[]; actor: number; w: number }) {
  const h = Math.round((w * 4) / 3)
  return (
    <div className="flex items-end gap-2">
      {[...melds].reverse().map((m, i) => (
        <div key={i} className="flex items-end gap-px">
          {meldTiles(m, actor).map((t, j) =>
            t.stacked ? (
              <div key={j} className="flex flex-col" style={{ marginTop: -h * 0.1 }}>
                <Tile tile={t.stacked} w={w} sideways />
                <div style={{ marginTop: -Math.round(w / 14) }}>
                  <Tile tile={t.tile} w={w} sideways />
                </div>
              </div>
            ) : (
              <Tile key={j} tile={t.tile} w={w} sideways={t.sideways} back={t.back} />
            ),
          )}
        </div>
      ))}
    </div>
  )
}

/** The tile leaving the hand during a discard: a hand index, or the separate drawn tile. */
export type Leaving = { from: number | 'drawn'; key: number }

interface HandProps {
  hand: TileT[]
  drawn: TileT | null
  w: number
  hidden?: boolean
  leaving?: Leaving | null
  /** Tiles that may be discarded now; undefined = not discarding. */
  discardable?: Set<TileT>
  hover?: TileT | null
  onDiscard?: (tile: TileT, fromDrawn: boolean) => void
}

export function Hand({ hand, drawn, w, hidden, leaving, discardable, hover, onDiscard }: HandProps) {
  const tile = (t: TileT, key: string, fromDrawn: boolean, slot: number | 'drawn') => {
    const can = discardable?.has(t)
    if (leaving && leaving.from === slot) {
      return (
        <div key={`${key}-${leaving.key}`} className="discard-leave">
          <Tile tile={t} w={w} back={hidden} />
        </div>
      )
    }
    return (
      <Tile
        key={key}
        tile={t}
        w={w}
        back={hidden}
        dim={discardable !== undefined && !can}
        highlight={hover === t}
        onClick={can && onDiscard ? () => onDiscard(t, fromDrawn) : undefined}
      />
    )
  }
  return (
    <div className="flex items-end">
      <div className="flex items-end gap-[2px]">{hand.map((t, i) => tile(t, `h${i}`, false, i))}</div>
      {/* the drawn slot always takes space, so the hand doesn't shift on draw / discard */}
      <div style={{ marginLeft: w * 0.35, minWidth: w }}>{drawn !== null && tile(drawn, 'drawn', true, 'drawn')}</div>
    </div>
  )
}
