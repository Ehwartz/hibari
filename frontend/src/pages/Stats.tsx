import { useEffect, useMemo, useState } from 'react'
import { Card, ErrorBox, Shell } from '../components/Shell'
import { type GameMeta, type StatsResponse, api } from '../lib/api'
import { formatDate } from './Logs'

type Range = 'all' | 10 | 30 | 100
type Length = 'all' | 'hanchan' | 'tonpuu'

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`)
const num = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? '—' : v.toFixed(digits))

// Metric tiles: [stat key, label, formatter, hint]
const GROUPS: { title: string; items: [string, string, (v: number | null) => string, string?][] }[] = [
  {
    title: '和了',
    items: [
      ['agari_rate', '和了率', pct, '和牌局数 / 总局数'],
      ['avg_point_per_agari', '平均打点', (v) => num(v), '每次和牌平均得点'],
      ['avg_agari_jun', '平均和了巡目', (v) => num(v, 1)],
      ['agari_rate_after_riichi', '立直后和了率', pct],
      ['agari_rate_after_fuuro', '副露后和了率', pct],
      ['agari_rate_as_oya', '亲家和了率', pct],
    ],
  },
  {
    title: '放铳',
    items: [
      ['houjuu_rate', '放铳率', pct, '放铳局数 / 总局数'],
      ['avg_point_per_houjuu', '平均铳点', (v) => num(v === null ? null : -v), '每次放铳平均失点'],
      ['avg_houjuu_jun', '平均放铳巡目', (v) => num(v, 1)],
      ['houjuu_rate_after_riichi', '立直后放铳率', pct],
      ['houjuu_rate_after_fuuro', '副露后放铳率', pct],
    ],
  },
  {
    title: '风格',
    items: [
      ['riichi_rate', '立直率', pct, '立直局数 / 总局数'],
      ['fuuro_rate', '副露率', pct, '有副露（不含暗杠）的局数 / 总局数'],
      ['avg_fuuro_num', '平均副露数', (v) => num(v, 2)],
      ['avg_riichi_jun', '平均立直巡目', (v) => num(v, 1)],
      ['chasing_riichi_rate', '追立率', pct],
      ['riichi_chased_rate', '被追立率', pct],
      ['ryukyoku_rate', '流局率', pct],
      ['avg_point_per_round', '每局平均收支', (v) => num(v)],
    ],
  },
]

const HUE = '#34d399' // single series: emerald

export function Stats() {
  const [all, setAll] = useState<GameMeta[] | null>(null)
  const [data, setData] = useState<StatsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<Range>('all')
  const [length, setLength] = useState<Length>('all')

  useEffect(() => {
    api
      .logs()
      .then((r) => setAll(r.games.filter((g) => g.finished)))
      .catch((e) => setError(`读取失败：${e.message}`))
  }, [])

  const selected = useMemo(() => {
    if (!all) return null
    const byLength = all.filter((g) => length === 'all' || g.length === length)
    return range === 'all' ? byLength : byLength.slice(0, range)
  }, [all, range, length])

  useEffect(() => {
    if (!selected) return
    setData(null)
    api
      .stats(selected.map((g) => g.id))
      .then(setData)
      .catch((e) => setError(`统计失败：${e.message}`))
  }, [selected])

  const s = data?.stat ?? null
  const games = data?.games ?? []
  const avgRank = s?.avg_rank ?? null

  const seg = <T extends string | number>(value: T, cur: T, set: (v: T) => void, label: string) => (
    <button
      key={String(value)}
      onClick={() => set(value)}
      className={`rounded-md px-3 py-1 text-[13px] ${cur === value ? 'bg-emerald-600 text-white' : 'text-white/65 hover:bg-white/10'}`}
    >
      {label}
    </button>
  )

  return (
    <Shell title="数据">
      {error && (
        <div className="mb-4">
          <ErrorBox message={error} />
        </div>
      )}
      {/* filters: one row above the charts */}
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="flex rounded-lg bg-white/5 p-1">
          {seg<Range>('all', range, setRange, '全部')}
          {seg<Range>(10, range, setRange, '最近 10 局')}
          {seg<Range>(30, range, setRange, '最近 30 局')}
          {seg<Range>(100, range, setRange, '最近 100 局')}
        </div>
        <div className="flex rounded-lg bg-white/5 p-1">
          {seg<Length>('all', length, setLength, '全部')}
          {seg<Length>('hanchan', length, setLength, '半庄')}
          {seg<Length>('tonpuu', length, setLength, '东风')}
        </div>
        <span className="text-[13px] text-white/45">统计口径与 libriichi（天凤）一致；只统计已完成的对局</span>
      </div>

      {all && all.length === 0 ? (
        <Card>还没有已完成的对局。打完一局后这里会显示统计。</Card>
      ) : !s ? (
        <Card>{data ? '所选范围内没有对局。' : '统计中…'}</Card>
      ) : (
        <>
          {/* headline numbers */}
          <div className="grid grid-cols-4 gap-4">
            <Tile label="对局数" value={String(s.game)} sub={`${s.round} 小局`} />
            <Tile label="平均顺位" value={num(avgRank, 2)} sub="越小越好" />
            <Tile
              label="平均 pt"
              value={s.avg_point === null ? '—' : `${s.avg_point! >= 0 ? '+' : ''}${s.avg_point!.toFixed(1)}`}
              sub={`累计 ${s.total_point! >= 0 ? '+' : ''}${s.total_point!.toFixed(1)}（马 20/10/-10/-20）`}
            />
            <Tile label="被飞率" value={pct(s.tobi_rate)} sub="点数跌破 0" />
          </div>

          <div className="mt-4 grid grid-cols-[1fr_1.6fr] gap-4">
            <Card>
              <div className="mb-3 text-[14px] font-semibold">顺位分布</div>
              <RankBars rates={[s.rank_1_rate, s.rank_2_rate, s.rank_3_rate, s.rank_4_rate]} total={s.game ?? 0} />
            </Card>
            <Card>
              <div className="mb-3 text-[14px] font-semibold">
                顺位走势 <span className="font-normal text-white/45">（最近 {Math.min(games.length, 50)} 局，左旧右新）</span>
              </div>
              <RankTrend games={games.slice(0, 50).reverse()} />
            </Card>
          </div>

          {GROUPS.map((g) => (
            <div key={g.title} className="mt-6">
              <div className="mb-2 text-[14px] font-semibold text-white/80">{g.title}</div>
              <div className="grid grid-cols-4 gap-3">
                {g.items.map(([key, label, fmt, hint]) => (
                  <div key={key} className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3" title={hint}>
                    <div className="text-[12px] text-white/55">{label}</div>
                    <div className="mt-1 font-mono text-[22px] tabular-nums">{fmt(s[key] ?? null)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </Shell>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="text-[13px] text-white/55">{label}</div>
      <div className="mt-1 font-mono text-[34px] leading-tight font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-[12px] text-white/45">{sub}</div>}
    </Card>
  )
}

/** Rank distribution: 4 bars, one hue, value labels above, hover shows counts. */
function RankBars({ rates, total }: { rates: (number | null | undefined)[]; total: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 320
  const H = 180
  const pad = { l: 8, r: 8, t: 22, b: 26 }
  const bw = (W - pad.l - pad.r) / 4
  const max = Math.max(0.25, ...rates.map((r) => r ?? 0))
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  const base = H - pad.b
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="顺位分布">
        <line x1={pad.l} x2={W - pad.r} y1={base} y2={base} stroke="rgba(255,255,255,.18)" />
        {rates.map((r, i) => {
          const v = r ?? 0
          const x = pad.l + i * bw + bw * 0.22
          const w = bw * 0.56
          const top = y(v)
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* hit target larger than the mark */}
              <rect x={pad.l + i * bw} y={pad.t - 20} width={bw} height={base - pad.t + 20} fill="transparent" />
              {base - top >= 4 && (
                <path
                  d={`M${x},${base} V${top + 4} Q${x},${top} ${x + 4},${top} H${x + w - 4} Q${x + w},${top} ${x + w},${top + 4} V${base} Z`}
                  fill={HUE}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              <text x={x + w / 2} y={top - 6} textAnchor="middle" fontSize="12" fill="rgba(255,255,255,.85)">
                {(v * 100).toFixed(1)}%
              </text>
              <text x={x + w / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="rgba(255,255,255,.6)">
                {i + 1} 位
              </text>
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 right-0 rounded-md bg-black/80 px-2.5 py-1.5 text-[12px]">
          {hover + 1} 位：{Math.round((rates[hover] ?? 0) * total)} 次 / {total} 局
        </div>
      )}
    </div>
  )
}

/** Rank per game, oldest -> newest; 1st at the top. */
function RankTrend({ games }: { games: GameMeta[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 560
  const H = 180
  const pad = { l: 34, r: 12, t: 12, b: 20 }
  if (games.length === 0) return <div className="text-[13px] text-white/45">无数据</div>
  const step = games.length > 1 ? (W - pad.l - pad.r) / (games.length - 1) : 0
  const x = (i: number) => (games.length > 1 ? pad.l + i * step : (W + pad.l - pad.r) / 2)
  const y = (rank: number) => pad.t + ((rank - 1) / 3) * (H - pad.t - pad.b)
  const points = games.map((g, i) => `${x(i)},${y(g.rank)}`).join(' ')
  const g = hover !== null ? games[hover] : null
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="顺位走势"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - box.left) / box.width) * W
          const i = games.length > 1 ? Math.round((px - pad.l) / step) : 0
          setHover(Math.max(0, Math.min(games.length - 1, i)))
        }}
      >
        {[1, 2, 3, 4].map((r) => (
          <g key={r}>
            <line x1={pad.l} x2={W - pad.r} y1={y(r)} y2={y(r)} stroke="rgba(255,255,255,.08)" />
            <text x={pad.l - 8} y={y(r) + 4} textAnchor="end" fontSize="11" fill="rgba(255,255,255,.5)">
              {r} 位
            </text>
          </g>
        ))}
        <polyline points={points} fill="none" stroke={HUE} strokeWidth={2} strokeLinejoin="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,.3)" />}
        {games.map((gm, i) => (
          <circle key={gm.id} cx={x(i)} cy={y(gm.rank)} r={hover === i ? 5.5 : 4} fill={HUE} stroke="#0d1813" strokeWidth={2} />
        ))}
      </svg>
      {g && (
        <div className="pointer-events-none absolute top-0 right-0 rounded-md bg-black/80 px-2.5 py-1.5 text-[12px]">
          {formatDate(g.started_at)} · {g.length === 'tonpuu' ? '东风' : '半庄'} · {g.rank} 位 · {g.scores[0]} 点
        </div>
      )}
    </div>
  )
}
