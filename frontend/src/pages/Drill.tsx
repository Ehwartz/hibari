// 何切练习: discard decisions from your reviewed games where you differed from the AI, replayed as quizzes.

import { useEffect, useMemo, useRef, useState } from 'react'
import { labelName, qGap, reviewHints } from '../components/ReplayViewer'
import { Card, ErrorBox, Shell } from '../components/Shell'
import { HintPanel } from '../components/Overlays'
import { PracticeTabs } from './Quiz'
import { ScaledStage } from '../components/Stage'
import { Table } from '../components/Table'
import { Tile } from '../components/Tile'
import { type Drill as DrillT, type DrillGrade, type DrillList, type Review, api } from '../lib/api'
import { seatAvatars, useAppSettings } from '../lib/appearance'
import { computeDanger, tileRisks } from '../lib/danger'
import { type MjaiEvent, maskEvent } from '../lib/mjai'
import { type TableState, applyEvent, initialTable } from '../lib/table'
import { formatDate } from './Logs'

/** Labels that are not a tile (reach / kan / win / abortive draw). */
const CALLS = new Set(['reach', 'chi_low', 'chi_mid', 'chi_high', 'pon', 'kan_select', 'hora', 'ryukyoku', 'none'])
const isTile = (label: string) => !CALLS.has(label)

type FilterKey = 'all' | 'bad' | 'wrong' | 'new' | 'riichi'

const FILTERS: { key: FilterKey; label: string; desc: string }[] = [
  { key: 'all', label: '全部', desc: '所有和 AI 不一致的打牌' },
  { key: 'bad', label: '恶手', desc: '你当时的选择 AI 只给了不到 5%' },
  { key: 'wrong', label: '错题', desc: '练习中答错过、还没连续答对的题' },
  { key: 'new', label: '未练习', desc: '还没做过的题' },
  { key: 'riichi', label: '有人立直', desc: '对手立直中的局面（押退判断）' },
]

function matches(d: DrillT, f: FilterKey, mastered: number): boolean {
  const r = d.result
  switch (f) {
    case 'all':
      return true
    case 'bad':
      return d.actual_prob < 0.05
    case 'wrong':
      return !!r && r.correct < r.attempts && r.streak < mastered
    case 'new':
      return !r
    case 'riichi':
      return d.riichi
  }
}

function gradeOf(prob: number, best: boolean, goodProb: number): DrillGrade {
  return best ? 'best' : prob >= goodProb ? 'good' : 'miss'
}

const GRADE_TEXT: Record<DrillGrade, { text: string; tone: string }> = {
  best: { text: '正解', tone: 'text-emerald-300' },
  good: { text: '也可以', tone: 'text-sky-300' },
  miss: { text: '失误', tone: 'text-rose-300' },
}

/** An action label as a small tile, or as text (立直 / 杠 / …). */
function LabelChip({ label, prob }: { label: string; prob?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {isTile(label) ? <Tile tile={label} w={20} /> : <span className="text-[13px]">{labelName(label)}</span>}
      {prob !== undefined && <span className="font-mono text-[12px] text-white/55 tabular-nums">{Math.round(prob * 100)}%</span>}
    </span>
  )
}

// -- overview ------------------------------------------------------------------

