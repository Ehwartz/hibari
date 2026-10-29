// Display aids shared by the game and the replay (the 辅助 menu): one setting each, kept in localStorage,
// so turning one off in a game turns it off in replays too.

import { useState } from 'react'

export interface Aids {
  sameTile: boolean // 同牌高亮
  waits: boolean // 听牌提示
  furiten: boolean // 振听提示
  danger: boolean // 铳率
}

const KEYS: Record<keyof Aids, [key: string, on: boolean]> = {
  sameTile: ['samehl', true],
  waits: ['waits', true],
  furiten: ['furiten', true],
  danger: ['danger', false],
}

function load(): Aids {
  const out = {} as Aids
  for (const [name, [key, on]] of Object.entries(KEYS) as [keyof Aids, [string, boolean]][]) {
    let v: string | null = null
    try {
      v = localStorage.getItem(key)
    } catch {
      // storage blocked: defaults
    }
    out[name] = v === null ? on : v === '1'
  }
  return out
}

export function useAids(): [Aids, (name: keyof Aids, on: boolean) => void] {
  const [aids, setAids] = useState(load)
  const set = (name: keyof Aids, on: boolean) => {
    setAids((a) => ({ ...a, [name]: on }))
    try {
      localStorage.setItem(KEYS[name][0], on ? '1' : '0')
    } catch {
      // storage blocked: only this page
    }
  }
  return [aids, set]
}
