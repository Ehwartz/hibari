import { useEffect, useState } from 'react'
import { Card, ErrorBox, Shell } from '../components/Shell'
import { type BatchStatus, type Settings, api, createGame } from '../lib/api'

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

      <BatchCard />
    </Shell>
  )
}

/** AI 代打 several games back to back (Mortal plays your seat too) to build up logs. */
function BatchCard() {
  const [status, setStatus] = useState<BatchStatus | null>(null)
  const [length, setLength] = useState<'hanchan' | 'tonpuu'>('tonpuu')
  const [count, setCount] = useState(5)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const poll = () =>
      api
        .batch()
        .then((s) => alive && setStatus(s))
        .catch(() => {})
    poll()
    const t = setInterval(poll, 2000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const start = async () => {
    setError(null)
    try {
      setStatus(await api.startBatch(length, count))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const running = status?.running
  const pct = status && status.total ? (status.done / status.total) * 100 : 0
  return (
    <Card className="mt-5 max-w-[520px]">
      <div className="text-[15px] font-semibold">AI 代打积攒牌谱</div>
      <div className="mt-1 text-[12px] text-white/50">
        Mortal 替你连续打完设定的局数（不等待思考时间），牌谱照常保存，标记为「代打」，默认不计入你的数据。代打温度在「设置」中调整。
      </div>
      {running ? (
        <div className="mt-4">
          <div className="flex justify-between text-[13px] text-white/75">
            <span>
              正在打第 {status!.current ?? `${status!.done + 1}/${status!.total}`} 局（{status!.length === 'tonpuu' ? '东风' : '半庄'}）
            </span>
            <span>
              已完成 {status!.done}/{status!.total}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <button
            onClick={() => api.cancelBatch().then(setStatus)}
            disabled={status!.cancelled}
            className="mt-3 rounded-md bg-white/10 px-3 py-1 text-[13px] hover:bg-white/20 disabled:opacity-50"
          >
            {status!.cancelled ? '打完当前这局后停止…' : '停止'}
          </button>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-3">
          <div className="flex rounded-lg bg-white/5 p-1">
            {(['tonpuu', 'hanchan'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLength(l)}
                className={`rounded-md px-3 py-1 text-[13px] ${length === l ? 'bg-emerald-600' : 'text-white/65 hover:bg-white/10'}`}
              >
                {l === 'tonpuu' ? '东风' : '半庄'}
              </button>
            ))}
          </div>
          <input
            type="number"
            min={1}
            max={200}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
            className="w-20 rounded-lg bg-white/10 px-3 py-1.5 text-[14px] ring-1 ring-white/10 outline-none focus:ring-emerald-400"
          />
          <span className="text-[13px] text-white/60">局</span>
          <button onClick={start} className="ml-auto rounded-full bg-emerald-600 px-5 py-1.5 font-bold hover:bg-emerald-500">
            开始代打
          </button>
        </div>
      )}
      {status && !running && status.total > 0 && (
        <div className="mt-3 text-[12px] text-white/55">
          上一批：完成 {status.done}/{status.total} 局{status.cancelled ? '（已停止）' : ''}。
          <a href="#/logs" className="ml-1 text-emerald-300 hover:underline">
            去牌谱查看
          </a>
        </div>
      )}
      {(error || status?.error) && (
        <div className="mt-3">
          <ErrorBox message={error ?? status!.error!} />
        </div>
      )}
    </Card>
  )
}
