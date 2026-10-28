import type { ReactNode } from 'react'
import { assetUrl } from '../lib/api'
import { useAppSettings } from '../lib/appearance'
import { Avatar } from './Avatar'

export const NAV = [
  { href: '#/', label: '主页' },
  { href: '#/new', label: '对局' },
  { href: '#/logs', label: '牌谱' },
  { href: '#/drill', label: '练习' },
  { href: '#/stats', label: '数据' },
  { href: '#/settings', label: '设置' },
  { href: '#/user', label: '用户' },
]

function isCurrent(href: string) {
  const hash = location.hash.split('?')[0] || '#/'
  return href === '#/' ? hash === '#/' || hash === '#' || hash === '' : hash.startsWith(href)
}

function Sidebar() {
  const settings = useAppSettings()
  const name = settings?.player_name ?? null

  return (
    <aside className="flex w-[210px] shrink-0 flex-col border-r border-white/10 bg-black/45">
      <a href="#/" className="px-5 pt-6 pb-5">
        <div className="flex items-baseline gap-2">
          <span className="text-[24px] leading-tight font-black tracking-[0.15em]">雲雀</span>
          <span className="text-[13px] font-bold tracking-wider text-emerald-300">Hibari</span>
        </div>
        <div className="mt-0.5 text-[12px] tracking-wide text-white/50">AI 麻雀训练场</div>
      </a>
      <nav className="flex flex-col gap-1 px-3">
        {NAV.map((n) => {
          const on = isCurrent(n.href)
          return (
            <a
              key={n.href}
              href={n.href}
              className={`rounded-lg px-4 py-2.5 text-[15px] tracking-wide transition ${on ? 'bg-emerald-600/25 text-white ring-1 ring-emerald-500/40' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}
            >
              {n.label}
            </a>
          )
        })}
      </nav>
      <div className="flex-1" />
      <div className="border-t border-white/10 px-5 py-4 text-[12px] text-white/45">
        {name ? (
          <a href="#/user" className="flex items-center gap-2.5 text-[14px] text-white/85 hover:text-white">
            <Avatar url={assetUrl(settings, 'avatar_player')} name={name} size={36} />
            <span className="truncate">{name}</span>
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
    <div className="flex h-full bg-black/25 text-white">
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
