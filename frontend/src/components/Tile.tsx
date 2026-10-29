import { type Tile as TileT, faceUrl, tileName } from '../lib/tiles'

interface Props {
  tile: TileT
  /** Tile width in px; height is 4/3 of it. */
  w: number
  back?: boolean
  /** Rotated 90° (riichi declaration, called tile in a meld). */
  sideways?: boolean
  dim?: boolean
  highlight?: boolean
  /** Same-kind mark (the tile under the mouse in your hand): a blue tint. */
  mark?: boolean
  /** 铳牌 (replay): someone else could ron this tile; a red tint like `mark`. */
  deal?: boolean
  /** 听牌提示: discarding this tile leaves the hand tenpai; a green edge. */
  wait?: boolean
  raised?: boolean
  /** Lift on mouse-over even when not clickable (own hand). */
  hoverable?: boolean
  onClick?: () => void
  title?: string
}

// the face artwork covers 86% of the tile, centred, leaving a margin like other clients
// (picked from a side-by-side comparison; it used to fill the whole face)
const FACE_SCALE = 0.86
const FACE_SIZE = `${FACE_SCALE * 100}%`
const FACE_INSET = `${((1 - FACE_SCALE) / 2) * 100}%`

export function Tile({ tile, w, back, sideways, dim, highlight, mark, deal, wait, raised, hoverable, onClick, title }: Props) {
  const h = Math.round((w * 4) / 3)
  const hidden = back || tile === '?'
  const face = hidden ? null : faceUrl(tile)
  const depth = Math.max(2, Math.round(w / 14))
  const inner = (
    <div
      className="relative overflow-hidden"
      style={{
        width: w,
        height: h,
        borderRadius: w * 0.12,
        background: hidden ? 'var(--tile-back)' : 'var(--tile-face)',
        boxShadow: wait
          ? `0 ${depth}px 0 #10b981, 0 ${depth + 1}px ${depth * 2.5}px rgba(52,211,153,.6)`
          : `0 ${depth}px 0 ${hidden ? 'var(--tile-back-edge)' : 'var(--tile-edge)'}, 0 ${depth + 2}px ${depth * 2}px rgba(0,0,0,.35)`,
      }}
    >
      {face && (
        <img
          src={face}
          alt={tileName(tile)}
          draggable={false}
          className="absolute"
          style={{ left: FACE_INSET, top: FACE_INSET, width: FACE_SIZE, height: FACE_SIZE }}
        />
      )}
      {!hidden && tile === 'P' && (
        // haku is blank in this tile set; draw the usual frame so it reads as a tile
        <div
          className="absolute inset-x-[26%] inset-y-[24%] rounded-[6%]"
          style={{ border: `${Math.max(1, w / 18)}px solid #6f9fd8` }}
        />
      )}
      {hidden && (
        <div
          className="absolute inset-[12%] rounded-[18%] opacity-40"
          style={{ border: `${Math.max(1, w / 24)}px solid var(--tile-back-mark)` }}
        />
      )}
      {highlight && <div className="absolute inset-0 rounded-[inherit] bg-amber-200/20 ring-2 ring-amber-400 ring-inset" />}
      {dim && <div className="absolute inset-0 bg-black/45" />}
    </div>
  )
  // tints cover the face and the tile's edge below it (the box-shadow "thickness"); being inside the tile,
  // they lift with it on mouse-over
  const tint = (cls: string) => (
    <div className={`pointer-events-none absolute ring-2 ring-inset ${cls}`} style={{ left: 0, top: 0, width: w, height: h + depth, borderRadius: w * 0.12 }} />
  )
  const markEl = (
    <>
      {deal && tint('bg-rose-500/30 ring-rose-500')}
      {mark && tint('bg-sky-400/30 ring-sky-400')}
    </>
  )
  return (
    <div
      title={title ?? (hidden ? undefined : tileName(tile))}
      data-tile={hidden ? undefined : tile}
      onClick={onClick}
      className={`relative shrink-0 transition-transform duration-100 ${onClick || hoverable ? 'hover:-translate-y-[10%]' : ''} ${onClick ? 'cursor-pointer' : ''}`}
      style={{
        width: sideways ? h : w,
        height: (sideways ? w : h) + depth,
        transform: raised ? `translateY(-${Math.round(h * 0.18)}px)` : undefined,
      }}
    >
      {sideways ? (
        <div className="absolute" style={{ left: (h - w) / 2, top: (w - h) / 2, transform: 'rotate(-90deg)' }}>
          {inner}
          {markEl}
        </div>
      ) : (
        <>
          {inner}
          {markEl}
        </>
      )}
    </div>
  )
}
