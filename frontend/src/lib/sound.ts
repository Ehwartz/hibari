// Table sounds: tile clacks are synthesised with Web Audio (no audio files), call / riichi / win
// voices are short clips generated with VOICEVOX by scripts/make_voices.py
// (src/assets/voice/<player>/<name>.wav). The clips are inlined at build time into small lazy JS
// chunks (data URLs), so the browser never requests a .wav: download managers such as IDM intercept
// audio file requests and give the page an empty response (plus a download prompt).

import voiceCredits from '../assets/voice/credits.json'

/** "VOICEVOX:<character>" per player (the voices' license asks for this credit). */
export const VOICE_CREDITS: Record<string, string> = voiceCredits

// '../assets/voice/ai1/pon.wav' -> () => import(...) resolving to a data: URL
const VOICE_FILES = import.meta.glob<string>('../assets/voice/*/*.wav', { query: '?inline', import: 'default' })

/** Voice clip names, by the event that triggers them. */
export type VoiceName = 'chi' | 'pon' | 'kan' | 'riichi' | 'ron' | 'tsumo'

export interface SoundSettings {
  sound_tiles: number // 0..1
  sound_voice: number // 0..1
}

let ctx: AudioContext | null = null
const clips = new Map<string, Promise<AudioBuffer | null>>()


function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  ctx ??= new AudioContext()
  // browsers start the context suspended until the page got a click / key press
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  return ctx
}

if (typeof window !== 'undefined') {
  const unlock = () => audio()
  window.addEventListener('pointerdown', unlock, { capture: true })
  window.addEventListener('keydown', unlock, { capture: true })
}

/** A tile hitting the table: a short filtered noise burst with a woody resonance. */
export function playClack(volume: number, soft = false) {
  const ac = audio()
  if (!ac || volume <= 0) return
  const t = ac.currentTime
  const len = 0.09
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * len), ac.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.012))
  const noise = ac.createBufferSource()
  noise.buffer = buf
  const band = ac.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = soft ? 2400 : 1900 + Math.random() * 400
  band.Q.value = 3.5
  const tone = ac.createOscillator()
  tone.type = 'sine'
  tone.frequency.setValueAtTime(soft ? 900 : 760 + Math.random() * 80, t)
  const toneGain = ac.createGain()
  toneGain.gain.setValueAtTime(0.35, t)
  toneGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
  const out = ac.createGain()
  out.gain.value = volume * (soft ? 0.35 : 0.9)
  noise.connect(band).connect(out)
  tone.connect(toneGain).connect(out)
  out.connect(ac.destination)
  noise.start(t)
  tone.start(t)
  tone.stop(t + 0.06)
}

function clip(player: string, name: VoiceName): Promise<AudioBuffer | null> {
  const key = `${player}/${name}`
  let p = clips.get(key)
  if (!p) {
    const ac = audio()
    const load = VOICE_FILES[`../assets/voice/${key}.wav`]
    p =
      ac && load
        ? load()
            .then((dataUrl) => fetch(dataUrl)) // a data: URL, decoded locally (no network)
            .then((r) => r.arrayBuffer())
            .then((b) => ac.decodeAudioData(b))
            .catch(() => null) // a missing / broken clip just stays silent
        : Promise.resolve(null)
    clips.set(key, p)
  }
  return p
}

/** The voice of `player` ('human' | 'ai1' | 'ai2' | 'ai3') saying `name`. */
export function playVoice(player: string, name: VoiceName, volume: number) {
  if (volume <= 0) return
  void clip(player, name).then((buf) => {
    const ac = audio()
    if (!buf || !ac) return
    const src = ac.createBufferSource()
    src.buffer = buf
    const gain = ac.createGain()
    gain.gain.value = volume
    src.connect(gain).connect(ac.destination)
    src.start()
  })
}

/** Load a player's clips ahead of time, so the first call isn't late. */
export function preloadVoices(players: string[]) {
  for (const p of players)
    for (const n of ['chi', 'pon', 'kan', 'riichi', 'ron', 'tsumo'] as VoiceName[]) void clip(p, n)
}

/** The voice line for an mjai event, if it has one. */
export function voiceFor(ev: { type: string; actor?: number; target?: number }): VoiceName | null {
  switch (ev.type) {
    case 'chi':
      return 'chi'
    case 'pon':
      return 'pon'
    case 'daiminkan':
    case 'ankan':
    case 'kakan':
      return 'kan'
    case 'reach':
      return 'riichi'
    case 'hora':
      return ev.actor === ev.target ? 'tsumo' : 'ron'
  }
  return null
}
