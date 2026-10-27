import type { ReactNode } from 'react'

export const NAV = [
  { href: '#/new', label: '对局', desc: '和三个 Mortal 打一局', icon: '🀄' },
  { href: '#/logs', label: '牌谱', desc: '回放、删除已保存的对局', icon: '📜' },
  { href: '#/stats', label: '数据分析', desc: '顺位、和了率、放铳率…', icon: '📊' },
  { href: '#/settings', label: '设置', desc: '牌谱位置、默认规则、AI', icon: '⚙️' },
  { href: '#/user', label: '用户', desc: '昵称与战绩概要', icon: '👤' },
]

/** Page frame for the non-table screens: top bar with navigation. */
export function Shell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const current = location.hash.split('?')[0]
  return (
    <div className="flex h-full flex-col bg-[#0d1813] text-white">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-white/10 bg-black/40 px-4">
        <a href="#/" className="mr-4 text-[16px] font-bold tracking-wide hover:text-emerald-300">
          Mahjong AI Trainer
        </a>
        {NAV.map((n) => (
          <a
            key={n.href}
            href={n.href}
            className={`rounded-md px-3 py-1.5 text-[14px] ${current.startsWith(n.href) ? 'bg-white/15 text-white' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}
          >
            {n.label}
          </a>
        ))}
        <span className="flex-1" />
        {actions}
      </header>
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1100px] px-6 py-6">
          <h1 className="mb-5 text-[22px] font-bold">{title}</h1>
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
