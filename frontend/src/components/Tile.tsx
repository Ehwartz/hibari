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
  raised?: boolean
  onClick?: () => void
  title?: string
}

export function Tile({ tile, w, back, sideways, dim, highlight, raised, onClick, title }: Props) {
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
        boxShadow: `0 ${depth}px 0 ${hidden ? 'var(--tile-back-edge)' : 'var(--tile-edge)'}, 0 ${depth + 2}px ${depth * 2}px rgba(0,0,0,.35)`,
      }}
    >
      {face && <img src={face} alt={tileName(tile)} draggable={false} className="absolute inset-0 h-full w-full" />}
      {!hidden && tile === 'P' && (
        // haku is blank in this tile set; draw the usual frame so it reads as a tile
        <div
          className="absolute inset-x-[22%] inset-y-[20%] rounded-[6%]"
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
  return (
    <div
      title={title ?? (hidden ? undefined : tileName(tile))}
      onClick={onClick}
      className={`relative shrink-0 transition-transform duration-100 ${onClick ? 'cursor-pointer hover:-translate-y-[10%]' : ''}`}
      style={{
        width: sideways ? h : w,
        height: (sideways ? w : h) + depth,
        transform: raised ? `translateY(-${Math.round(h * 0.18)}px)` : undefined,
      }}
    >
      {sideways ? (
        <div className="absolute" style={{ left: (h - w) / 2, top: (w - h) / 2, transform: 'rotate(-90deg)' }}>
          {inner}
        </div>
      ) : (
        inner
      )}
    </div>
  )
}
