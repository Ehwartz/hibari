import { useEffect, useState } from 'react'
import { type Frame, ReplayViewer } from '../components/ReplayViewer'
import { ErrorBox, Shell } from '../components/Shell'
import { type Review, api } from '../lib/api'

export function Replay({ gameId }: { gameId: string }) {
  const [frames, setFrames] = useState<Frame[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [ranHere, setRanHere] = useState(false) // a review run on this page: show its summary
  // from 终局 → AI 复盘: run the review now (unless there is one) and open the summary when done
  const fromEnd = new URLSearchParams(location.hash.split('?')[1] ?? location.search).has('autoreview')

  useEffect(() => {
    api
      .log(gameId)
      .then((r) => setFrames(r.events.map((event) => ({ event }))))
      .catch((e) => setError(`读取牌谱失败：${e.message}`))
    api
      .review(gameId)
      .then((r) => {
        setReview(r)
        if (!r && fromEnd) runReview()
      })
      .catch(() => setReview(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  useEffect(() => {
    if (!reviewing) return
    const t = setInterval(() => api.reviewProgress(gameId).then((p) => p.running && setProgress([p.done, p.total])).catch(() => {}), 400)
    return () => clearInterval(t)
  }, [reviewing, gameId])

  const runReview = async () => {
    setProgress(null)
    setReviewing(true)
    try {
      setReview(await api.runReview(gameId))
      setRanHere(true)
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
      reviewProgress={progress}
      openSummary={fromEnd || ranHere}
    />
  )
}
