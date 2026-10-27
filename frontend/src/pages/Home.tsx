import { useEffect, useState } from 'react'
import { Card, ErrorBox, Shell } from '../components/Shell'
import { type GameMeta, type StatValues, api, createGame } from '../lib/api'
import { RankBadge, formatDate } from './Logs'

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`)

/** Start page: quick start, headline numbers, recent games. */
export function Home() {
  const [name, setName] = useState<string | null>(null)
  const [games, setGames] = useState<GameMeta[] | null>(null)
  const [stat, setStat] = useState<StatValues | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .settings()
      .then((s) => setName(s.player_name))
      .catch((e) => setError(`无法连接后端：${e.message}`))
    api
      .logs()
      .then((r) => setGames(r.games.filter((g) => g.finished)))
      .catch(() => setGames([]))
    api
      .stats()
      .then((r) => setStat(r.stat))
      .catch(() => setStat(null))
  }, [])

  const start = async (length: 'hanchan' | 'tonpuu') => {
    setBusy(length)
    setError(null)
    try {
      location.hash = `#/play/${await createGame({ length })}`
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  const quick = (length: 'hanchan' | 'tonpuu', label: string, sub: string) => (
    <button
      onClick={() => start(length)}
      disabled={busy !== null}
      className="flex-1 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-700 px-6 py-4 text-left shadow-lg ring-1 ring-white/15 transition hover:brightness-110 disabled:opacity-50"
    >
      <div className="text-[22px] font-bold tracking-wider">{busy === length ? '准备中…' : label}</div>
      <div className="text-[13px] text-white/75">{sub}</div>
    </button>
  )

  return (
    <Shell title={name ? `欢迎，${name}` : '主页'}>
      {error && (
        <div className="mb-4">
          <ErrorBox message={error} />
        </div>
      )}

      <Card className="felt">
        <div className="text-[13px] text-white/70">快速开始 · 你 vs 三个 Mortal</div>
        <div className="mt-3 flex gap-4">
          {quick('hanchan', '半庄', '东风场 + 南风场')}
          {quick('tonpuu', '东风', '只打东风场')}
        </div>
      </Card>

      <div className="mt-5 grid grid-cols-4 gap-4">
        <Headline label="已完成对局" value={stat?.game != null ? String(stat.game) : '0'} />
        <Headline label="平均顺位" value={stat?.avg_rank != null ? stat.avg_rank.toFixed(2) : '—'} />
        <Headline label="和了率" value={pct(stat?.agari_rate)} />
        <Headline label="放铳率" value={pct(stat?.houjuu_rate)} />
      </div>

      <Card className="mt-5 p-0">
        <div className="flex items-center px-5 pt-4 pb-2">
          <span className="text-[14px] font-semibold">最近对局</span>
          <span className="flex-1" />
          <a href="#/logs" className="text-[13px] text-emerald-300 hover:underline">
            全部牌谱 →
          </a>
        </div>
        {games === null ? (
          <div className="px-5 pb-5 text-[14px] text-white/45">读取中…</div>
        ) : games.length === 0 ? (
          <div className="px-5 pb-5 text-[14px] text-white/55">还没有对局记录，点上面的按钮开始第一局吧。</div>
        ) : (
          <table className="w-full text-[14px]">
            <tbody>
              {games.slice(0, 6).map((g) => (
                <tr key={g.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                  <td className="py-2.5 pl-5">
                    <RankBadge rank={g.rank} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[13px] text-white/75">{formatDate(g.started_at)}</td>
                  <td className="px-3 py-2.5">{g.length === 'tonpuu' ? '东风' : '半庄'}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{g.scores[g.human]}</td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono tabular-nums ${g.point >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}
                  >
                    {g.point >= 0 ? '+' : ''}
                    {g.point.toFixed(1)}
                  </td>
                  <td className="py-2.5 pr-5 text-right">
                    <a href={`#/replay/${g.id}`} className="rounded-md bg-white/10 px-3 py-1 text-[13px] hover:bg-white/20">
                      回放
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Shell>
  )
}

function Headline({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-[13px] text-white/55">{label}</div>
      <div className="mt-1 font-mono text-[30px] font-bold tabular-nums">{value}</div>
    </Card>
  )
}
