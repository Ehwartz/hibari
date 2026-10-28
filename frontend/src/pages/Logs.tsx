import { useEffect, useState } from 'react'
import { Card, ErrorBox, Shell } from '../components/Shell'
import { type GameMeta, api } from '../lib/api'

export function formatDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function RankBadge({ rank }: { rank: number }) {
  const tone = ['bg-amber-400 text-black', 'bg-slate-300 text-black', 'bg-orange-800/80 text-white', 'bg-white/10 text-white/60'][
    rank - 1
  ]
  return <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-[14px] font-bold ${tone}`}>{rank}</span>
}

export function Logs() {
  const [data, setData] = useState<{ folder: string; games: GameMeta[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<Set<string>>(new Set())

  const review = async (id: string) => {
    setReviewing((s) => new Set(s).add(id))
    try {
      await api.runReview(id)
      await load()
    } catch (e) {
      setError(`复盘失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setReviewing((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    }
  }

  const load = () =>
    api
      .logs()
      .then(setData)
      .catch((e) => setError(`读取失败：${e.message}`))
  useEffect(() => {
    load()
  }, [])

  const remove = async (id: string) => {
    try {
      await api.deleteLog(id)
      setConfirm(null)
      load()
    } catch (e) {
      setError(`删除失败：${e instanceof Error ? e.message : e}`)
    }
  }

  return (
    <Shell
      title="牌谱"
      actions={
        <button onClick={load} className="rounded-md bg-white/10 px-3 py-1.5 text-[13px] hover:bg-white/20">
          刷新
        </button>
      }
    >
      {error && (
        <div className="mb-4">
          <ErrorBox message={error} />
        </div>
      )}
      {data && (
        <>
          <div className="mb-3 text-[13px] text-white/50">
            保存位置：<span className="font-mono text-white/75">{data.folder}</span>（可在「设置」中修改）
          </div>
          {data.games.length === 0 ? (
            <Card>还没有牌谱。打完一局后会自动保存在这里。</Card>
          ) : (
            <Card className="p-0">
              <table className="w-full text-[14px]">
                <thead className="text-left text-[12px] text-white/50">
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-2.5 font-normal">时间</th>
                    <th className="px-2 py-2.5 font-normal">类型</th>
                    <th className="px-2 py-2.5 font-normal">顺位</th>
                    <th className="px-2 py-2.5 text-right font-normal">终局点数</th>
                    <th className="px-2 py-2.5 text-right font-normal">pt</th>
                    <th className="px-2 py-2.5 text-right font-normal">局数</th>
                    <th className="px-3 py-2.5 font-normal">AI 复盘</th>
                    <th className="w-[230px] px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {data.games.map((g) => (
                    <tr key={g.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                      <td className="px-4 py-2.5 font-mono text-[13px] text-white/80">{formatDate(g.started_at)}</td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        {g.length === 'tonpuu' ? '东风' : '半庄'}
                        {g.autoplay !== 'none' && (
                          <span
                            className={`ml-1.5 rounded px-1 text-[11px] ${g.autoplay === 'full' ? 'bg-amber-500/30 text-amber-200' : 'bg-white/10 text-white/60'}`}
                            title={g.autoplay === 'full' ? '整局由 AI 代打' : '部分决策由 AI 代打'}
                          >
                            {g.autoplay === 'full' ? '代打' : '部分代打'}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5">
                        {g.finished ? <RankBadge rank={g.rank} /> : <span className="text-white/40">未完成</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums">{g.scores[g.human]}</td>
                      <td
                        className={`px-2 py-2.5 text-right font-mono tabular-nums ${g.point >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}
                      >
                        {g.point >= 0 ? '+' : ''}
                        {g.point.toFixed(1)}
                      </td>
                      <td className="px-2 py-2.5 text-right text-white/70 tabular-nums">{g.kyoku}</td>
                      <td className="w-[150px] px-3 py-2.5 whitespace-nowrap">
                        {g.review ? (
                          <span
                            className="rounded-md bg-emerald-700/40 px-2 py-0.5 text-[13px]"
                            title={`一致 ${g.review.matches}/${g.review.decisions}，恶手 ${g.review.bad} 处`}
                          >
                            ✓ 一致率 {g.review.rate === null ? '—' : `${(g.review.rate * 100).toFixed(1)}%`}
                          </span>
                        ) : g.finished ? (
                          <button
                            onClick={() => review(g.id)}
                            disabled={reviewing.has(g.id)}
                            className="rounded-md bg-white/10 px-3 py-1 text-[13px] hover:bg-white/20 disabled:opacity-60"
                          >
                            {reviewing.has(g.id) ? '复盘中…' : '复盘'}
                          </button>
                        ) : (
                          <span className="text-white/35">—</span>
                        )}
                      </td>
                      <td className="w-[230px] px-4 py-2.5 text-right whitespace-nowrap">
                        {confirm === g.id ? (
                          <>
                            <button onClick={() => remove(g.id)} className="rounded-md bg-rose-600 px-3 py-1 text-[13px] hover:bg-rose-500">
                              确认删除
                            </button>
                            <button
                              onClick={() => setConfirm(null)}
                              className="ml-2 rounded-md bg-white/10 px-3 py-1 text-[13px] hover:bg-white/20"
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <a
                              href={`#/replay/${g.id}`}
                              className="rounded-md bg-emerald-600/80 px-3 py-1 text-[13px] hover:bg-emerald-500"
                            >
                              回放
                            </a>
                            <button
                              onClick={() => setConfirm(g.id)}
                              className="ml-2 rounded-md bg-white/10 px-3 py-1 text-[13px] hover:bg-rose-700/70"
                            >
                              删除
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </Shell>
  )
}
