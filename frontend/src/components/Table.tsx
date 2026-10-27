import { type ReactNode, useEffect, useState } from 'react'
import type { SeatView, TableState } from '../lib/table'
import { SEAT_WIND, type Tile as TileT, WIND_NAME } from '../lib/tiles'
import { Tile } from './Tile'
import { Hand, type Leaving, Melds, River } from './TableParts'

export const STAGE_W = 1280
export const STAGE_H = 880
const CX = 640
const CY = 418

const RIVER_W = 34
const OPP_W = 30
const OPP_MELD_W = 27
const OWN_W = 58
const OWN_MELD_W = 42
const DISCARD_MS = 520

/** A discard that just happened, animated from the actor's hand as it was before it. */
export interface DiscardFx {
  key: number // changes per discard event
  actor: number
  pai: TileT
  tsumogiri: boolean
  prev: SeatView // the actor's seat before the discard
}

function leavingSlot(fx: DiscardFx): Leaving {
  const { hand, drawn } = fx.prev
  if (fx.tsumogiri && drawn !== null) return { from: 'drawn', key: fx.key }
  const i = hand.indexOf(fx.pai)
  // Hidden hand: the real slot is unknown, pick a stable pseudo-random one.
  return { from: i >= 0 ? i : (fx.key * 7) % Math.max(1, hand.length), key: fx.key }
}

interface Props {
  table: TableState
  /** Seat shown at the bottom. */
  me: number
  openHands?: boolean
  discardable?: Set<TileT>
  hover?: TileT | null
  onDiscard?: (tile: TileT, fromDrawn: boolean) => void
  /** Review mode: show tsumogiri (dark) vs tedashi (light) in the rivers. */
  showTsumogiri?: boolean
  discardFx?: DiscardFx | null
  children?: ReactNode // overlays in stage coordinates (action bar, panels, modals)
}

const rel = (seat: number, me: number) => (seat - me + 4) % 4

/** A group rotated so that local +y points towards the seat at relative position `r`. */
function Rotated({ r, children }: { r: number; children: ReactNode }) {
  return (
    <div className="absolute" style={{ left: CX, top: CY, transform: `rotate(${-90 * r}deg)` }}>
      {children}
    </div>
  )
}

function CenterPanel({ table, me }: { table: TableState; me: number }) {
  const round = `${WIND_NAME[table.bakaze]}${table.kyoku}局`
  return (
    <div
      className="absolute rounded-xl border border-white/10 bg-black/45 shadow-inner"
      style={{ left: CX - 108, top: CY - 108, width: 216, height: 216 }}
    >
      {[0, 1, 2, 3].map((seat) => {
        const r = rel(seat, me)
        const wind = SEAT_WIND[(seat - table.oya + 4) % 4]
        const isTurn = table.turn === seat
        return (
          <div
            key={seat}
            className="absolute"
            style={{ left: 108, top: 108, transform: `rotate(${-90 * r}deg)` }}
          >
            <div
              className={`absolute flex items-center gap-2 font-mono text-[15px] ${isTurn ? 'text-amber-300' : 'text-white/85'}`}
              style={{ left: -70, top: 74, width: 140, justifyContent: 'center' }}
            >
              <span
                className={`rounded px-1 text-[13px] font-bold ${wind === '东' ? 'bg-rose-600 text-white' : 'bg-white/15 text-white/80'}`}
              >
                {wind}
              </span>
              <span className="tabular-nums">{table.scores[seat]}</span>
            </div>
            {isTurn && <div className="absolute rounded-full bg-amber-300/80" style={{ left: -60, top: 102, width: 120, height: 3 }} />}
            {table.seats[seat].riichiAccepted && (
              <div
                className="absolute flex items-center justify-center rounded-sm bg-white shadow"
                style={{ left: -48, top: 60, width: 96, height: 7 }}
              >
                <div className="h-1.5 w-1.5 rounded-full bg-rose-600" />
              </div>
            )}
          </div>
        )
      })}
      <div className="absolute inset-x-0 top-[62px] text-center">
        <div className="text-[22px] font-bold tracking-wider text-white">{round}</div>
        <div className="mt-1 flex justify-center gap-3 text-[12px] text-white/70">
          <span>{table.honba} 本场</span>
          <span>供托 {table.kyotaku}</span>
        </div>
        <div className="mt-1.5 text-[13px] text-emerald-200/90">余 {table.tilesLeft}</div>
      </div>
    </div>
  )
}

