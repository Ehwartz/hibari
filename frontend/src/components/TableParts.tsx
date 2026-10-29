import { useState } from 'react'
import { DANGER_SIDES, DANGER_TRACK } from '../lib/danger'
import type { Meld, RiverTile } from '../lib/table'
import type { Tile as TileT } from '../lib/tiles'
import { Tile } from './Tile'

interface RiverProps {
  river: RiverTile[]
  w: number
  lastIndex: number | null
  /** Review mode: tsumogiri tiles dark, tedashi tiles light. */
  showTsumogiri?: boolean
  /** The newest discard is still leaving the hand: keep its place but don't show it yet. */
  hideLast?: boolean
  /** Tiles to mark (same kind as the tile under the mouse in your hand). */
  mark?: (t: TileT) => boolean
}

export function River({ river, w, lastIndex, showTsumogiri, hideLast, mark }: RiverProps) {
  const rows: RiverTile[][] = []
  for (let i = 0; i < river.length; i += 6) rows.push(river.slice(i, i + 6))
  return (
    <div className="flex flex-col gap-[3px]">
      {rows.map((row, r) => (
        <div key={r} className="flex items-end gap-px">
          {row.map((t, c) => {
            const i = r * 6 + c
            const newest = i === river.length - 1
            const hidden = newest && hideLast
            return (
              <div
                key={i}
                className={`relative ${hidden ? 'opacity-0' : `${i === lastIndex ? 'last-discard' : ''} ${newest ? 'river-drop' : ''}`} ${t.called ? 'opacity-45' : ''}`}
                title={showTsumogiri ? (t.tsumogiri ? '摸切' : '手切') : undefined}
              >
                <Tile tile={t.pai} w={w} sideways={t.riichi} dim={showTsumogiri && t.tsumogiri} mark={mark?.(t.pai)} />
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

export function Melds({ melds, actor, w, mark }: { melds: Meld[]; actor: number; w: number; mark?: (t: TileT) => boolean }) {
  const h = Math.round((w * 4) / 3)
  return (
    <div className="flex items-end gap-2">
      {[...melds].reverse().map((m, i) => (
        <div key={i} className="flex items-end gap-px">
          {meldTiles(m, actor).map((t, j) =>
            t.stacked ? (
              <div key={j} className="flex flex-col" style={{ marginTop: -h * 0.1 }}>
                <Tile tile={t.stacked} w={w} sideways mark={mark?.(t.stacked)} />
                <div style={{ marginTop: -Math.round(w / 14) }}>
                  <Tile tile={t.tile} w={w} sideways mark={mark?.(t.tile)} />
                </div>
              </div>
            ) : (
              <Tile key={j} tile={t.tile} w={w} sideways={t.sideways} back={t.back} mark={!t.back && mark?.(t.tile)} />
            ),
          )}
        </div>
      ))}
    </div>
  )
}

/** Extra per-tile info for the own hand (review / danger). */
export interface TileInfo {
  prob?: number // Mortal's probability of discarding this tile
  text?: string // label shown instead of the probability (e.g. the q-gap)
  best?: boolean // Mortal's top choice
  actual?: boolean // the tile actually discarded
  risks?: number[] // deal-in risk vs 上家 / 对家 / 下家 (0..1)
}

/** Risk at which a danger bar is full. */
const RISK_FULL = 0.15

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
  /** `slot`: the clicked hand index (undefined for the drawn tile), so the animation leaves from that copy. */
  onDiscard?: (tile: TileT, fromDrawn: boolean, slot?: number) => void
  info?: (tile: TileT, fromDrawn: boolean) => TileInfo | undefined
  /** Manual arrangement (auto-sort off): drag hand tile `from` so it ends up at index `to`. */
  onReorder?: (from: number, to: number) => void
  /** Deal animation: tile i appears after this many ms (keyed so a new deal restarts it). */
  deal?: { key: number; delay: (i: number) => number }
  /** The tile under the mouse (null when it leaves the hand). */
  onHoverTile?: (t: TileT | null) => void
}

export function Hand({ hand, drawn, w, hidden, leaving, discardable, hover, onDiscard, info, onReorder, deal, onHoverTile }: HandProps) {
  // drag & drop arrangement: `drag` = index being dragged, `drop` = insertion point (0..n)
  const [drag, setDrag] = useState<number | null>(null)
  const [drop, setDrop] = useState<number | null>(null)
  const sortable = !!onReorder && !leaving
  const dragProps = (i: number) =>
    sortable
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            setDrag(i)
            e.dataTransfer.effectAllowed = 'move'
          },
          onDragOver: (e: React.DragEvent) => {
            if (drag === null) return
            e.preventDefault()
            const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setDrop(e.clientX < box.left + box.width / 2 ? i : i + 1)
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault()
            if (drag !== null && drop !== null) {
              const to = drop > drag ? drop - 1 : drop
              if (to !== drag) onReorder!(drag, to)
            }
            setDrag(null)
            setDrop(null)
          },
          onDragEnd: () => {
            setDrag(null)
            setDrop(null)
          },
        }
      : {}
  const marker = (at: number) =>
    drag !== null && drop === at && drop !== drag && drop !== drag + 1 ? (
      <div className="pointer-events-none absolute top-0 bottom-0 w-[3px] rounded-full bg-amber-300" style={{ left: -3 }} />
    ) : null
  const decorate = (el: React.ReactElement, t: TileT, fromDrawn: boolean, key: string) => {
    const i = info?.(t, fromDrawn)
    if (!i) return el
    const title = i.risks
      ? DANGER_SIDES.map((s, j) => `${s.label} ${(i.risks![j] * 100).toFixed(1)}%`).join('  ')
      : undefined
    return (
      <div key={key} className="relative" title={title}>
        {el}
        {i.prob !== undefined && (
          <div
            className={`pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded px-1 font-mono text-[11px] whitespace-nowrap tabular-nums ${i.best ? 'bg-amber-400 font-bold text-black' : 'bg-black/65 text-white/85'}`}
          >
            {i.text ?? `${Math.round(i.prob * 100)}%`}
          </div>
        )}
        {i.actual && (
          <div
            className="pointer-events-none absolute top-0 right-0 left-0 rounded-[7px] ring-[3px] ring-rose-500"
            style={{ height: Math.round((w * 4) / 3) }}
          />
        )}
        {i.risks && (
          <div className="absolute top-full right-0 left-0 mt-1 flex flex-col gap-[2px] rounded-sm p-[2px]" style={{ background: DANGER_TRACK }}>
            {i.risks.map((r, j) => (
              <div
                key={j}
                className="h-[3px] rounded-full"
                style={{ width: `${Math.min(100, (r / RISK_FULL) * 100)}%`, background: DANGER_SIDES[j].color }}
              />
            ))}
          </div>
        )}
      </div>
    )
  }
  const tile = (t: TileT, key: string, fromDrawn: boolean, slot: number | 'drawn') => {
    const can = discardable?.has(t)
    if (leaving && leaving.from === slot) {
      return (
        <div key={`${key}-${leaving.key}`} className="discard-leave">
          <Tile tile={t} w={w} back={hidden} />
        </div>
      )
    }
    return decorate(
      <Tile
        key={key}
        tile={t}
        w={w}
        back={hidden}
        dim={discardable !== undefined && !can}
        highlight={hover === t}
        hoverable={!hidden && onDiscard !== undefined}
        onClick={can && onDiscard ? () => onDiscard(t, fromDrawn, slot === 'drawn' ? undefined : slot) : undefined}
      />,
      t,
      fromDrawn,
      key,
    )
  }
  // which tile is under the mouse (tiles carry data-tile), for the same-kind marks on the table
  const hoverProps =
    onHoverTile && !hidden
      ? {
          onMouseOver: (e: React.MouseEvent) =>
            onHoverTile((e.target as HTMLElement).closest<HTMLElement>('[data-tile]')?.dataset.tile ?? null),
          onMouseLeave: () => onHoverTile(null),
        }
      : {}
  return (
    <div className="flex items-end" {...hoverProps}>
      <div className="flex items-end gap-[2px]">
        {hand.map((t, i) =>
          deal ? (
            <div key={`deal${deal.key}-${i}`} className="deal-in" style={{ animationDelay: `${deal.delay(i)}ms` }}>
              {tile(t, `h${i}`, false, i)}
            </div>
          ) : sortable ? (
            <div key={`d${i}`} className={`relative ${drag === i ? 'opacity-40' : ''} cursor-grab`} {...dragProps(i)}>
              {marker(i)}
              {tile(t, `h${i}`, false, i)}
              {i === hand.length - 1 && drop === hand.length && drag !== null && drag !== hand.length - 1 && (
                <div className="pointer-events-none absolute top-0 bottom-0 w-[3px] rounded-full bg-amber-300" style={{ right: -3 }} />
              )}
            </div>
          ) : (
            tile(t, `h${i}`, false, i)
          ),
        )}
      </div>
      {/* the drawn slot always takes space, so the hand doesn't shift on draw / discard */}
      <div style={{ marginLeft: w * 0.35, minWidth: w }}>{drawn !== null && tile(drawn, 'drawn', true, 'drawn')}</div>
    </div>
  )
}
