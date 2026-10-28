import type { Action, Hint, MjaiEvent } from './mjai'

export type ServerMsg =
  | { type: 'event'; event: MjaiEvent; actions?: Action[]; hint?: Hint[]; replay?: boolean }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'saved'; path: string }
  | { type: 'autoplay'; on: boolean }

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
  auto_temp: number // AI 代打 temperature
  ai_name: string // display name of the AI ("<name> 推荐")
  bot_dir: string // AI bot folder (Akagi Mortal layout), restart to apply
  bot_dir_resolved?: string
  bot_dir_loaded?: string // the folder the running backend actually loaded
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
  review: ReviewSummary | null
  autoplay: 'none' | 'partial' | 'full' // AI 代打: none / some decisions / whole game (batch)
}

export interface BatchStatus {
  running: boolean
  length: 'hanchan' | 'tonpuu'
  total: number
  done: number
  current: string | null
  games: string[]
  error: string | null
  cancelled: boolean
}

export interface ReviewSummary {
  decisions: number
  matches: number
  rate: number | null
  bad: number // decisions where Mortal gave the actual action < 5%
}

/** One decision of the human, as judged by Mortal (labels: tiles, reach, chi_low/mid/high, pon, kan_select, hora, ryukyoku, none). */
export interface ReviewDecision {
  index: number // the event the decision replied to
  probs: Record<string, number>
  q: Record<string, number>
  best: string
  actual: string
  actual_prob: number
  match: boolean
  discard: boolean // a discard decision (own turn) rather than a call / pass
}

export interface Review {
  version: number
  human: number
  temperature: number
  summary: ReviewSummary
  decisions: ReviewDecision[]
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
  review: async (id: string): Promise<Review | null> => {
    const r = await fetch(`/api/logs/${id}/review`)
    return r.status === 404 ? null : json<Review>(r)
  },
  runReview: (id: string) => fetch(`/api/logs/${id}/review`, { method: 'POST' }).then((r) => json<Review>(r)),
  batch: () => fetch('/api/batch').then((r) => json<BatchStatus>(r)),
  startBatch: (length: 'hanchan' | 'tonpuu', count: number) =>
    fetch('/api/batch', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ length, count }) }).then((r) =>
      json<BatchStatus>(r),
    ),
  cancelBatch: () => fetch('/api/batch/cancel', { method: 'POST' }).then((r) => json<BatchStatus>(r)),
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