function DoraPanel({ table }: { table: TableState }) {
  const markers = [...table.doraMarkers, ...Array(5 - table.doraMarkers.length).fill('?')]
  return (
    <div className="absolute rounded-xl bg-black/35 px-3 py-2.5" style={{ left: 18, top: 18 }}>
      <div className="mb-1.5 text-[12px] text-white/60">宝牌指示牌</div>
      <div className="flex gap-[3px]">
        {markers.slice(0, 5).map((t, i) => (
          <Tile key={i} tile={t} w={30} back={t === '?'} />
        ))}
      </div>
    </div>
  )
}

export function Table({ table, me, openHands, discardable, hover, onDiscard, showTsumogiri, discardFx, children }: Props) {
  const [fx, setFx] = useState<DiscardFx | null>(null)
  useEffect(() => {
    setFx(discardFx ?? null)
    if (!discardFx) return
    const t = setTimeout(() => setFx(null), DISCARD_MS)
    return () => clearTimeout(t)
  }, [discardFx?.key])

  // While a discard animates, the actor's hand is drawn as it was before it.
  const handOf = (seat: number) => {
    if (fx && fx.actor === seat) return { hand: fx.prev.hand, drawn: fx.prev.drawn, leaving: leavingSlot(fx) }
    return { hand: table.seats[seat].hand, drawn: table.seats[seat].drawn, leaving: null }
  }

  return (
    <div className="felt relative overflow-hidden rounded-[28px]" style={{ width: STAGE_W, height: STAGE_H }}>
      <DoraPanel table={table} />
      <CenterPanel table={table} me={me} />

      {[0, 1, 2, 3].map((seat) => {
        const r = rel(seat, me)
        const s = table.seats[seat]
        const last = table.lastDiscard?.actor === seat ? table.lastDiscard.index : null
        return (
          <Rotated key={seat} r={r}>
            <div className="absolute" style={{ left: -108, top: 116 }}>
              <River river={s.river} w={RIVER_W} lastIndex={last} showTsumogiri={showTsumogiri} />
            </div>
            {r !== 0 && (
              <div className="absolute flex items-end gap-4" style={{ left: 0, top: 326, transform: 'translateX(-50%)' }}>
                <Hand {...handOf(seat)} w={OPP_W} hidden={!openHands} />
                <Melds melds={s.melds} actor={seat} w={OPP_MELD_W} />
              </div>
            )}
          </Rotated>
        )
      })}

      {/* opponent names, kept upright */}
      {[0, 1, 2, 3].map((seat) => {
        const r = rel(seat, me)
        if (r === 0) return null
        const pos = [null, { left: CX + 330, top: CY + 236 }, { left: CX, top: CY - 300 }, { left: CX - 330, top: CY - 262 }][r]!
        return (
          <div
            key={seat}
            className="absolute -translate-x-1/2 rounded-full bg-black/30 px-2.5 py-0.5 text-[13px] whitespace-nowrap text-white/80"
            style={pos}
          >
            {table.names[seat]}
          </div>
        )
      })}

      {/* own hand: not rotated, larger tiles */}
      <div className="absolute flex items-end gap-6" style={{ left: CX, top: CY + 330, transform: 'translateX(-50%)' }}>
        <Hand
          {...handOf(me)}
          w={OWN_W}
          discardable={discardable}
          hover={hover}
          onDiscard={onDiscard}
        />
        <Melds melds={table.seats[me].melds} actor={me} w={OWN_MELD_W} />
      </div>
      {children}
    </div>
  )
}
