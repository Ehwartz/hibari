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

const jitter = (x: number, r: number) => x * (1 + (Math.random() * 2 - 1) * r)

/** A band-passed noise burst with an exponential decay (seconds), started at `t`. */
function click(ac: AudioContext, out: AudioNode, t: number, freq: number, decay: number, gain: number) {
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * 0.04), ac.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * decay))
  const src = ac.createBufferSource()
  src.buffer = buf
  const band = ac.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = freq
  band.Q.value = 2
  const g = ac.createGain()
  g.gain.value = gain
  src.connect(band).connect(g).connect(out)
  src.start(t)
}

/** A decaying sine: the tile's short "ding". */
function ring(ac: AudioContext, out: AudioNode, t: number, freq: number, decay: number, gain: number) {
  const osc = ac.createOscillator()
  osc.frequency.setValueAtTime(freq, t)
  const g = ac.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
  osc.connect(g).connect(out)
  osc.start(t)
  osc.stop(t + decay + 0.02)
}

/** A tile put on the table ("BD2", picked by ear from a comparison page): a crisp click, a softer
 *  second click as it settles, and a short resin "ding". `soft`: the quieter deal sound. */
export function playClack(volume: number, soft = false) {
  const ac = audio()
  if (!ac || volume <= 0) return
  const t = ac.currentTime
  const out = ac.createGain()
  out.gain.value = volume * (soft ? 0.35 : 1)
  out.connect(ac.destination)
  click(ac, out, t, jitter(3800, 0.08), 0.004, 1)
  click(ac, out, t + 0.02, jitter(3000, 0.08), 0.004, 0.5)
  ring(ac, out, t, jitter(2650, 0.03), 0.04, 0.1)
  ring(ac, out, t, jitter(3950, 0.03), 0.03, 0.05)
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
