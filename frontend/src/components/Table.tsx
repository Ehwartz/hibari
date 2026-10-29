import { type ReactNode, useEffect, useState } from 'react'
import { DANGER_SIDES, DANGER_TRACK, type OpponentDanger } from '../lib/danger'
import { type SeatView, type TableState, arrange } from '../lib/table'
import { KINDS, SEAT_WIND, type Tile as TileT, WIND_NAME, deaka } from '../lib/tiles'
import { Avatar } from './Avatar'
import { Tile } from './Tile'
import { Hand, type Leaving, Melds, River, type TileInfo } from './TableParts'

/** Minimum stage width; wider windows get a wider stage (the table stays centred). */
export const STAGE_W = 1280
export const STAGE_MAX_W = 1800
export const STAGE_H = 880
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

/** Deal-in risk against one opponent: a button under their avatar. */
interface CardDanger {
  d: OpponentDanger
  side: (typeof DANGER_SIDES)[number]
  open: boolean
  onToggle: () => void
}

function DangerButton({ d, side, open, onToggle }: CardDanger) {
  return (
    <div className="relative mt-1 w-full" data-noadvance>
      <button
        onClick={onToggle}
        title="点击查看所有牌对这一家的铳率"
        className={`flex w-full items-center justify-center gap-1 rounded-md px-0.5 py-[1px] text-[10px] whitespace-nowrap ${open ? 'bg-white/20 ring-1 ring-white/30' : 'bg-white/5 hover:bg-white/15'}`}
      >
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: side.color }} />
        <span className="text-white/80">{d.riichi ? '立直' : `听${Math.round(d.tenpai * 100)}%`}</span>
      </button>
    </div>
  )
}

// The 34-tile risk popover sits in the empty margin on that player's side, never over hands,
// melds or rivers: 上家 left, 对家 top-right, 下家 right (above the hint box).
const POPOVER_POS: Record<number, React.CSSProperties> = {
  3: { left: 18, top: 290 },
  2: { right: 18, top: 18 },
  1: { right: 18, top: 170 },
}

function DangerPopover({ d, side, pos }: { d: OpponentDanger; side: (typeof DANGER_SIDES)[number]; pos: React.CSSProperties }) {
  return (
    <div className="absolute z-30 w-[226px] rounded-xl bg-black/90 p-2.5 shadow-2xl ring-1 ring-white/15" style={pos} data-noadvance>
          <div className="mb-2 flex items-center gap-1.5 text-[12px]">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: side.color }} />
            <span className="text-white/85">{side.label} 铳率</span>
            <span className="ml-auto text-white/50">{d.riichi ? '已立直' : `估计听牌 ${Math.round(d.tenpai * 100)}%`}</span>
          </div>
          <div className="grid grid-cols-9 gap-x-[2px] gap-y-1.5">
            {KINDS.map((t, k) => (
              <div key={t} className="flex flex-col items-center" title={`${(d.risk[k] * 100).toFixed(1)}%`}>
                <Tile tile={t} w={21} />
                <div className="mt-0.5 h-[3px] w-full rounded-sm" style={{ background: DANGER_TRACK }}>
                  <div
                    className="h-full rounded-sm"
                    style={{ width: `${Math.min(100, (d.risk[k] / 0.15) * 100)}%`, background: side.color }}
                  />
                </div>
                <div className="font-mono text-[9px] text-white/70 tabular-nums">{(d.risk[k] * 100).toFixed(1)}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] leading-snug text-white/45">按听牌概率 × 牌型放铳率估算（现物、筋、壁、字牌见张数），仅供参考。</div>
    </div>
  )
}

function PlayerCard({ name, avatar, active, oya, self, size, danger }: CardProps & { size: number; danger?: CardDanger }) {
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
      {danger && <DangerButton {...danger} />}
    </div>
  )
}

/** An avatar card in a seat's rotated frame, kept upright (counter-rotated in a square slot). */
function HandAvatar({
  r,
  size,
  place,
  danger,
  ...card
}: CardProps & { r: number; size: number; place: React.CSSProperties; danger?: CardDanger }) {
  const slot = size + 40
  return (
    <div className="absolute flex items-center justify-center" style={{ ...place, width: slot, height: slot }}>
      <div style={{ transform: `rotate(${90 * r}deg)` }}>
        <PlayerCard {...card} size={size} danger={danger} />
      </div>
    </div>
  )
}