export function Drill() {
  const [data, setData] = useState<DrillList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [count, setCount] = useState<number>(10)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const ai = useAppSettings()?.ai_name || 'AI'

  const load = () =>
    api
      .drills()
      .then(setData)
      .catch((e) => setError(`读取失败：${e.message}`))
  useEffect(() => {
    load()
  }, [])

  const reviewAll = async () => {
    if (!data) return
    const ids = data.unreviewed
    setProgress({ done: 0, total: ids.length })
    try {
      for (let i = 0; i < ids.length; i++) {
        await api.runReview(ids[i])
        setProgress({ done: i + 1, total: ids.length })
      }
    } catch (e) {
      setError(`复盘失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setProgress(null)
      load()
    }
  }

  const reset = async () => {
    setConfirmReset(false)
    await api.resetDrills()
    load()
  }

  if (error)
    return (
      <Shell title="何切练习">
        <ErrorBox message={error} />
      </Shell>
    )
  if (!data)
    return (
      <Shell title="何切练习">
        <div className="text-white/50">读取中…</div>
      </Shell>
    )

  const items = data.items
  const done = items.filter((d) => d.result)
  const attempts = done.reduce((n, d) => n + d.result!.attempts, 0)
  const correct = done.reduce((n, d) => n + d.result!.correct, 0)
  const mastered = done.filter((d) => d.result!.streak >= data.mastered).length
  const pool = items.filter((d) => matches(d, filter, data.mastered))
  const n = count === 0 ? pool.length : Math.min(count, pool.length)
  const sorted = [...items].sort((a, b) => b.started_at.localeCompare(a.started_at) || a.index - b.index)
  const btn = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-[13px] ring-1 ${on ? 'bg-emerald-500/20 ring-emerald-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`

  return (
    <Shell title="何切练习" actions={<PracticeTabs />}>
      <div className="grid grid-cols-4 gap-3">
        {[
          ['题库', `${items.length}`, '已复盘对局中和 AI 不一致的打牌'],
          ['已练习', `${done.length}`, `共作答 ${attempts} 次`],
          ['正确率', attempts ? `${((correct / attempts) * 100).toFixed(1)}%` : '—', `正解或 AI ≥ ${Math.round(data.good_prob * 100)}% 的选择算对`],
          ['已掌握', `${mastered}`, `连续答对 ${data.mastered} 次`],
        ].map(([label, value, hint]) => (
          <Card key={label} className="!p-4">
            <div className="text-[12px] text-white/50">{label}</div>
            <div className="mt-1 text-[26px] font-bold tabular-nums">{value}</div>
            <div className="text-[11px] text-white/40">{hint}</div>
          </Card>
        ))}
      </div>

      {data.unreviewed.length > 0 && (
        <Card className="mt-4 flex items-center gap-3">
          <div className="flex-1 text-[14px] text-white/75">
            还有 <b>{data.unreviewed.length}</b> 局你自己打的对局没有复盘，复盘后才会出题（每局几秒）。
          </div>
          <button
            onClick={reviewAll}
            disabled={!!progress}
            className="rounded-lg bg-emerald-700/70 px-4 py-2 text-[14px] hover:bg-emerald-600 disabled:opacity-60"
          >
            {progress ? `${ai} 复盘中 ${progress.done}/${progress.total}…` : `全部复盘`}
          </button>
        </Card>
      )}

      <Card className="mt-4">
        <div className="text-[13px] text-white/70">出题范围</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button key={f.key} className={btn(filter === f.key)} onClick={() => setFilter(f.key)} title={f.desc}>
              {f.label} <span className="text-white/45">{items.filter((d) => matches(d, f.key, data.mastered)).length}</span>
            </button>
          ))}
        </div>
        <div className="mt-1.5 text-[12px] text-white/45">{FILTERS.find((f) => f.key === filter)!.desc}</div>
        <div className="mt-4 text-[13px] text-white/70">题数</div>
        <div className="mt-2 flex gap-2">
          {[10, 20, 0].map((c) => (
            <button key={c} className={btn(count === c)} onClick={() => setCount(c)}>
              {c === 0 ? '全部' : `${c} 题`}
            </button>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <a
            href={n ? `#/drill/run?f=${filter}&n=${count}` : undefined}
            className={`rounded-lg px-6 py-2.5 text-[15px] font-bold ${n ? 'bg-emerald-600 hover:bg-emerald-500' : 'cursor-not-allowed bg-white/10 text-white/40'}`}
          >
            开始练习{n ? `（${n} 题，随机顺序）` : ''}
          </a>
          {!items.length && <span className="text-[13px] text-white/50">先在「牌谱」里复盘几局自己打的对局。</span>}
          <span className="flex-1" />
          {done.length > 0 &&
            (confirmReset ? (
              <span className="flex items-center gap-2 text-[13px]">
                清除所有练习记录？
                <button className="rounded-md bg-rose-700 px-2.5 py-1 hover:bg-rose-600" onClick={reset}>
                  清除
                </button>
                <button className="rounded-md bg-white/10 px-2.5 py-1 hover:bg-white/20" onClick={() => setConfirmReset(false)}>
                  取消
                </button>
              </span>
            ) : (
              <button className="text-[13px] text-white/45 hover:text-white/80" onClick={() => setConfirmReset(true)}>
                重置练习记录
              </button>
            ))}
        </div>
      </Card>

      {sorted.length > 0 && (
        <Card className="mt-4 !p-0">
          <table className="w-full text-[13px]">
            <thead className="text-left text-white/45">
              <tr className="border-b border-white/10">
                <th className="px-4 py-2.5 font-normal">对局</th>
                <th className="px-2 py-2.5 font-normal">局面</th>
                <th className="px-2 py-2.5 font-normal">你当时</th>
                <th className="px-2 py-2.5 font-normal">{ai}</th>
                <th className="px-2 py-2.5 font-normal">练习</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2 whitespace-nowrap text-white/60">{formatDate(d.started_at)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {d.kyoku} · 第 {d.turn} 巡{d.riichi && <span className="ml-1.5 rounded bg-rose-800/60 px-1.5 text-[11px]">立直中</span>}
                  </td>
                  <td className="px-2 py-2">
                    <span className={d.actual_prob < 0.05 ? 'text-rose-300' : ''}>
                      <LabelChip label={d.actual} prob={d.actual_prob} />
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <LabelChip label={d.best} prob={d.best_prob} />
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-white/60">
                    {d.result ? (
                      <>
                        {d.result.correct}/{d.result.attempts}
                        {d.result.streak >= data.mastered ? (
                          <span className="ml-1.5 text-emerald-300">已掌握</span>
                        ) : (
                          <span className={`ml-1.5 ${GRADE_TEXT[d.result.last].tone}`}>{GRADE_TEXT[d.result.last].text}</span>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <a href={`#/replay/${d.game_id}?frame=${d.index}`} className="text-white/50 hover:text-white">
                      牌谱
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Shell>
  )
}

// -- quiz ----------------------------------------------------------------------

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

interface Answer {
  choice: string
  fromDrawn: boolean
  grade: DrillGrade
}

interface Question {
  table: TableState
  review: Review
}

export function DrillRun() {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const filter = (params.get('f') ?? 'all') as FilterKey
  const count = Number(params.get('n') ?? 10)
  const settings = useAppSettings()
  const ai = settings?.ai_name || 'AI'
  const [list, setList] = useState<DrillList | null>(null)
  const [queue, setQueue] = useState<DrillT[] | null>(null)
  const [pos, setPos] = useState(0)
  const [question, setQuestion] = useState<Question | null>(null)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showDanger, setShowDanger] = useState(false)
  const cache = useRef(new Map<string, Promise<{ events: MjaiEvent[]; review: Review }>>())

  useEffect(() => {
    api
      .drills()
      .then((l) => {
        setList(l)
        const pool = shuffle(l.items.filter((d) => matches(d, filter, l.mastered)))
        setQueue(count ? pool.slice(0, count) : pool)
      })
      .catch((e) => setError(`读取失败：${e.message}`))
  }, [filter, count])

  const drill = queue?.[pos]
  const answer = answers[pos]
  const finished = !!queue && pos >= queue.length

  // the position of the current question: the game replayed up to the decision, from your seat
  useEffect(() => {
    if (!drill) return
    setQuestion(null)
    let game = cache.current.get(drill.game_id)
    if (!game) {
      game = Promise.all([api.log(drill.game_id), api.review(drill.game_id)]).then(([log, review]) => {
        if (!review) throw new Error('这局的复盘不见了')
        return { events: log.events, review }
      })
      cache.current.set(drill.game_id, game)
    }
    let live = true
    game
      .then(({ events, review }) => {
        const start = events[0]
        const me = start.type === 'start_game' ? (start.human ?? 0) : 0
        let t = initialTable()
        for (const ev of events.slice(0, drill.index + 1)) t = applyEvent(t, maskEvent(ev, me))
        if (live) setQuestion({ table: t, review })
      })
      .catch((e) => setError(`读取牌谱失败：${e.message}`))
    return () => {
      live = false
    }
  }, [drill])

  const dec = useMemo(() => question?.review.decisions.find((d) => d.index === drill?.index), [question, drill])
  const table = question?.table
  const me = table?.human ?? 0
  const danger = useMemo(() => (table && showDanger ? computeDanger(table, me) : []), [table, showDanger, me])

  const choose = (choice: string, fromDrawn = false) => {
    if (!dec || !drill || answer || !list) return
    const grade = gradeOf(dec.probs[choice] ?? 0, choice === dec.best, list.good_prob)
    setAnswers((a) => {
      const next = [...a]
      next[pos] = { choice, fromDrawn, grade }
      return next
    })
    api.answerDrill(drill.id, choice).catch((e) => setError(`保存失败：${e.message}`))
  }
  const next = () => setPos((p) => p + 1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (answer && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight')) {
        e.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const btn = 'rounded-md bg-white/10 px-2.5 py-1 text-[13px] hover:bg-white/20'
  if (error)
    return (
      <Shell title="何切练习">
        <ErrorBox message={error} />
      </Shell>
    )
  if (!queue) return <div className="flex h-full items-center justify-center text-white/50">读取中…</div>
  if (!queue.length)
    return (
      <Shell title="何切练习">
        <div className="text-white/60">这个范围里没有题目。</div>
        <a href="#/drill" className="mt-4 inline-block rounded-lg bg-white/10 px-4 py-2 hover:bg-white/20">
          返回
        </a>
      </Shell>
    )

  if (finished) {
    const right = answers.filter((a) => a.grade !== 'miss').length
    return (
      <Shell title="何切练习 · 本组结果">
        <Card>
          <div className="text-[15px]">
            本组 {queue.length} 题，答对 <b className="text-emerald-300">{right}</b> 题（正解{' '}
            {answers.filter((a) => a.grade === 'best').length}，可以 {answers.filter((a) => a.grade === 'good').length}，失误{' '}
            {answers.filter((a) => a.grade === 'miss').length}）
          </div>
          <div className="mt-4 flex flex-col gap-1.5">
            {queue.map((d, i) => {
              const a = answers[i]
              return (
                <div key={d.id} className="flex items-center gap-3 text-[13px]">
                  <span className="w-6 text-right text-white/40">{i + 1}</span>
                  <span className="w-44 text-white/70">
                    {d.kyoku} · 第 {d.turn} 巡
                  </span>
                  <span className={`w-12 ${GRADE_TEXT[a.grade].tone}`}>{GRADE_TEXT[a.grade].text}</span>
                  <span className="text-white/45">你</span>
                  <LabelChip label={a.choice} />
                  <span className="ml-3 text-white/45">{ai}</span>
                  <LabelChip label={d.best} prob={d.best_prob} />
                  <a href={`#/replay/${d.game_id}?frame=${d.index}`} className="ml-auto text-white/45 hover:text-white">
                    牌谱
                  </a>
                </div>
              )
            })}
          </div>
          <div className="mt-5 flex gap-3">
            <button
              className="rounded-lg bg-emerald-600 px-5 py-2 font-bold hover:bg-emerald-500"
              onClick={() => {
                setPos(0)
                setAnswers([])
                setQueue(shuffle(list!.items.filter((d) => matches(d, filter, list!.mastered))).slice(0, count || undefined))
              }}
            >
              再来一组
            </button>
            <a href="#/drill" className="rounded-lg bg-white/10 px-5 py-2 hover:bg-white/20">
              返回题库
            </a>
          </div>
        </Card>
      </Shell>
    )
  }

  const tileOptions = dec ? Object.keys(dec.probs).filter(isTile) : []
  const callOptions = dec ? Object.keys(dec.probs).filter((l) => !isTile(l)) : []
  const tileInfo = (tile: string, fromDrawn: boolean) => {
    if (!answer && !danger.length) return undefined
    return {
      risks: danger.length ? tileRisks(danger, tile) : undefined,
      prob: answer && dec ? (dec.probs[tile] ?? 0) : undefined,
      best: answer && dec ? dec.best === tile : undefined,
      actual: answer ? answer.choice === tile && answer.fromDrawn === fromDrawn : undefined,
    }
  }

  return (
    <div className="flex h-full flex-col items-center">
      <div className="flex h-14 w-full shrink-0 items-center gap-3 border-b border-white/10 bg-black/40 px-4 text-white">
        <a href="#/drill" className="mr-1 text-white/60 hover:text-white">
          ←
        </a>
        <span className="font-bold tracking-wide">何切练习</span>
        <span className="font-mono text-[13px] text-white/60 tabular-nums">
          {pos + 1}/{queue.length}
        </span>
        <div className="h-1.5 w-40 overflow-hidden rounded bg-white/10">
          <div className="h-full bg-emerald-400" style={{ width: `${(pos / queue.length) * 100}%` }} />
        </div>
        {drill && (
          <span className="text-[13px] text-white/75">
            {formatDate(drill.started_at)} · {drill.kyoku} · 第 {drill.turn} 巡
          </span>
        )}
        <span className="flex-1" />
        <span className="text-[13px] text-white/55">{answer ? '回车 / 空格：下一题' : '点一张牌作答'}</span>
        <label className="ml-2 flex items-center gap-1.5 text-[13px]" title="作答前显示各张牌的放铳风险条">
          <input type="checkbox" checked={showDanger} onChange={(e) => setShowDanger(e.target.checked)} /> 铳率
        </label>
        <button className={btn} onClick={next}>
          {answer ? '下一题' : '跳过'}
        </button>
      </div>

      <div className="flex w-full flex-1">
        {table && dec ? (
          <ScaledStage reserved={56}>
            {(width) => (
              <Table
                width={width}
                table={table}
                me={me}
                discardable={answer ? undefined : new Set(tileOptions)}
                avatars={seatAvatars(settings, table.players)}
                danger={danger}
                tileInfo={tileInfo}
                onDiscard={answer ? undefined : (pai, fromDrawn) => choose(pai, fromDrawn)}
              >
                {!answer && callOptions.length > 0 && (
                  <div className="absolute right-[250px] flex gap-2.5" style={{ top: 664 }}>
                    {callOptions.map((l) => (
                      <button
                        key={l}
                        onClick={() => choose(l)}
                        className="min-w-[84px] rounded-full bg-gradient-to-b from-amber-500 to-amber-700 px-5 py-2.5 text-[18px] font-bold tracking-widest text-white shadow-lg ring-1 ring-white/25 hover:brightness-110"
                      >
                        {labelName(l)}
                      </button>
                    ))}
                  </div>
                )}
                {answer && (
                  <>
                    <HintPanel hints={reviewHints(dec)} title={`${ai} 推荐`} />
                    {/* right margin, above the hint panel: keeps the rivers and the hand visible */}
                    <div
                      className="absolute flex w-[214px] flex-col gap-2.5 rounded-xl bg-black/60 p-3 text-white"
                      style={{ right: 18, bottom: 330 }}
                    >
                      <span className={`text-[22px] font-bold ${GRADE_TEXT[answer.grade].tone}`}>{GRADE_TEXT[answer.grade].text}</span>
                      <div className="flex flex-col gap-1.5 text-[13px]">
                        <span className="flex items-center gap-2">
                          <span className="w-16 text-white/50">你选</span>
                          <LabelChip label={answer.choice} prob={dec.probs[answer.choice] ?? 0} />
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="w-16 text-white/50">{ai}</span>
                          <LabelChip label={dec.best} prob={dec.probs[dec.best]} />
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="w-16 text-white/50">对局中</span>
                          <LabelChip label={dec.actual} prob={dec.actual_prob} />
                        </span>
                        <span
                          className="mt-1 text-[12px] text-white/55"
                          title="比 AI 首选差多少（AI 的价值估计之差，0 = 首选，越大越亏；不是点数）"
                        >
                          Q 差：你 {qGap(dec, answer.choice)} · 对局中 {qGap(dec, dec.actual)}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <button className="rounded-lg bg-emerald-600 px-4 py-2 font-bold hover:bg-emerald-500" onClick={next}>
                          {pos + 1 < queue.length ? '下一题' : '看结果'}
                        </button>
                        <a
                          href={`#/replay/${drill!.game_id}?frame=${drill!.index}`}
                          className="rounded-lg bg-white/10 px-4 py-1 text-center text-[12px] hover:bg-white/20"
                        >
                          在牌谱中查看
                        </a>
                      </div>
                    </div>
                  </>
                )}
              </Table>
            )}
          </ScaledStage>
        ) : (
          <div className="flex flex-1 items-center justify-center text-white/50">读取中…</div>
        )}
      </div>
    </div>
  )
}
