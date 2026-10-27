// Appearance: table cloth / background presets, applied as CSS variables, and a
// shared settings cache so every page sees the same (and fresh) settings.

import { useEffect, useReducer } from 'react'
import { type Settings, api, assetUrl } from './api'

export const FELTS: Record<string, { label: string; colors: [string, string] }> = {
  green: { label: '经典绿', colors: ['#2a6b4f', '#143a2b'] },
  blue: { label: '深海蓝', colors: ['#285a8a', '#112a46'] },
  red: { label: '酒红', colors: ['#7a2d33', '#3a1317'] },
  purple: { label: '暮紫', colors: ['#5a3b7a', '#281a3b'] },
  brown: { label: '木色', colors: ['#7a5a36', '#38270f'] },
  gray: { label: '石墨', colors: ['#4a5560', '#1d2329'] },
}

export const BACKGROUNDS: Record<string, { label: string; color: string }> = {
  dark: { label: '墨绿', color: '#0b1310' },
  navy: { label: '夜蓝', color: '#0a1120' },
  wine: { label: '暗红', color: '#190c11' },
  charcoal: { label: '炭黑', color: '#121212' },
  slate: { label: '石板', color: '#17212b' },
}

export function applyAppearance(s: Settings | null) {
  const root = document.documentElement.style
  const felt = FELTS[s?.felt ?? 'green'] ?? FELTS.green
  root.setProperty('--felt-1', felt.colors[0])
  root.setProperty('--felt-2', felt.colors[1])
  const feltImg = s?.felt === 'custom' ? assetUrl(s, 'felt') : null
  root.setProperty('--felt-image', feltImg ? `url("${feltImg}")` : 'none')
  const bg = BACKGROUNDS[s?.background ?? 'dark'] ?? BACKGROUNDS.dark
  root.setProperty('--bg', bg.color)
  const bgImg = s?.background === 'custom' ? assetUrl(s, 'background') : null
  root.setProperty('--bg-image', bgImg ? `url("${bgImg}")` : 'none')
}

let current: Settings | null = null
let loading: Promise<Settings> | null = null
const listeners = new Set<() => void>()

export function setSettingsCache(s: Settings) {
  current = s
  applyAppearance(s)
  listeners.forEach((f) => f())
}

export function reloadSettings(): Promise<Settings> {
  loading ??= api
    .settings()
    .then((s) => {
      setSettingsCache(s)
      return s
    })
    .finally(() => (loading = null))
  return loading
}

/** The shared settings (null until loaded); re-renders when they change. */
export function useAppSettings(): Settings | null {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    listeners.add(force)
    if (!current) reloadSettings().catch(() => {})
    return () => {
      listeners.delete(force)
    }
  }, [])
  return current
}

/** Avatar URL per seat (0 = you, 1..3 = Mortal-A/B/C). */
export function seatAvatars(s: Settings | null): (string | null)[] {
  return [assetUrl(s, 'avatar_player'), assetUrl(s, 'avatar_ai1'), assetUrl(s, 'avatar_ai2'), assetUrl(s, 'avatar_ai3')]
}