// beside the hand row (you, top player) / behind the hand on the seat's axis (left, right)
// Hand rows are anchored at their bottom (outer) edge: a taller meld (stacked kakan, sideways
// tiles) grows the row towards the centre instead of pushing the hand outwards.
const tileH = (w: number) => Math.round((w * 4) / 3) + Math.max(2, Math.round(w / 14))
const beside = (w: number) => ({ right: '100%', marginRight: 10, bottom: tileH(w) / 2, transform: 'translateY(50%)' })
const behind = (size: number) => ({ left: -(size + 40) / 2, top: 372 })

/** A big announcement next to a player: 吃 碰 杠 立直 荣 自摸. */
export interface Callout {
  key: number
  seat: number
  text: string
  tone: 'call' | 'riichi' | 'win'
}

const calloutPos = (cx: number) => [
  { left: cx, top: CY + 250 },
  { left: cx + 250, top: CY },
  { left: cx, top: CY - 250 },
  { left: cx - 250, top: CY },
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
  /** Slot to animate from: the copy the player clicked; for hidden hands a random one (opponents' hands are
   * not kept in any order). Used only when it holds the discarded tile, or when the hand is hidden. */
  slot?: number
}

function leavingSlot(fx: DiscardFx, hand: TileT[]): Leaving {
  if (fx.tsumogiri && fx.prev.drawn !== null) return { from: 'drawn', key: fx.key }
  const i = fx.slot !== undefined && hand[fx.slot] === fx.pai ? fx.slot : hand.indexOf(fx.pai)
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
  onDiscard?: (tile: TileT, fromDrawn: boolean, slot?: number) => void
  /** Review mode: show tsumogiri (dark) vs tedashi (light) in the rivers. */
  showTsumogiri?: boolean
  /** Auto-sort the own hand (otherwise kept tiles stay at the right end). */
  sortHand?: boolean
  discardFx?: DiscardFx | null
  callouts?: Callout[]
  /** Avatar image URL per seat (null = default avatar). */
  avatars?: (string | null)[]
  /** Deal-in risk vs each opponent (DANGER_SIDES order); shows a button under their avatar. */
  danger?: OpponentDanger[]
  /** Per-tile extras for the own hand (AI probabilities, deal-in risk). */
  tileInfo?: (tile: TileT, fromDrawn: boolean) => TileInfo | undefined
  children?: ReactNode // overlays in stage coordinates (action bar, panels, modals)
  /** Stage width (>= STAGE_W); the table is centred, side panels hug the edges. */
  width?: number
  /** Manual hand arrangement (used when auto-sort is off). */
  onReorder?: (from: number, to: number) => void
  /** Start-of-kyoku deal animation: tiles start appearing `start` ms after `key` changes. */
  deal?: { key: number; start: number } | null
  /** Mark the tiles in all rivers and melds of the same kind as the hand tile under the mouse. */
  sameTileHighlight?: boolean
  /** Your waiting hand is furiten: a 振听 badge above it. */
  furiten?: boolean
}

const rel = (seat: number, me: number) => (seat - me + 4) % 4

/** Gap between two dealt groups; a full deal is 16 steps. */
export const DEAL_STEP_MS = 85

/** A group rotated so that local +y points towards the seat at relative position `r`. */
function Rotated({ r, cx, children }: { r: number; cx: number; children: ReactNode }) {
  return (
    <div className="absolute" style={{ left: cx, top: CY, transform: `rotate(${-90 * r}deg)` }}>
      {children}
    </div>
  )
}

