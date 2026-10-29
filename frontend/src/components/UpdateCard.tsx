// 设置 → 更新: check GitHub for a newer version, download it (or git pull in a source checkout), restart.
// Your settings, logs, avatars and the model weights stay; see backend/update.py.

import { useEffect, useState } from 'react'
import { type UpdateCheck, type UpdateStatus, api } from '../lib/api'
import { Card } from './Shell'

const MB = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`
const btn = 'rounded-lg px-4 py-1.5 text-[14px] font-semibold disabled:opacity-50'

export function UpdateCard() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [found, setFound] = useState<UpdateCheck | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    api.updateStatus().then(setStatus).catch(() => {})
  }, [])
  // follow a download
  const loading = status?.phase === 'downloading' || status?.phase === 'unpacking'
  useEffect(() => {
    if (!loading) return
    const t = setInterval(() => api.updateStatus().then(setStatus).catch(() => {}), 800)
    return () => clearInterval(t)
  }, [loading])

  const run = async (what: string, f: () => Promise<void>) => {
    setBusy(what)
    setError(null)
    try {
      await f()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  const check = () => run('check', async () => setFound(await api.updateCheck()))
  const fetchUpdate = () =>
    run('download', async () => {
      const s = await api.updateDownload()
      setStatus(s)
      if (s.pulled !== undefined) {
        setNote(s.pulled || '已是最新')
        setFound(null)
      }
    })
  const restart = () =>
    run('restart', async () => {
      const r = await api.updateRestart()
      if (r.launcher) setRestarting(true)
      else setNote('当前不是由 Hibari 启动器运行的（例如开发模式），请手动重启后端。')
    })

  const git = status?.mode === 'git'
  const ready = status?.phase === 'ready'
  return (
    <Card className="mt-5 max-w-[640px]">
      <div className="flex items-baseline gap-3">
        <div className="text-[15px] font-semibold">更新</div>
        <div className="text-[13px] text-white/55">
          当前版本 <span className="font-mono text-white/80">v{status?.current ?? '…'}</span>
          {git && '（源码运行）'}
        </div>
      </div>
      <div className="mt-1 text-[12px] text-white/45">
        从 GitHub 获取新版本。设置、牌谱、头像、练习记录和模型权重都会保留。
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={`${btn} bg-white/10 hover:bg-white/20`} onClick={check} disabled={!!busy || loading}>
          {busy === 'check' ? '检测中…' : '检测更新'}
        </button>
        {found?.newer && !ready && (
          <button className={`${btn} bg-emerald-600 hover:bg-emerald-500`} onClick={fetchUpdate} disabled={!!busy || loading}>
            {git ? (busy === 'download' ? '拉取中…' : '拉取更新') : `下载更新${found.asset ? `（${MB(found.asset.size)}）` : ''}`}
          </button>
        )}
        {(ready || (git && note !== null && !error)) && (
          <button className={`${btn} bg-amber-500 text-black hover:bg-amber-400`} onClick={restart} disabled={!!busy || restarting}>
            {ready ? `重启并更新到 v${status?.version}` : '重启'}
          </button>
        )}
      </div>

      {found && !found.newer && <div className="mt-3 text-[13px] text-emerald-300">已是最新版本。</div>}
      {found?.newer && (
        <div className="mt-3 text-[13px]">
          <div className="text-white/85">
            {git ? `远端有 ${found.behind} 个新提交` : `新版本 v${found.latest}`}
          </div>
          {found.notes && (
            <pre className="mt-1.5 max-h-40 overflow-y-auto rounded-lg bg-black/30 p-2.5 font-sans text-[12px] whitespace-pre-wrap text-white/60">
              {found.notes}
            </pre>
          )}
        </div>
      )}
      {loading && status && (
        <div className="mt-3">
          <div className="text-[12px] text-white/60">
            {status.phase === 'unpacking' ? '解压中…' : `下载中 ${MB(status.done ?? 0)} / ${MB(status.total ?? 0)}`}
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-white/10">
            <div
              className="h-full rounded bg-emerald-400 transition-[width]"
              style={{ width: status.phase === 'unpacking' ? '100%' : `${((status.done ?? 0) / Math.max(1, status.total ?? 1)) * 100}%` }}
            />
          </div>
        </div>
      )}
      {ready && <div className="mt-3 text-[13px] text-white/70">v{status?.version} 已下载。重启后完成更新（约十几秒），窗口会自动重新打开。</div>}
      {note && <pre className="mt-3 rounded-lg bg-black/30 p-2.5 font-sans text-[12px] whitespace-pre-wrap text-white/65">{note}</pre>}
      {status?.phase === 'error' && <div className="mt-3 text-[13px] text-rose-300">下载失败：{status.error}</div>}
      {error && <div className="mt-3 text-[13px] text-rose-300">{error}</div>}
      {restarting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 text-[16px] text-white">
          正在重启 Hibari…窗口会自动重新打开。
        </div>
      )}
    </Card>
  )
}
