// Generated practice: 听牌 (name every wait of a tenpai hand) and 点数计算 (han / fu / payment of a winning hand).

import { useEffect, useState } from 'react'
import { Card, ErrorBox, Shell } from '../components/Shell'
import { Tile } from '../components/Tile'
import { type ScoreQuiz, type WaitQuiz, api } from '../lib/api'
import { limitName, yakuName } from '../lib/labels'
import { KINDS, WIND_NAME } from '../lib/tiles'

/** Tabs of the 练习 section (shown in the page header). */
export function PracticeTabs() {
  const hash = location.hash.split('?')[0]
  const tabs = [
    ['#/drill', '何切练习'],
    ['#/drill/wait', '听牌练习'],
    ['#/drill/score', '点数计算'],
  ]
  return (
    <div className="flex rounded-lg bg-white/5 p-1">
      {tabs.map(([href, label]) => (
        <a
          key={href}
          href={href}
          className={`rounded-md px-3 py-1 text-[13px] ${hash === href ? 'bg-emerald-600 text-white' : 'text-white/65 hover:bg-white/10'}`}
        >
          {label}
        </a>
      ))}
    </div>
  )
}

function Score({ right, total }: { right: number; total: number }) {
  return (
    <span className="text-[13px] text-white/55">
      本次 {right}/{total} 题正确
    </span>
  )
}

const btn = (on = false) =>
  `rounded-lg px-3 py-1.5 text-[13px] ring-1 ${on ? 'bg-emerald-500/20 ring-emerald-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`
const primary = 'rounded-lg bg-emerald-600 px-5 py-2 font-bold hover:bg-emerald-500 disabled:opacity-40'

/** Enter = submit / next. */
function useEnter(fn: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        fn()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}

// -- 听牌练习 --------------------------------------------------------------------

