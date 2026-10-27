import type { Action, Hint, MjaiEvent } from './mjai'

export type ServerMsg =
  | { type: 'event'; event: MjaiEvent; actions?: Action[]; hint?: Hint[]; replay?: boolean }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'saved'; path: string }

export interface NewGameOptions {
  length: 'hanchan' | 'tonpuu'
  seed?: number
  playerName?: string
}

export async function createGame(opts: NewGameOptions): Promise<string> {
  const res = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ length: opts.length, seed: opts.seed, player_name: opts.playerName || 'You', hints: true }),
  })
  if (!res.ok) throw new Error(`创建对局失败：HTTP ${res.status}`)
  return (await res.json()).game_id
}

export function wsUrl(gameId: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/api/games/${gameId}/ws`
}
