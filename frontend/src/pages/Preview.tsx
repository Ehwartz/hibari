// UI preview without a backend: a recorded Mortal x4 game (src/mock/game.json,
// exported by scripts/export_mock.py) from seat 0's view, with its decisions.

import { type Frame, ReplayViewer, interestingFrame } from '../components/ReplayViewer'
import mock from '../mock/game.json'

const frames = (mock as unknown as { frames: Frame[] }).frames

export function Preview() {
  const q = new URLSearchParams(location.search).get('frame')
  return (
    <ReplayViewer
      frames={frames}
      title="界面预览"
      backHref="#/"
      initialIndex={q ? Number(q) : interestingFrame(frames)}
    />
  )
}