export function WaitQuizPage() {
  const [mode, setMode] = useState<WaitQuiz['mode']>('mixed')
  const [q, setQ] = useState<WaitQuiz | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState(false)
  const [tally, setTally] = useState({ right: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)

  const next = (m = mode) => {
    setShown(false)
    setPicked(new Set())
    api
      .waitQuiz(m)
      .then(setQ)
      .catch((e) => setError(`出题失败：${e.message}`))
  }
  useEffect(() => next(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!q || shown) return
    const ok = q.waits.length === picked.size && q.waits.every((w) => picked.has(w))
    setTally((t) => ({ right: t.right + (ok ? 1 : 0), total: t.total + 1 }))
    setShown(true)
  }
  useEnter(() => (shown ? next() : submit()))

  const toggle = (t: string) => {
    if (shown) return
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(t)) n.delete(t)
      else n.add(t)
      return n
    })
  }
  // chinitsu: only that suit can be a wait
  const suit = q?.mode === 'chinitsu' ? q.hand[0][1] : null
  const rows = suit
    ? [KINDS.filter((k) => k[1] === suit)]
    : [KINDS.slice(0, 9), KINDS.slice(9, 18), KINDS.slice(18, 27), KINDS.slice(27)]
  const ok = q && shown && q.waits.length === picked.size && q.waits.every((w) => picked.has(w))

  return (
    <Shell title="听牌练习" actions={<PracticeTabs />}>
      {error && <ErrorBox message={error} />}
      <div className="mb-4 flex items-center gap-2">
        {(
          [
            ['mixed', '普通'],
            ['chinitsu', '清一色（多面听）'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            className={btn(mode === m)}
            onClick={() => {
              setMode(m)
              next(m)
            }}
          >
            {label}
          </button>
        ))}
        <span className="flex-1" />
        <Score {...tally} />
      </div>
      <Card>
        <div className="text-[13px] text-white/60">这手牌听哪些牌？选出全部听牌（手里已有 4 张的不算），回车提交。</div>
        <div className="mt-4 flex gap-1">{q?.hand.map((t, i) => <Tile key={i} tile={t} w={54} />)}</div>
        <div className="mt-6 flex flex-col gap-2">
          {rows.map((row, r) => (
            <div key={r} className="flex gap-1.5">
              {row.map((t) => {
                const on = picked.has(t)
                const isWait = q?.waits.includes(t)
                const ring = !shown
                  ? on
                    ? 'ring-[3px] ring-emerald-400'
                    : ''
                  : isWait
                    ? on
                      ? 'ring-[3px] ring-emerald-400'
                      : 'ring-[3px] ring-amber-400'
                    : on
                      ? 'ring-[3px] ring-rose-500'
                      : 'opacity-40'
                return (
                  <button key={t} onClick={() => toggle(t)} className={`relative rounded-[6px] ${ring}`}>
                    <Tile tile={t} w={40} />
                    {shown && isWait && !on && (
                      <span className="absolute -top-2 -right-2 rounded bg-amber-400 px-1 text-[10px] font-bold text-black">漏</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-3">
          {!shown ? (
            <>
              <button className={primary} onClick={submit} disabled={!q}>
                提交
              </button>
              <button className="text-[13px] text-white/50 hover:text-white" onClick={submit}>
                不知道，看答案
              </button>
            </>
          ) : (
            <>
              <span className={`text-[18px] font-bold ${ok ? 'text-emerald-300' : 'text-rose-300'}`}>{ok ? '正确' : '不对'}</span>
              <span className="text-[14px] text-white/75">
                听 {q!.waits.length} 种：
                {q!.waits.map((w) => (
                  <span key={w} className="ml-1 inline-block align-middle">
                    <Tile tile={w} w={24} />
                  </span>
                ))}
              </span>
              <span className="flex-1" />
              <button className={primary} onClick={() => next()}>
                下一题
              </button>
            </>
          )}
        </div>
      </Card>
      {shown && q && (
        <Card className="mt-4">
          <div className="mb-3 text-[13px] text-white/60">每种听牌的拆法（和了后的 4 面子 + 雀头，或七对子）</div>
          <div className="flex flex-col gap-3">
            {q.waits.map((w) => (
              <div key={w} className="flex items-start gap-4">
                <div className="flex w-16 items-center gap-1.5 pt-1 text-[12px] text-white/55">
                  和 <Tile tile={w} w={26} />
                </div>
                <div className="flex flex-col gap-1.5">
                  {(q.forms[w] ?? []).map((form, i) => (
                    <div key={i} className="flex gap-3">
                      {form.map((g, j) => (
                        <div key={j} className="flex gap-px">
                          {g.map((t, k) => (
                            <Tile key={k} tile={t} w={26} />
                          ))}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </Shell>
  )
}

// -- 点数计算 --------------------------------------------------------------------

const FU_REASON: Record<string, string> = {
  base: '底符',
  penchan: '边张听',
  kanchan: '嵌张听',
  pair_wait: '单骑听',
  valued_pair: '役牌雀头',
  double_valued_pair: '连风雀头',
  tsumo: '自摸',
  hand_without_fu: '副露平和型（按 30 符）',
  closed_pon: '中张暗刻',
  open_pon: '中张明刻',
  closed_terminal_pon: '幺九暗刻',
  open_terminal_pon: '幺九明刻',
  closed_kan: '中张暗杠',
  open_kan: '中张明杠',
  closed_terminal_kan: '幺九暗杠',
  open_terminal_kan: '幺九明杠',
}

const FU_OPTIONS = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110]

interface ScoreInput {
  han: string
  fu: string
  a: string // ron / all / ko
  b: string // oya (non-dealer tsumo)
}

const num = (s: string) => Number(s.replace(/[^0-9]/g, ''))

export function ScoreQuizPage() {
  const [q, setQ] = useState<ScoreQuiz | null>(null)
  const [input, setInput] = useState<ScoreInput>({ han: '', fu: '', a: '', b: '' })
  const [shown, setShown] = useState(false)
  const [tally, setTally] = useState({ right: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)

  const next = () => {
    setShown(false)
    setInput({ han: '', fu: '', a: '', b: '' })
    api
      .scoreQuiz()
      .then(setQ)
      .catch((e) => setError(`出题失败：${e.message}`))
  }
  useEffect(() => next(), [])

  const a = q?.answer
  const needFu = !!a && a.han <= 4
  const payKeys: [keyof ScoreQuiz['answer']['pay'], string][] = !q
    ? []
    : !q.tsumo
      ? [['ron', '荣和：放铳者支付']]
      : q.oya
        ? [['all', '自摸：每家支付']]
        : [
            ['ko', '自摸：子家各付'],
            ['oya', '亲家付'],
          ]
  const checks = a
    ? {
        han: num(input.han) === a.han,
        fu: !needFu || num(input.fu) === a.fu,
        pay: payKeys.every(([k], i) => num(i === 0 ? input.a : input.b) === a.pay[k]),
      }
    : null
  const ok = !!checks && checks.han && checks.fu && checks.pay

  const submit = () => {
    if (!q || shown) return
    setTally((t) => ({ right: t.right + (ok ? 1 : 0), total: t.total + 1 }))
    setShown(true)
  }
  useEnter(() => (shown ? next() : submit()))

  const mark = (good: boolean | undefined) =>
    shown ? <span className={`ml-1.5 font-bold ${good ? 'text-emerald-300' : 'text-rose-300'}`}>{good ? '✓' : '✗'}</span> : null
  const field = 'w-28 rounded-md bg-white/10 px-2 py-1.5 text-white outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-70'

  return (
    <Shell title="点数计算" actions={<PracticeTabs />}>
      {error && <ErrorBox message={error} />}
      <div className="mb-4 flex items-center">
        <span className="text-[13px] text-white/55">规则同对局：食断、赤宝牌各 1 枚、无切上满贯；本场和供托不计。</span>
        <span className="flex-1" />
        <Score {...tally} />
      </div>
      {q && a && (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              {[
                `${WIND_NAME[q.bakaze]}场`,
                `自风 ${WIND_NAME[q.jikaze]}（${q.oya ? '亲家' : '子家'}）`,
                q.melds.length ? '副露' : '门前',
                ...(q.riichi ? ['立直'] : []),
                q.tsumo ? '自摸和' : '荣和',
              ].map((t) => (
                <span key={t} className="rounded-md bg-white/10 px-2.5 py-1">
                  {t}
                </span>
              ))}
              <span className="ml-2 flex items-center gap-1.5 text-white/60">
                宝牌指示牌
                {q.dora_markers.map((t, i) => (
                  <Tile key={i} tile={t} w={26} />
                ))}
              </span>
            </div>
            <div className="mt-5 flex items-end gap-1">
              {q.hand.map((t, i) => (
                <Tile key={i} tile={t} w={50} />
              ))}
              <div className="ml-4 flex flex-col items-center gap-1">
                <span className="text-[11px] text-amber-300">{q.tsumo ? '自摸' : '荣和'}</span>
                <Tile tile={q.win} w={50} highlight />
              </div>
              {q.melds.map((m, i) => (
                <div key={i} className="ml-4 flex items-end gap-px">
                  {m.tiles.map((t, j) => (
                    <Tile key={j} tile={t} w={40} sideways={j === m.called} />
                  ))}
                </div>
              ))}
            </div>
          </Card>

          <Card className="mt-4">
            <div className="flex flex-wrap items-end gap-6 text-[13px]">
              <label className="flex flex-col gap-1">
                <span className="text-white/60">番数（含宝牌）{mark(checks?.han)}</span>
                <select
                  value={input.han}
                  disabled={shown}
                  onChange={(e) => setInput({ ...input, han: e.target.value })}
                  className={field}
                >
                  <option value="" className="bg-[#13241c]">
                    —
                  </option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h} className="bg-[#13241c]">
                      {h} 番
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-white/60">符数{shown && !needFu ? '（满贯以上不计）' : ''}{shown && needFu ? mark(checks?.fu) : ''}</span>
                <select
                  value={input.fu}
                  disabled={shown}
                  onChange={(e) => setInput({ ...input, fu: e.target.value })}
                  className={field}
                >
                  <option value="" className="bg-[#13241c]">
                    —
                  </option>
                  {FU_OPTIONS.map((f) => (
                    <option key={f} value={f} className="bg-[#13241c]">
                      {f} 符
                    </option>
                  ))}
                </select>
              </label>
              {payKeys.map(([, label], i) => (
                <label key={label} className="flex flex-col gap-1">
                  <span className="text-white/60">
                    {label}
                    {i === payKeys.length - 1 && mark(checks?.pay)}
                  </span>
                  <input
                    inputMode="numeric"
                    value={i === 0 ? input.a : input.b}
                    disabled={shown}
                    onChange={(e) => setInput({ ...input, [i === 0 ? 'a' : 'b']: e.target.value })}
                    placeholder="点"
                    className={field}
                  />
                </label>
              ))}
              <span className="flex-1" />
              {!shown ? (
                <button className={primary} onClick={submit}>
                  提交
                </button>
              ) : (
                <button className={primary} onClick={next}>
                  下一题
                </button>
              )}
            </div>
            <div className="mt-2 text-[12px] text-white/40">满贯及以上可以不填符数；回车提交 / 下一题。</div>
          </Card>

          {shown && (
            <Card className="mt-4">
              <div className="flex items-baseline gap-3">
                <span className={`text-[18px] font-bold ${ok ? 'text-emerald-300' : 'text-rose-300'}`}>{ok ? '正确' : '不对'}</span>
                <span className="text-[16px]">
                  {a.han} 番{needFu ? ` ${a.fu} 符` : ''} {limitName(a.han, a.fu, false)}
                </span>
                <span className="text-[16px] font-bold text-amber-300">
                  {q.tsumo
                    ? q.oya
                      ? `${a.pay.all} 点 ALL（合计 ${a.total}）`
                      : `${a.pay.ko} / ${a.pay.oya} 点（合计 ${a.total}）`
                    : `${a.pay.ron} 点`}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-6 text-[13px]">
                <div>
                  <div className="mb-1.5 text-white/55">役种</div>
                  {a.yaku.map(([name, han]) => (
                    <div key={name} className="flex justify-between border-b border-white/5 py-1">
                      <span>{yakuName(name)}</span>
                      <span className="font-mono">{han} 番</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="mb-1.5 text-white/55">符的计算{needFu ? '' : '（满贯以上不影响点数）'}</div>
                  {a.fu_details.map((f, i) => (
                    <div key={i} className="flex justify-between border-b border-white/5 py-1">
                      <span>
                        {FU_REASON[f.reason] ?? f.reason}
                        {f.reason === 'base' && f.fu === 30 && <span className="text-white/45">（20 + 门前荣和 10）</span>}
                        {f.reason === 'base' && f.fu === 25 && <span className="text-white/45">（七对子固定）</span>}
                      </span>
                      <span className="font-mono">{f.fu} 符</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1 text-white/70">
                    <span>合计 {a.fu_details.reduce((n, f) => n + f.fu, 0)} 符 → 进位</span>
                    <span className="font-mono">{a.fu} 符</span>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </Shell>
  )
}
