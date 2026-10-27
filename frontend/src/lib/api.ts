import type { Action, Hint, MjaiEvent } from './mjai'

export type ServerMsg =
  | { type: 'event'; event: MjaiEvent; actions?: Action[]; hint?: Hint[]; replay?: boolean }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'saved'; path: string }

export interface NewGameOptions {
  length?: 'hanchan' | 'tonpuu' // default: settings
  seed?: number
}

export async function createGame(opts: NewGameOptions): Promise<string> {
  const res = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ length: opts.length, seed: opts.seed, hints: true }),
  })
  if (!res.ok) throw new Error(`创建对局失败：HTTP ${res.status}`)
  return (await res.json()).game_id
}

export function wsUrl(gameId: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/api/games/${gameId}/ws`
}

// -- settings / logs / stats ------------------------------------------------------

export interface Settings {
  player_name: string
  log_dir: string
  log_dir_resolved?: string
  default_length: 'hanchan' | 'tonpuu'
  think_min: number
  think_max: number
  bot_temps: number[] // the three bots' sampling temperature
  bot_names: string[] // the three bots' display names
  felt: string
  background: string
  assets: Record<string, number> // uploaded asset -> version
  asset_dir?: string
}

export type AssetName = 'avatar_player' | 'avatar_ai1' | 'avatar_ai2' | 'avatar_ai3' | 'felt' | 'background'

/** URL of an uploaded asset (cache-busted by version), or null if none uploaded. */
export function assetUrl(s: Settings | null, name: AssetName): string | null {
  const v = s?.assets?.[name]
  return v ? `/api/assets/${name}?v=${v}` : null
}

export interface GameMeta {
  id: string
  started_at: string
  length: 'hanchan' | 'tonpuu'
  names: string[]
  scores: number[]
  human: number // the human's seat
  rank: number
  point: number
  kyoku: number
  finished: boolean
  size: number
}

export type StatValues = Record<string, number | null>

export interface StatsResponse {
  games: GameMeta[]
  stat: StatValues | null
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* not json */
    }
    throw new Error(detail)
  }
  return res.json()
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export const api = {
  settings: () => fetch('/api/settings').then((r) => json<Settings>(r)),
  saveSettings: (s: Settings) =>
    fetch('/api/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(s) }).then((r) => json<Settings>(r)),
  logs: () => fetch('/api/logs').then((r) => json<{ folder: string; games: GameMeta[] }>(r)),
  log: (id: string) => fetch(`/api/logs/${id}`).then((r) => json<{ id: string; events: MjaiEvent[] }>(r)),
  deleteLog: (id: string) => fetch(`/api/logs/${id}`, { method: 'DELETE' }).then((r) => json<{ deleted: string }>(r)),
  uploadAsset: (name: AssetName, blob: Blob) =>
    fetch(`/api/assets/${name}`, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob }).then((r) =>
      json<Settings>(r),
    ),
  deleteAsset: (name: AssetName) => fetch(`/api/assets/${name}`, { method: 'DELETE' }).then((r) => json<Settings>(r)),
  stats: (gameIds?: string[]) =>
    fetch('/api/stats', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ game_ids: gameIds ?? null }) }).then(
      (r) => json<StatsResponse>(r),
    ),
}
