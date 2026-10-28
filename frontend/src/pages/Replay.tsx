import { useEffect, useState } from 'react'
import { type Frame, ReplayViewer } from '../components/ReplayViewer'
import { ErrorBox, Shell } from '../components/Shell'
import { type Review, api } from '../lib/api'

export function Replay({ gameId }: { gameId: string }) {
  const [frames, setFrames] = useState<Frame[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    api
      .log(gameId)
      .then((r) => setFrames(r.events.map((event) => ({ event }))))
      .catch((e) => setError(`读取牌谱失败：${e.message}`))
    api
      .review(gameId)
      .then(setReview)
      .catch(() => setReview(null))
  }, [gameId])

  const runReview = async () => {
    setReviewing(true)
    try {
      setReview(await api.runReview(gameId))
    } catch (e) {
      setError(`复盘失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setReviewing(false)
    }
  }

  if (error)
    return (
      <Shell title="牌谱回放">
        <ErrorBox message={error} />
      </Shell>
    )
  if (!frames) return <div className="flex h-full items-center justify-center text-white/50">读取中…</div>
  // ?frame=N, after the hash (#/replay/<id>?frame=N) or in the page URL
  const q = new URLSearchParams(location.hash.split('?')[1] ?? location.search).get('frame')
  const first = q ? Number(q) : Math.max(0, frames.findIndex((f) => f.event.type === 'start_kyoku'))
  return (
    <ReplayViewer
      frames={frames}
      title="牌谱回放"
      backHref="#/logs"
      initialIndex={first}
      defaultOpen
      review={review}
      onRunReview={runReview}
      reviewing={reviewing}
    />
  )
}
