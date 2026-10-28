import { useState } from 'react'
import { HINT_VERB, RYUKYOKU_NAME, YAKUMAN, limitName, yakuName } from '../lib/labels'
import type { Action, Hint } from '../lib/mjai'
import type { TableState } from '../lib/table'
import { SEAT_WIND, tileName } from '../lib/tiles'
import { Tile } from './Tile'
import { Melds } from './TableParts'

// -- action bar ---------------------------------------------------------------

type Group = { key: string; label: string; tone: string; options: Action[] }

const TONE = {
  win: 'from-rose-500 to-red-700',
  riichi: 'from-amber-400 to-orange-600',
  call: 'from-sky-500 to-blue-700',
  pass: 'from-slate-500 to-slate-700',
}

function groupActions(actions: Action[]): Group[] {
  const groups: Group[] = []
  const add = (key: string, label: string, tone: string, pred: (a: Action) => boolean) => {
    const options = actions.filter(pred)
    if (options.length) groups.push({ key, label, tone, options })
  }
  add('hora', actions.some((a) => a.type === 'hora' && a.actor === a.target) ? '自摸' : '荣和', TONE.win, (a) => a.type === 'hora')
  add('reach', '立直', TONE.riichi, (a) => a.type === 'reach')
  add('kan', '杠', TONE.call, (a) => a.type === 'daiminkan' || a.type === 'ankan' || a.type === 'kakan')
  add('pon', '碰', TONE.call, (a) => a.type === 'pon')
  add('chi', '吃', TONE.call, (a) => a.type === 'chi')
  add('ryukyoku', '九种九牌', TONE.pass, (a) => a.type === 'ryukyoku')
  add('none', '跳过', TONE.pass, (a) => a.type === 'none')
  return groups
}

function optionTiles(a: Action): string[] {
  if (a.type === 'chi' || a.type === 'pon' || a.type === 'daiminkan') return a.consumed
  if (a.type === 'ankan') return a.consumed
  if (a.type === 'kakan') return [a.pai]
  return []
}

