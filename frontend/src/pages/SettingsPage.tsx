import { useEffect, useState } from 'react'
import { Card, ErrorBox, Shell } from '../components/Shell'
import { type Settings, api } from '../lib/api'

/** Shared loader / saver for the settings-backed pages (设置, 用户). */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api
      .settings()
      .then(setSettings)
      .catch((e) => setError(`无法连接后端：${e.message}`))
  }, [])

  const save = async (next: Settings) => {
    setError(null)
    setSaved(false)
    try {
      setSettings(await api.saveSettings(next))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(`保存失败：${e instanceof Error ? e.message : e}`)
    }
  }
  return { settings, setSettings, save, error, saved }
}

export const inputCls =
  'mt-1.5 block w-full rounded-lg bg-white/10 px-3 py-2 text-[14px] text-white ring-1 ring-white/10 outline-none focus:ring-emerald-400'

export function SaveRow({ onSave, saved }: { onSave: () => void; saved: boolean }) {
  return (
    <div className="mt-6 flex items-center gap-3">
      <button onClick={onSave} className="rounded-full bg-emerald-600 px-6 py-2 font-bold hover:bg-emerald-500">
        保存
      </button>
      {saved && <span className="text-[13px] text-emerald-300">已保存</span>}
    </div>
  )
}

export function SettingsPage() {
  const { settings, setSettings, save, error, saved } = useSettings()
  if (!settings)
    return (
      <Shell title="设置">
        {error ? <ErrorBox message={error} /> : <div className="text-white/50">读取中…</div>}
      </Shell>
    )
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings({ ...settings, [k]: v })

  return (
    <Shell title="设置">
      <Card className="max-w-[640px]">
        <label className="block text-[13px] text-white/70">
          牌谱保存文件夹
          <input value={settings.log_dir} onChange={(e) => set('log_dir', e.target.value)} className={`${inputCls} font-mono`} />
        </label>
        <div className="mt-1 text-[12px] text-white/45">
          可以是绝对路径，或相对于项目目录的路径。当前实际位置：
          <span className="font-mono text-white/65">{settings.log_dir_resolved}</span>
          。牌谱列表直接读取这个文件夹，把 .json.gz 牌谱复制进去也会被识别。
        </div>

        <div className="mt-5 text-[13px] text-white/70">默认对局长度</div>
        <div className="mt-1.5 flex gap-2">
          {(['hanchan', 'tonpuu'] as const).map((l) => (
            <button
              key={l}
              onClick={() => set('default_length', l)}
              className={`rounded-lg px-4 py-1.5 text-[14px] ring-1 ${settings.default_length === l ? 'bg-emerald-500/20 ring-emerald-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`}
            >
              {l === 'hanchan' ? '半庄' : '东风'}
            </button>
          ))}
        </div>

        <div className="mt-5 text-[13px] text-white/70">AI 思考时间（每次行动在此范围内随机，秒）</div>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={30}
            step={0.5}
            value={settings.think_min}
            onChange={(e) => set('think_min', Number(e.target.value))}
            className={`${inputCls} mt-0 w-24`}
          />
          <span className="text-white/50">到</span>
          <input
            type="number"
            min={0}
            max={30}
            step={0.5}
            value={settings.think_max}
            onChange={(e) => set('think_max', Number(e.target.value))}
            className={`${inputCls} mt-0 w-24`}
          />
        </div>
        <div className="mt-1 text-[12px] text-white/45">放弃鸣牌时不会停顿；立直后的摸切固定 0.3–1 秒。下一局开始生效。</div>

        <div className="mt-5 text-[12px] text-white/45">
          对局中的自动理牌 / 自动和牌 / 不吃碰杠 / 自动摸切，在对局画面左侧开关。
        </div>

        {error && (
          <div className="mt-4">
            <ErrorBox message={error} />
          </div>
        )}
        <SaveRow onSave={() => save(settings)} saved={saved} />
      </Card>
    </Shell>
  )
}
