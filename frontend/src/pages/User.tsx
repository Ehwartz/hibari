import { useEffect, useState } from 'react'
import { Card, ErrorBox, Shell } from '../components/Shell'
import { type GameMeta, api } from '../lib/api'
import { RankBadge, formatDate } from './Logs'
import { AvatarPicker, SaveRow, inputCls, useSettings } from './SettingsPage'

export function User() {
  const { settings, setSettings, save, upload, error, saved } = useSettings()
  const [games, setGames] = useState<GameMeta[] | null>(null)

  useEffect(() => {
    api
      .logs()
      .then((r) => setGames(r.games.filter((g) => g.finished && g.autoplay !== 'full')))
      .catch(() => setGames([]))
  }, [])

  const n = games?.length ?? 0
  const avgRank = n ? games!.reduce((a, g) => a + g.rank, 0) / n : null
  const first = n ? games![n - 1].started_at : null
  const best = n ? Math.max(...games!.map((g) => g.scores[g.human])) : null

  return (
    <Shell title="用户">
      <div className="grid max-w-[900px] grid-cols-[1fr_1fr] gap-4">
        <Card>
          <div className="text-[14px] font-semibold">个人资料</div>
          {settings ? (
            <>
              <div className="mt-4">
                <AvatarPicker
                  settings={settings}
                  asset="avatar_player"
                  name={settings.player_name}
                  label={
                    <span className="text-white/70">
                      头像<span className="ml-1 text-[12px] text-white/45">（自动居中裁成 1:1）</span>
                    </span>
                  }
                  size={88}
                  onUpload={upload}
                />
              </div>
              <label className="mt-4 block text-[13px] text-white/70">
                昵称（对局中显示，牌谱里记录）
                <input
                  value={settings.player_name}
                  maxLength={16}
                  onChange={(e) => setSettings({ ...settings, player_name: e.target.value })}
                  className={inputCls}
                />
              </label>
              <div className="mt-1 text-[12px] text-white/45">改名不影响历史统计：统计按座位识别你，而不是按名字。</div>
              {error && (
                <div className="mt-4">
                  <ErrorBox message={error} />
                </div>
              )}
              <SaveRow onSave={() => save({ ...settings, player_name: settings.player_name.trim() || 'You' })} saved={saved} />
            </>
          ) : error ? (
            <div className="mt-4">
              <ErrorBox message={error} />
            </div>
          ) : (
            <div className="mt-4 text-white/50">读取中…</div>
          )}
        </Card>

        <Card>
          <div className="text-[14px] font-semibold">战绩概要</div>
          {n === 0 ? (
            <div className="mt-4 text-[14px] text-white/55">还没有已完成的对局。</div>
          ) : (
            <div className="mt-4 space-y-2 text-[14px]">
              <Row k="已完成对局" v={`${n} 局`} />
              <Row k="平均顺位" v={avgRank!.toFixed(2)} />
              <Row k="最高终局点数" v={String(best)} />
              <Row k="第一局" v={formatDate(first!)} />
              <div className="flex items-center justify-between pt-1">
                <span className="text-white/55">最近</span>
                <span className="flex gap-1">
                  {games!.slice(0, 10).map((g) => (
                    <RankBadge key={g.id} rank={g.rank} />
                  ))}
                </span>
              </div>
              <a href="#/stats" className="inline-block pt-2 text-[13px] text-emerald-300 hover:underline">
                查看详细数据 →
              </a>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-white/55">{k}</span>
      <span className="font-mono tabular-nums">{v}</span>
    </div>
  )
}