export function ActionBar({ actions, onAction }: { actions: Action[]; onAction: (a: Action) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const groups = groupActions(actions)
  if (!groups.length) return null
  const openGroup = groups.find((g) => g.key === open)
  return (
    <div className="absolute right-[250px] flex flex-col items-end gap-2" style={{ top: 664 }}>
      {openGroup && openGroup.options.length > 1 && (
        <div className="flex gap-2 rounded-xl bg-black/60 p-2 backdrop-blur">
          {openGroup.options.map((a, i) => (
            <button
              key={i}
              onClick={() => onAction(a)}
              className="flex gap-px rounded-lg p-1.5 hover:bg-white/15"
              title={optionTiles(a).map(tileName).join(' ')}
            >
              {optionTiles(a).map((t, j) => (
                <Tile key={j} tile={t} w={28} />
              ))}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2.5">
        {groups.map((g) => (
          <button
            key={g.key}
            onClick={() => (g.options.length > 1 ? setOpen(open === g.key ? null : g.key) : onAction(g.options[0]))}
            className={`min-w-[84px] rounded-full bg-gradient-to-b ${g.tone} px-5 py-2.5 text-[18px] font-bold tracking-widest text-white shadow-lg ring-1 ring-white/25 transition hover:brightness-110 active:translate-y-px`}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// -- Mortal hint panel ---------------------------------------------------------

export function HintPanel({ hints, chosen, title = 'AI 推荐' }: { hints: Hint[] | null; chosen?: string; title?: string }) {
  return (
    <div className="absolute w-[214px] rounded-xl bg-black/40 p-3" style={{ right: 18, bottom: 140 }}>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-white/85">{title}</span>
        {chosen && <span className="text-[11px] text-white/45">{chosen}</span>}
      </div>
      {!hints?.length ? (
        <div className="py-3 text-center text-[12px] text-white/40">等待决策…</div>
      ) : (
        <div className="flex flex-col gap-2">
          {hints.map((h, i) => (
            <div key={i}>
              <div className="flex items-center gap-2">
                <span className={`w-9 text-[13px] ${i === 0 ? 'font-bold text-amber-300' : 'text-white/75'}`}>
                  {HINT_VERB[h.type]}
                </span>
                <div className="flex gap-px">
                  {h.tiles.slice(0, 4).map((t, j) => (
                    <Tile key={j} tile={t} w={20} />
                  ))}
                </div>
                <span className="ml-auto font-mono text-[12px] text-white/80 tabular-nums">
                  {(h.prob * 100).toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded bg-white/10">
                <div
                  className={`h-full rounded ${i === 0 ? 'bg-amber-300' : 'bg-white/40'}`}
                  style={{ width: `${Math.max(2, h.prob * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// -- results -----------------------------------------------------------------

function Delta({ v }: { v: number }) {
  if (v === 0) return <span className="text-white/40">±0</span>
  return <span className={v > 0 ? 'text-emerald-300' : 'text-rose-300'}>{v > 0 ? `+${v}` : v}</span>
}

function ScoreChanges({ table, deltas }: { table: TableState; deltas: number[] }) {
  return (
    <div className="mt-4 grid grid-cols-4 gap-2 border-t border-white/10 pt-4">
      {[0, 1, 2, 3].map((s) => (
        <div key={s} className="rounded-lg bg-white/5 px-3 py-2 text-center">
          <div className="text-[12px] text-white/60">
            {SEAT_WIND[(s - table.oya + 4) % 4]} · {table.names[s]}
          </div>
          <div className="font-mono text-[18px] tabular-nums">{table.scores[s]}</div>
          <div className="font-mono text-[13px] tabular-nums">
            <Delta v={deltas[s]} />
          </div>
        </div>
      ))}
    </div>
  )
}

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
      <div className="max-h-[820px] w-[820px] overflow-auto rounded-2xl border border-white/15 bg-[#13241c]/95 p-6 text-white shadow-2xl">
        {children}
      </div>
    </div>
  )
}

export function ResultModal({ table, onClose }: { table: TableState; onClose?: () => void }) {
  const total = [0, 1, 2, 3].map((s) =>
    table.horas.reduce((acc, h) => acc + h.deltas[s], 0) + (table.ryukyoku?.deltas[s] ?? 0),
  )
  return (
    <Modal>
      {table.horas.map((h, i) => {
        const yakuman = h.yaku.some(([n]) => YAKUMAN.has(n))
        const limit = limitName(h.han, h.fu, yakuman)
        const tsumo = h.actor === h.target
        return (
          <div key={i} className={i > 0 ? 'mt-6 border-t border-white/10 pt-6' : ''}>
            <div className="flex items-baseline gap-3">
              <span className="text-[26px] font-bold">{table.names[h.actor]}</span>
              <span className={`rounded px-2 py-0.5 text-[15px] font-bold ${tsumo ? 'bg-rose-600' : 'bg-orange-600'}`}>
                {tsumo ? '自摸' : '荣和'}
              </span>
              {!tsumo && <span className="text-[14px] text-white/60">放铳：{table.names[h.target]}</span>}
            </div>
            <div className="mt-4 flex items-end gap-4">
              <div className="flex items-end gap-px">
                {h.hand.map((t, j) => (
                  <Tile key={j} tile={t} w={40} />
                ))}
              </div>
              <Tile tile={h.pai} w={40} highlight />
              <Melds melds={h.melds} actor={h.actor} w={34} />
            </div>
            <div className="mt-4 flex gap-6 text-[12px] text-white/60">
              <div>
                宝牌
                <div className="mt-1 flex gap-px">
                  {table.doraMarkers.map((t, j) => (
                    <Tile key={j} tile={t} w={24} />
                  ))}
                </div>
              </div>
              {h.uraMarkers.length > 0 && (
                <div>
                  里宝牌
                  <div className="mt-1 flex gap-px">
                    {h.uraMarkers.map((t, j) => (
                      <Tile key={j} tile={t} w={24} />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-10 gap-y-1 text-[16px]">
              {h.yaku.map(([name, han]) => (
                <div key={name} className="flex justify-between border-b border-white/5 py-0.5">
                  <span>{yakuName(name)}</span>
                  <span className="text-white/70">{YAKUMAN.has(name) ? '役满' : `${han} 番`}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-baseline gap-4">
              {!yakuman && (
                <span className="text-[18px] text-white/80">
                  {h.han} 番 {h.fu} 符
                </span>
              )}
              {limit && <span className="text-[22px] font-bold text-amber-300">{limit}</span>}
              <span className="ml-auto font-mono text-[30px] font-bold text-amber-200 tabular-nums">
                {h.deltas[h.actor]} 点
              </span>
            </div>
          </div>
        )
      })}
      {table.ryukyoku && (
        <div>
          <div className="text-[26px] font-bold">{RYUKYOKU_NAME[table.ryukyoku.reason] ?? table.ryukyoku.reason}</div>
          <div className="mt-4 flex flex-col gap-3">
            {[0, 1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-4">
                <span className="w-24 text-[14px]">{table.names[s]}</span>
                <span
                  className={`w-12 rounded px-1.5 text-center text-[13px] ${table.ryukyoku!.tenpai[s] ? 'bg-emerald-600' : 'bg-white/10 text-white/50'}`}
                >
                  {table.ryukyoku!.tenpai[s] ? '听牌' : '未听'}
                </span>
                {table.ryukyoku!.tenpai[s] && (
                  <div className="flex gap-px">
                    {table.ryukyoku!.hands[s].map((t, j) => (
                      <Tile key={j} tile={t} w={26} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <ScoreChanges table={table} deltas={total} />
      {onClose && (
        <div className="mt-5 text-right">
          <button onClick={onClose} className="rounded-full bg-emerald-600 px-6 py-2 font-bold hover:bg-emerald-500">
            确定
          </button>
        </div>
      )}
    </Modal>
  )
}

export function EndModal({
  table,
  uma,
  onClose,
  actions,
}: {
  table: TableState
  uma: number[]
  onClose?: () => void
  actions?: React.ReactNode
}) {
  const scores = table.finalScores ?? table.scores
  const order = [0, 1, 2, 3].sort((a, b) => scores[b] - scores[a] || a - b)
  return (
    <Modal>
      <div className="text-center text-[28px] font-bold tracking-widest">终局</div>
      <div className="mt-6 flex flex-col gap-3">
        {order.map((s, rank) => {
          const pt = (scores[s] - 30000) / 1000 + uma[rank] + (rank === 0 ? 20 : 0)
          return (
            <div
              key={s}
              className={`flex items-center gap-5 rounded-xl px-5 py-3 ${rank === 0 ? 'bg-amber-400/15 ring-1 ring-amber-300/50' : 'bg-white/5'}`}
            >
              <span className="w-10 text-[26px] font-bold text-white/80">{rank + 1}</span>
              <span className="flex-1 text-[18px]">{table.names[s]}</span>
              <span className="font-mono text-[22px] tabular-nums">{scores[s]}</span>
              <span className={`w-20 text-right font-mono text-[16px] tabular-nums ${pt >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {pt >= 0 ? '+' : ''}
                {pt.toFixed(1)}
              </span>
            </div>
          )
        })}
      </div>
      {(onClose || actions) && (
        <div className="mt-6 flex justify-end gap-3">
          {actions}
          {onClose && (
            <button onClick={onClose} className="rounded-full bg-emerald-600 px-6 py-2 font-bold hover:bg-emerald-500">
              返回
            </button>
          )}
        </div>
      )}
    </Modal>
  )
}

// -- auto-play settings (left side, like Mahjong Soul) ------------------------

export interface AutoSettings {
  autoSort: boolean // 自动理牌
  autoWin: boolean // 自动和牌
  noCalls: boolean // 不吃碰杠
  autoTsumogiri: boolean // 自动摸切
}

export const DEFAULT_AUTO: AutoSettings = { autoSort: true, autoWin: false, noCalls: false, autoTsumogiri: false }

const AUTO_ITEMS: { key: keyof AutoSettings; label: string; title: string }[] = [
  { key: 'autoSort', label: '自动理牌', title: '关闭后不自动排序：留下的摸牌放在最右边，可以拖动手牌自己整理' },
  { key: 'autoWin', label: '自动和牌', title: '能荣和 / 自摸时自动和牌' },
  { key: 'noCalls', label: '不吃碰杠', title: '别人打牌时自动跳过吃、碰、明杠（不会跳过荣和）' },
  { key: 'autoTsumogiri', label: '自动摸切', title: '每次摸牌后自动打出（不立直、不暗杠；能自摸时不会自动打出）' },
]

export function AutoPanel({ value, onChange }: { value: AutoSettings; onChange: (v: AutoSettings) => void }) {
  return (
    <div className="absolute flex w-[132px] flex-col gap-1.5 rounded-xl bg-black/35 p-2.5" style={{ left: 18, top: 116 }}>
      {AUTO_ITEMS.map(({ key, label, title }) => {
        const on = value[key]
        return (
          <button
            key={key}
            title={title}
            onClick={() => onChange({ ...value, [key]: !on })}
            className="flex items-center justify-between rounded-lg px-2 py-1 text-[13px] text-white/85 hover:bg-white/10"
          >
            {label}
            <span className={`relative h-[18px] w-8 rounded-full transition ${on ? 'bg-emerald-500' : 'bg-white/20'}`}>
              <span
                className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all ${on ? 'left-[16px]' : 'left-[2px]'}`}
              />
            </span>
          </button>
        )
      })}
    </div>
  )
}
