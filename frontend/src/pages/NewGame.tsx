import { useEffect, useState } from 'react'
import { Card, ErrorBox, Shell } from '../components/Shell'
import { type Settings, api, createGame } from '../lib/api'

export function NewGame() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [length, setLength] = useState<'hanchan' | 'tonpuu'>('hanchan')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSettings(s)
        setLength(s.default_length)
      })
      .catch((e) => setError(`无法连接后端：${e.message}`))
  }, [])

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const id = await createGame({ length })
      location.hash = `#/play/${id}`
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const choice = (value: typeof length, label: string, sub: string) => (
    <button
      onClick={() => setLength(value)}
      className={`flex-1 rounded-xl px-5 py-4 text-left ring-1 transition ${length === value ? 'bg-emerald-500/20 ring-emerald-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`}
    >
      <div className="text-[18px] font-bold">{label}</div>
      <div className="text-[13px] text-white/55">{sub}</div>
    </button>
  )

  return (
    <Shell title="开始对局">
      <Card className="max-w-[520px]">
        <div className="text-[13px] text-white/70">对局长度</div>
        <div className="mt-2 flex gap-3">
          {choice('hanchan', '半庄', '东风场 + 南风场')}
          {choice('tonpuu', '东风', '只打东风场')}
        </div>
        {settings && (
          <div className="mt-5 space-y-1 text-[13px] text-white/60">
            <div>
              昵称：<span className="text-white">{settings.player_name}</span>（在「用户」中修改）
            </div>
            <div>
              AI 思考时间：每次 {settings.think_min}–{settings.think_max} 秒（在「设置」中修改）
            </div>
          </div>
        )}
        {error && (
          <div className="mt-4">
            <ErrorBox message={error} />
          </div>
        )}
        <button
          onClick={start}
          disabled={busy || !settings}
          className="mt-6 w-full rounded-full bg-gradient-to-b from-emerald-500 to-emerald-700 py-3 text-[18px] font-bold tracking-widest shadow-lg hover:brightness-110 disabled:opacity-50"
        >
          {busy ? '准备中…' : '开始对局'}
        </button>
      </Card>
    </Shell>
  )
}
