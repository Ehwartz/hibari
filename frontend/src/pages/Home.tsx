import { useEffect, useState } from 'react'
import { NAV } from '../components/Shell'
import { type GameMeta, api } from '../lib/api'

/** Main menu. */
export function Home() {
  const [name, setName] = useState<string | null>(null)
  const [recent, setRecent] = useState<GameMeta[] | null>(null)

  useEffect(() => {
    api.settings().then((s) => setName(s.player_name)).catch(() => setName(null))
    api.logs().then((r) => setRecent(r.games.filter((g) => g.finished))).catch(() => setRecent(null))
  }, [])

  const last10 = recent?.slice(0, 10) ?? []
  const avgRank = last10.length ? last10.reduce((a, g) => a + g.rank, 0) / last10.length : null

  return (
    <div className="felt flex h-full flex-col items-center justify-center rounded-none text-white">
      <h1 className="text-[40px] font-black tracking-wider">Mahjong AI Trainer</h1>
      <p className="mt-1 text-[14px] text-white/60">
        四人立直麻将 · 你 vs 三个 Mortal{name ? ` · 欢迎，${name}` : ''}
      </p>

      <div className="mt-10 grid w-[760px] grid-cols-3 gap-4">
        {NAV.map((n, i) => (
          <a
            key={n.href}
            href={n.href}
            className={`group rounded-2xl border border-white/10 bg-black/35 p-5 shadow-lg transition hover:-translate-y-0.5 hover:border-emerald-400/60 hover:bg-black/45 ${i === 0 ? 'col-span-3 flex items-center gap-5 bg-gradient-to-r from-emerald-700/50 to-black/40 py-7' : ''}`}
          >
            <div className={i === 0 ? 'text-[44px]' : 'text-[28px]'}>{n.icon}</div>
            <div>
              <div className={`font-bold ${i === 0 ? 'text-[28px]' : 'mt-2 text-[19px]'}`}>{n.label}</div>
              <div className="mt-0.5 text-[13px] text-white/55">{n.desc}</div>
            </div>
          </a>
        ))}
        <div className="flex flex-col justify-center rounded-2xl border border-white/10 bg-black/25 p-5 text-[13px] text-white/70">
          {recent === null ? (
            <span className="text-white/40">无法连接后端</span>
          ) : recent.length === 0 ? (
            <span>还没有对局记录</span>
          ) : (
            <>
              <div>已完成 {recent.length} 局</div>
              <div className="mt-1">
                最近 {last10.length} 局平均顺位{' '}
                <span className="font-mono text-[18px] text-white">{avgRank!.toFixed(2)}</span>
              </div>
              <div className="mt-2 flex gap-1">
                {last10.map((g) => (
                  <span
                    key={g.id}
                    title={g.started_at}
                    className={`flex h-6 w-6 items-center justify-center rounded text-[12px] font-bold ${g.rank === 1 ? 'bg-amber-400 text-black' : g.rank === 4 ? 'bg-white/10 text-white/60' : 'bg-white/20'}`}
                  >
                    {g.rank}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <a href="#/preview" className="mt-8 text-[12px] text-white/35 hover:text-white/70">
        界面预览（演示数据）
      </a>
    </div>
  )
}