function CenterPanel({ table, me, cx }: { table: TableState; me: number; cx: number }) {
  const round = `${WIND_NAME[table.bakaze]}${table.kyoku}局`
  return (
    <div
      className="absolute rounded-xl border border-white/10 bg-black/45 shadow-inner"
      style={{ left: cx - 108, top: CY - 108, width: 216, height: 216 }}
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
  tileInfo,
  danger = [],
  children,
  width = STAGE_W,
  onReorder,
  deal,
  sameTileHighlight = false,
  furiten = false,
}: Props) {
  const cx = width / 2
  // same-kind marks: the hand tile under the mouse (red fives count as fives)
  const [hoverTile, setHoverTile] = useState<TileT | null>(null)
  const mark = sameTileHighlight && hoverTile ? (t: TileT) => deaka(t) === deaka(hoverTile) : undefined
  const [dangerOpen, setDangerOpen] = useState<number | null>(null)
  const dangerFor = (seat: number): CardDanger | undefined => {
    const i = danger.findIndex((d) => d.seat === seat)
    if (i < 0) return undefined
    return {
      d: danger[i],
      side: DANGER_SIDES[i],
      open: dangerOpen === seat,
      onToggle: () => setDangerOpen(dangerOpen === seat ? null : seat),
    }
  }
  const openDanger = danger.findIndex((d) => d.seat === dangerOpen)
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

  // dealt like at a real table: 4 tiles to each player (dealer first) three times, then 1 each
  const dealOf = (seat: number) =>
    deal
      ? {
          key: deal.key,
          delay: (i: number) => deal.start + (Math.min(Math.floor(i / 4), 3) * 4 + rel(seat, table.oya)) * DEAL_STEP_MS,
        }
      : undefined

  const card = (seat: number): CardProps => ({
    name: table.names[seat],
    avatar: avatars[seat],
    active: table.turn === seat,
    oya: table.oya === seat && table.started,
    self: seat === me,
  })

  return (
    <div className="felt relative overflow-hidden rounded-[28px]" style={{ width, height: STAGE_H }}>
      <DoraPanel table={table} />
      <CenterPanel table={table} me={me} cx={cx} />

      {[0, 1, 2, 3].map((seat) => {
        const r = rel(seat, me)
        const s = table.seats[seat]
        const last = table.lastDiscard?.actor === seat ? table.lastDiscard.index : null
        return (
          <Rotated key={seat} r={r} cx={cx}>
            <div className="absolute" style={{ left: -108, top: 116 }}>
              <River
                river={s.river}
                w={RIVER_W}
                lastIndex={last}
                showTsumogiri={showTsumogiri}
                hideLast={fx?.actor === seat}
                mark={mark}
              />
            </div>
            {r !== 0 && (
              <div
                className="absolute flex items-end gap-4"
                style={{ left: 0, top: 326 + tileH(OPP_W), transform: 'translate(-50%, -100%)' }}
              >
                {/* top player: beside the hand, mirroring yours */}
                {r === 2 && <HandAvatar r={r} size={OPP_AVATAR} place={beside(OPP_W)} danger={dangerFor(seat)} {...card(seat)} />}
                <Hand {...handOf(seat)} w={OPP_W} hidden={!openHands} deal={dealOf(seat)} />
                <Melds melds={s.melds} actor={seat} w={OPP_MELD_W} mark={mark} />
              </div>
            )}
            {/* left / right players: behind the hand, centred on the seat axis (same height on both sides) */}
            {(r === 1 || r === 3) && (
              <HandAvatar r={r} size={OPP_AVATAR} place={behind(OPP_AVATAR)} danger={dangerFor(seat)} {...card(seat)} />
            )}
          </Rotated>
        )
      })}

      {/* own hand: not rotated, larger tiles */}
      <div
        className="absolute flex items-end gap-6"
        style={{ left: cx, top: CY + 330 + tileH(OWN_W), transform: 'translate(-50%, -100%)' }}
      >
        <HandAvatar r={0} size={OWN_AVATAR} place={beside(OWN_W)} {...card(me)} />
        <div className="relative">
        {furiten && (
          <div className="pointer-events-none absolute bottom-full left-0 mb-9 rounded-full bg-rose-600 px-3.5 py-1 text-[15px] font-bold tracking-[0.25em] text-white shadow-lg ring-2 ring-rose-300/60">
            振听
          </div>
        )}
        <Hand
          {...handOf(me)}
          w={OWN_W}
          discardable={discardable}
          hover={hover}
          onDiscard={onDiscard}
          info={tileInfo}
          onReorder={!sortHand ? onReorder : undefined}
          deal={dealOf(me)}
          onHoverTile={sameTileHighlight ? setHoverTile : undefined}
        />
        </div>
        <Melds melds={table.seats[me].melds} actor={me} w={OWN_MELD_W} mark={mark} />
      </div>
      {callouts.map((c) => (
        <div
          key={c.key}
          className={`callout callout-${c.tone} pointer-events-none absolute z-10`}
          style={calloutPos(cx)[rel(c.seat, me)]}
        >
          {c.text}
        </div>
      ))}
      {openDanger >= 0 && (
        <DangerPopover
          d={danger[openDanger]}
          side={DANGER_SIDES[openDanger]}
          pos={POPOVER_POS[rel(danger[openDanger].seat, me)]}
        />
      )}
      {children}
    </div>
  )
}
