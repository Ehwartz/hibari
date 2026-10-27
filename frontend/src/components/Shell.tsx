import { type ReactNode, useEffect, useState } from 'react'
import { api } from '../lib/api'

export const NAV = [
  { href: '#/', label: '主页', icon: '🏠' },
  { href: '#/new', label: '对局', icon: '🀄' },
  { href: '#/logs', label: '牌谱', icon: '📜' },
  { href: '#/stats', label: '数据分析', icon: '📊' },
  { href: '#/settings', label: '设置', icon: '⚙️' },
  { href: '#/user', label: '用户', icon: '👤' },
]

function isCurrent(href: string) {
  const hash = location.hash.split('?')[0] || '#/'
  return href === '#/' ? hash === '#/' || hash === '#' || hash === '' : hash.startsWith(href)
}

function Sidebar() {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    api
      .settings()
      .then((s) => setName(s.player_name))
      .catch(() => setName(null))
  }, [])

  return (
    <aside className="flex w-[210px] shrink-0 flex-col border-r border-white/10 bg-black/45">
      <a href="#/" className="px-5 pt-6 pb-5">
        <div className="text-[18px] leading-tight font-black tracking-wide">Mahjong</div>
        <div className="text-[18px] leading-tight font-black tracking-wide text-emerald-300">AI Trainer</div>
      </a>
      <nav className="flex flex-col gap-1 px-3">
        {NAV.map((n) => {
          const on = isCurrent(n.href)
          return (
            <a
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition ${on ? 'bg-emerald-600/25 text-white ring-1 ring-emerald-500/40' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}
            >
              <span className="w-6 text-center text-[18px]">{n.icon}</span>
              {n.label}
            </a>
          )
        })}
      </nav>
      <div className="flex-1" />
      <div className="border-t border-white/10 px-5 py-4 text-[12px] text-white/45">
        {name ? (
          <a href="#/user" className="block truncate text-[14px] text-white/80 hover:text-white">
            👤 {name}
          </a>
        ) : (
          <span className="text-white/35">后端未连接</span>
        )}
        <a href="#/preview" className="mt-2 block hover:text-white/75">
          界面预览（演示数据）
        </a>
      </div>
    </aside>
  )
}

/** Page frame for the non-table screens: left sidebar + content. */
export function Shell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-full bg-[#0d1813] text-white">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1100px] px-8 py-7">
          <div className="mb-5 flex items-center gap-3">
            <h1 className="text-[22px] font-bold">{title}</h1>
            <span className="flex-1" />
            {actions}
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-white/10 bg-white/[0.04] p-5 ${className}`}>{children}</div>
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="rounded-lg bg-rose-900/50 px-4 py-3 text-[14px] text-rose-100">{message}</div>
}
