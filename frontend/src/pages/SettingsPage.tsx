import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Card, ErrorBox, Shell } from '../components/Shell'
import { type AssetName, type Settings, api, assetUrl } from '../lib/api'
import { BACKGROUNDS, FELTS, setSettingsCache } from '../lib/appearance'
import { scaledImage, squareAvatar } from '../lib/image'

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
      const s = await api.saveSettings(next)
      setSettings(s)
      setSettingsCache(s)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(`保存失败：${e instanceof Error ? e.message : e}`)
    }
  }
  // Upload / reset an asset; keeps unsaved form edits, refreshes asset versions.
  const upload = async (name: AssetName, file: File | null) => {
    setError(null)
    try {
      const fresh = file
        ? await api.uploadAsset(name, name.startsWith('avatar') ? await squareAvatar(file) : await scaledImage(file))
        : await api.deleteAsset(name)
      setSettingsCache(fresh)
      setSettings((cur) => (cur ? { ...cur, assets: fresh.assets } : fresh))
      return fresh
    } catch (e) {
      setError(`图片保存失败：${e instanceof Error ? e.message : e}`)
      return null
    }
  }
  return { settings, setSettings, save, upload, error, saved }
}

/** Avatar with 更换 / 恢复默认 buttons. */
export function AvatarPicker({
  settings,
  name,
  label,
  asset,
  size,
  onUpload,
}: {
  settings: Settings
  name: string
  label: ReactNode
  asset: AssetName
  size: number
  onUpload: (name: AssetName, file: File | null) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const url = assetUrl(settings, asset)
  return (
    <div className="flex items-center gap-3">
      <Avatar url={url} name={name} size={size} className="ring-2 ring-white/20" />
      <div>
        <div className="text-[14px]">{label}</div>
        <div className="mt-1.5 flex gap-2">
          <button onClick={() => input.current?.click()} className="rounded-md bg-white/10 px-3 py-1 text-[13px] hover:bg-white/20">
            更换
          </button>
          {url && (
            <button onClick={() => onUpload(asset, null)} className="rounded-md px-2 py-1 text-[13px] text-white/55 hover:text-white">
              恢复默认
            </button>
          )}
        </div>
        <ImageInput inputRef={input} onFile={(f) => onUpload(asset, f)} />
      </div>
    </div>
  )
}

function ImageInput({ inputRef, onFile }: { inputRef: React.RefObject<HTMLInputElement | null>; onFile: (f: File) => void }) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) onFile(f)
      }}
    />
  )
}

function Swatch({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex flex-col items-center gap-1 rounded-lg p-1.5 text-[12px] ${on ? 'bg-emerald-500/20 ring-2 ring-emerald-400' : 'ring-1 ring-white/10 hover:bg-white/10'}`}
    >
      {children}
      <span className="text-white/75">{title}</span>
    </button>
  )
}

/** Preset swatches + a custom-image swatch for the table cloth or the background. */
function AppearanceRow({
  settings,
  field,
  presets,
  onPick,
  onUpload,
}: {
  settings: Settings
  field: 'felt' | 'background'
  presets: [string, string, string][] // key, label, css background
  onPick: (key: string) => void
  onUpload: (f: File) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const custom = assetUrl(settings, field)
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {presets.map(([key, label, css]) => (
          <Swatch key={key} on={settings[field] === key} onClick={() => onPick(key)} title={label}>
            <span className="block h-10 w-14 rounded ring-1 ring-white/15" style={{ background: css }} />
          </Swatch>
        ))}
        <Swatch on={settings[field] === 'custom'} onClick={() => (custom ? onPick('custom') : input.current?.click())} title="自定义图片">
          {custom ? (
            <img src={custom} className="h-10 w-14 rounded object-cover" />
          ) : (
            <span className="flex h-10 w-14 items-center justify-center rounded bg-white/10 text-[18px]">＋</span>
          )}
        </Swatch>
      </div>
      <button onClick={() => input.current?.click()} className="mt-2 text-[12px] text-emerald-300 hover:underline">
        上传图片…
      </button>
      <ImageInput inputRef={input} onFile={onUpload} />
    </>
  )
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
  const { settings, setSettings, save, upload, error, saved } = useSettings()
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
      </Card>

      <Card className="mt-5 max-w-[640px]">
        <div className="text-[15px] font-semibold">外观</div>

        <div className="mt-4 text-[13px] text-white/70">桌布</div>
        <AppearanceRow
          settings={settings}
          field="felt"
          presets={Object.entries(FELTS).map(([k, f]) => [k, f.label, `radial-gradient(ellipse at center, ${f.colors[0]}, ${f.colors[1]})`])}
          onPick={(k) => set('felt', k)}
          onUpload={async (f) => {
            if (await upload('felt', f)) set('felt', 'custom')
          }}
        />

        <div className="mt-5 text-[13px] text-white/70">背景</div>
        <AppearanceRow
          settings={settings}
          field="background"
          presets={Object.entries(BACKGROUNDS).map(([k, b]) => [k, b.label, b.color])}
          onPick={(k) => set('background', k)}
          onUpload={async (f) => {
            if (await upload('background', f)) set('background', 'custom')
          }}
        />

        <div className="mt-6 text-[13px] text-white/70">AI 头像（图片会自动居中裁成正方形）</div>
        <div className="mt-3 grid grid-cols-3 gap-4">
          {(['avatar_ai1', 'avatar_ai2', 'avatar_ai3'] as const).map((a, i) => (
            <AvatarPicker
              key={a}
              settings={settings}
              asset={a}
              name={`Mortal-${'ABC'[i]}`}
              label={`Mortal-${'ABC'[i]}`}
              size={56}
              onUpload={upload}
            />
          ))}
        </div>
        <div className="mt-4 text-[12px] text-white/45">
          图片保存在 <span className="font-mono text-white/65">{settings.asset_dir}</span>。头像上传后立即生效；桌布和背景的选择点「保存」后生效。
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
