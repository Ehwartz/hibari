import { useState } from 'react'
import { createGame } from '../lib/api'

const THINK_PRESETS: { label: string; value: [number, number] }[] = [
  { label: '无', value: [0, 0] },
  { label: '0.5–2 秒', value: [0.5, 2] },
  { label: '2–8 秒', value: [2, 8] },
  { label: '0–10 秒', value: [0, 10] },
]

export function Home() {
  const [length, setLength] = useState<'hanchan' | 'tonpuu'>('hanchan')
  const [think, setThink] = useState(2)
  const [name, setName] = useState('You')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const id = await createGame({ length, playerName: name.trim(), think: THINK_PRESETS[think].value })
      location.hash = `#/play/${id}`
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const choice = (value: typeof length, label: string, sub: string) => (
    <button
      onClick={() => setLength(value)}
      className={`flex-1 rounded-xl px-4 py-3 text-left ring-1 transition ${length === value ? 'bg-emerald-500/20 ring-emerald-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`}
    >
      <div className="text-[17px] font-bold">{label}</div>
      <div className="text-[12px] text-white/55">{sub}</div>
    </button>
  )

  return (
    <div className="felt flex h-full items-center justify-center rounded-none">
      <div className="w-[420px] rounded-2xl border border-white/10 bg-black/45 p-7 shadow-2xl">
        <h1 className="text-[26px] font-bold tracking-wide">Mahjong AI Trainer</h1>
        <p className="mt-1 text-[13px] text-white/60">四人立直麻将 · 你 vs 三个 Mortal</p>

        <div className="mt-6 text-[13px] text-white/70">对局长度</div>
        <div className="mt-2 flex gap-3">
          {choice('hanchan', '半庄', '东风场 + 南风场')}
          {choice('tonpuu', '东风', '只打东风场')}
        </div>

        <div className="mt-5 text-[13px] text-white/70">AI 思考时间（每次行动随机）</div>
        <div className="mt-2 flex gap-2">
          {THINK_PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setThink(i)}
              className={`flex-1 rounded-lg py-1.5 text-[13px] ring-1 transition ${think === i ? 'bg-emerald-500/20 ring-emerald-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="mt-5 block text-[13px] text-white/70">
          昵称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            className="mt-2 block w-full rounded-lg bg-white/10 px-3 py-2 text-[15px] text-white ring-1 ring-white/10 outline-none focus:ring-emerald-400"
          />
        </label>

        {error && <div className="mt-4 rounded-lg bg-rose-900/50 px-3 py-2 text-[13px] text-rose-200">{error}</div>}

        <button
          onClick={start}
          disabled={busy}
          className="mt-6 w-full rounded-full bg-gradient-to-b from-emerald-500 to-emerald-700 py-3 text-[18px] font-bold tracking-widest shadow-lg hover:brightness-110 disabled:opacity-50"
        >
          {busy ? '准备中…' : '开始对局'}
        </button>
        <div className="mt-4 text-center text-[12px] text-white/40">
          <a href="#/preview" className="hover:text-white/70">界面预览（无需后端）</a>
        </div>
      </div>
    </div>
  )
}
