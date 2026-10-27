import { useEffect, useState } from 'react'
import { type Frame, ReplayViewer } from '../components/ReplayViewer'
import { ErrorBox, Shell } from '../components/Shell'
import { api } from '../lib/api'

export function Replay({ gameId }: { gameId: string }) {
  const [frames, setFrames] = useState<Frame[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .log(gameId)
      .then((r) => setFrames(r.events.map((event) => ({ event }))))
      .catch((e) => setError(`读取牌谱失败：${e.message}`))
  }, [gameId])

  if (error)
    return (
      <Shell title="牌谱回放">
        <ErrorBox message={error} />
      </Shell>
    )
  if (!frames) return <div className="flex h-full items-center justify-center text-white/50">读取中…</div>
  const first = Math.max(0, frames.findIndex((f) => f.event.type === 'start_kyoku'))
  return <ReplayViewer frames={frames} title="牌谱回放" backHref="#/logs" initialIndex={first} defaultOpen />
}
