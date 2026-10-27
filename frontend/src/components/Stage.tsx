import { type ReactNode, useEffect, useState } from 'react'
import { STAGE_H, STAGE_W } from './Table'

/** Scales the fixed-size table stage to fit the window below a `reserved`-px header. */
export function ScaledStage({ reserved, children }: { reserved: number; children: ReactNode }) {
  const calc = () => Math.min(window.innerWidth / (STAGE_W + 32), (window.innerHeight - reserved) / (STAGE_H + 24))
  const [scale, setScale] = useState(calc)
  useEffect(() => {
    const onResize = () => setScale(calc())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  })
  return (
    <div className="flex flex-1 items-center justify-center">
      <div style={{ width: STAGE_W * scale, height: STAGE_H * scale }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>{children}</div>
      </div>
    </div>
  )
}
