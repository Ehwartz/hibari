// pt of a game for one seat, mirroring backend storage.game_point.

import type { Settings } from './api'

const UMA = [20, 10, -10, -20]

export function gamePoint(scores: number[], seat: number, length: string | undefined, s: Settings | null): number {
  const rank = [0, 1, 2, 3].sort((a, b) => scores[b] - scores[a] || a - b).indexOf(seat) + 1
  if (s?.pt_mode === 'tenhou') {
    const dan = Math.min(10, Math.max(1, s.pt_dan ?? 7))
    const table = length === 'tonpuu' ? [60, 30, 0, -(10 * dan + 10)] : [90, 45, 0, -(15 * dan + 15)]
    return table[rank - 1]
  }
  return Math.round(((scores[seat] - 30000) / 1000 + UMA[rank - 1] + (rank === 1 ? 20 : 0)) * 10) / 10
}

export function ptRuleText(s: Settings | null): string {
  if (s?.pt_mode === 'tenhou') {
    const dan = Math.min(10, Math.max(1, s.pt_dan ?? 7))
    return `天凤段位 pt：半庄 +90/+45/0/−${15 * dan + 15}，东风 +60/+30/0/−${10 * dan + 10}`
  }
  return '点数 + 马：(点数−30000)/1000 + 20/10/−10/−20，头名 +20'
}

export const DAN_NAMES = ['初段', '二段', '三段', '四段', '五段', '六段', '七段', '八段', '九段', '十段']
