import { type ReactNode, useEffect, useState } from 'react'
import { STAGE_H, STAGE_MAX_W, STAGE_W } from './Table'

function fit(reserved: number) {
  const scale = Math.min(window.innerWidth / (STAGE_W + 32), (window.innerHeight - reserved) / (STAGE_H + 24))
  // use the spare width instead of leaving black bars (the table itself stays centred)
  const width = Math.round(Math.max(STAGE_W, Math.min(STAGE_MAX_W, (window.innerWidth - 32) / scale)))
  return { scale, width }
}

/** Scales the stage to fit the window below a `reserved`-px header; `children(width)` renders it. */
export function ScaledStage({ reserved, children }: { reserved: number; children: (width: number) => ReactNode }) {
  const [{ scale, width }, setFit] = useState(() => fit(reserved))
  useEffect(() => {
    const onResize = () => setFit(fit(reserved))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [reserved])
  return (
    <div className="flex flex-1 items-center justify-center">
      <div style={{ width: width * scale, height: STAGE_H * scale }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>{children(width)}</div>
      </div>
    </div>
  )
}
