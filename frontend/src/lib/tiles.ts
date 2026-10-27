// Tiles are mjai strings: 1m..9m, 1p..9p, 1s..9s, E S W N P F C, red fives 5mr 5pr 5sr.
// "?" is a hidden tile.

export type Tile = string

const HONOR_FACE: Record<string, string> = {
  E: 'Ton', S: 'Nan', W: 'Shaa', N: 'Pei', P: 'Haku', F: 'Hatsu', C: 'Chun',
}
const SUIT_FACE: Record<string, string> = { m: 'Man', p: 'Pin', s: 'Sou' }
const HONORS = ['E', 'S', 'W', 'N', 'P', 'F', 'C']

export const isAka = (t: Tile) => t.length === 3 && t.endsWith('r')
export const deaka = (t: Tile) => (isAka(t) ? t.slice(0, 2) : t)

/** 34-index (red fives folded in); hidden tiles sort last. */
export function kind(t: Tile): number {
  if (t === '?') return 99
  const h = HONORS.indexOf(t)
  if (h >= 0) return 27 + h
  return 'mps'.indexOf(t[1]) * 9 + Number(t[0]) - 1
}

export function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => kind(a) - kind(b) || Number(isAka(b)) - Number(isAka(a)))
}

export function faceUrl(t: Tile): string | null {
  if (t === '?') return null
  if (HONOR_FACE[t]) return `/tiles/${HONOR_FACE[t]}.svg`
  return `/tiles/${SUIT_FACE[t[1]]}${t[0]}${isAka(t) ? '-Dora' : ''}.svg`
}

const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
const SUIT_NAME: Record<string, string> = { m: '万', p: '筒', s: '索' }
const HONOR_NAME: Record<string, string> = {
  E: '东', S: '南', W: '西', N: '北', P: '白', F: '发', C: '中',
}

export function tileName(t: Tile): string {
  if (t === '?') return '?'
  if (HONOR_NAME[t]) return HONOR_NAME[t]
  return `${isAka(t) ? '赤' : ''}${NUM[Number(t[0]) - 1]}${SUIT_NAME[t[1]]}`
}

export const WIND_NAME: Record<string, string> = { E: '东', S: '南', W: '西', N: '北' }
export const SEAT_WIND = ['东', '南', '西', '北']
