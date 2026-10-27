import { type ReactNode, useEffect, useState } from 'react'
import { type SeatView, type TableState, arrange } from '../lib/table'
import { SEAT_WIND, type Tile as TileT, WIND_NAME } from '../lib/tiles'
import { Avatar } from './Avatar'
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

const OWN_AVATAR = 72
const OPP_AVATAR = 50

interface CardProps {
  name: string
  avatar: string | null
  active: boolean
  oya: boolean
  self: boolean
}

function PlayerCard({ name, avatar, active, oya, self, size }: CardProps & { size: number }) {
  return (
    <div
      className={`flex flex-col items-center rounded-xl border-2 bg-black/45 p-1 shadow-lg transition ${self ? 'border-amber-300/70' : 'border-white/25'} ${active ? 'ring-2 ring-amber-300/80' : ''}`}
      style={{ width: size + 24 }}
    >
      <div className="relative">
        <Avatar url={avatar} name={name || '?'} size={size} />
        {oya && (
          <span className="absolute -top-1.5 -left-1.5 rounded bg-rose-600 px-1 text-[11px] font-bold text-white shadow">庄</span>
        )}
      </div>
      <div className="mt-0.5 w-full truncate text-center text-[12px] leading-tight text-white/90" title={name}>
        {name}
      </div>
    </div>
  )
}

/** An avatar card in a seat's rotated frame, kept upright.
 * `side`: at the left end of the hand row (you, top player); otherwise behind the hand. */
function HandAvatar({ r, size, side, ...card }: CardProps & { r: number; size: number; side: boolean }) {
  const slot = size + 40 // square, so the counter-rotated card fits for every seat
  const place = side
    ? { right: '100%', marginRight: 10, top: '50%', transform: 'translateY(-50%)' }
    : { left: '50%', top: '100%', marginTop: 4, transform: 'translateX(-50%)' }
  return (
    <div className="absolute flex items-center justify-center" style={{ ...place, width: slot, height: slot }}>
      <div style={{ transform: `rotate(${90 * r}deg)` }}>
        <PlayerCard {...card} size={size} />
      </div>
    </div>
  )
}

/** A big announcement next to a player: 吃 碰 杠 立直 荣 自摸. */
export interface Callout {
  key: number
  seat: number
  text: string
  tone: 'call' | 'riichi' | 'win'
}

const CALLOUT_POS = [
  { left: CX, top: CY + 250 },
  { left: CX + 250, top: CY },
  { left: CX, top: CY - 250 },
  { left: CX - 250, top: CY },
]

/** The callout for an event, if it deserves one. */
export function calloutFor(ev: { type: string; actor?: number; target?: number }, key: number): Callout | null {
  const text: Record<string, string> = { chi: '吃', pon: '碰', daiminkan: '杠', ankan: '杠', kakan: '杠', reach: '立直' }
  if (ev.actor === undefined) return null
  if (ev.type === 'hora') return { key, seat: ev.actor, text: ev.actor === ev.target ? '自摸' : '荣', tone: 'win' }
  if (!text[ev.type]) return null
  return { key, seat: ev.actor, text: text[ev.type], tone: ev.type === 'reach' ? 'riichi' : 'call' }
}

/** A discard that just happened, animated from the actor's hand as it was before it. */
export interface DiscardFx {
  key: number // changes per discard event
  actor: number
  pai: TileT
  tsumogiri: boolean
  prev: SeatView // the actor's seat before the discard
  /** Hidden hands: slot to animate from. Opponents' hands are not kept in any order, so this is random. */
  slot?: number
}

function leavingSlot(fx: DiscardFx, hand: TileT[]): Leaving {
  if (fx.tsumogiri && fx.prev.drawn !== null) return { from: 'drawn', key: fx.key }
  const i = hand.indexOf(fx.pai)
  const n = Math.max(1, hand.length)
  return { from: i >= 0 ? i : (fx.slot ?? fx.key * 7) % n, key: fx.key }
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
  /** Auto-sort the own hand (otherwise kept tiles stay at the right end). */
  sortHand?: boolean
  discardFx?: DiscardFx | null
  callouts?: Callout[]
  /** Avatar image URL per seat (null = default avatar). */
  avatars?: (string | null)[]
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

export function Table({
  table,
  me,
  openHands,
  discardable,
  hover,
  onDiscard,
  showTsumogiri,
  sortHand = true,
  discardFx,
  callouts = [],
  avatars = [null, null, null, null],
  children,
}: Props) {
  const [fx, setFx] = useState<DiscardFx | null>(null)
  useEffect(() => {
    setFx(discardFx ?? null)
    if (!discardFx) return
    const t = setTimeout(() => setFx(null), DISCARD_MS)
    return () => clearTimeout(t)
  }, [discardFx?.key])

  // While a discard animates, the actor's hand is drawn as it was before it.
  const handOf = (seat: number) => {
    const sort = seat !== me || sortHand
    if (fx && fx.actor === seat) {
      const hand = arrange(fx.prev.hand, sort)
      return { hand, drawn: fx.prev.drawn, leaving: leavingSlot(fx, hand) }
    }
    return { hand: arrange(table.seats[seat].hand, sort), drawn: table.seats[seat].drawn, leaving: null }
  }

  const card = (seat: number): CardProps => ({
    name: table.names[seat],
    avatar: avatars[seat],
    active: table.turn === seat,
    oya: table.oya === seat && table.started,
    self: seat === me,
  })

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
                {/* left / right players: behind the hand; top player: beside it, mirroring yours */}
                <HandAvatar r={r} size={OPP_AVATAR} side={r === 2} {...card(seat)} />
                <Hand {...handOf(seat)} w={OPP_W} hidden={!openHands} />
                <Melds melds={s.melds} actor={seat} w={OPP_MELD_W} />
              </div>
            )}
          </Rotated>
        )
      })}

      {/* own hand: not rotated, larger tiles */}
      <div className="absolute flex items-end gap-6" style={{ left: CX, top: CY + 330, transform: 'translateX(-50%)' }}>
        <HandAvatar r={0} size={OWN_AVATAR} side {...card(me)} />
        <Hand
          {...handOf(me)}
          w={OWN_W}
          discardable={discardable}
          hover={hover}
          onDiscard={onDiscard}
        />
        <Melds melds={table.seats[me].melds} actor={me} w={OWN_MELD_W} />
      </div>
      {callouts.map((c) => (
        <div
          key={c.key}
          className={`callout callout-${c.tone} pointer-events-none absolute z-10`}
          style={CALLOUT_POS[rel(c.seat, me)]}
        >
          {c.text}
        </div>
      ))}
      {children}
    </div>
  )
}
