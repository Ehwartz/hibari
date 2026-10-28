import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Card, ErrorBox, Shell } from '../components/Shell'
import { type AssetName, type Settings, api, assetUrl } from '../lib/api'
import { BACKGROUNDS, FELTS, setSettingsCache } from '../lib/appearance'
import { scaledImage, squareAvatar } from '../lib/image'
import { DAN_NAMES, ptRuleText } from '../lib/pt'

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

const DEFAULT_BOT_NAMES = ['AI-A', 'AI-B', 'AI-C']

function tempLabel(t: number) {
  if (t === 0) return '严格'
  if (t <= 0.15) return '接近严格'
  if (t <= 0.4) return '略带随机'
  if (t <= 0.7) return '较随机'
  return '很随机'
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

        <div className="mt-5 text-[13px] text-white/70">pt 计算方式</div>
        <div className="mt-1.5 flex flex-col gap-2">
          {(
            [
              ['score', '点数 + 顺位马', '(终局点数 − 30000)/1000 + 马 20/10/−10/−20，头名再 +20；东风、半庄相同'],
              ['tenhou', '天凤段位 pt（鳳凰卓）', '只看顺位：半庄 +90/+45/0/4位扣分，东风 +60/+30/0/4位扣分（约为半庄的 2/3）'],
            ] as const
          ).map(([mode, label, desc]) => (
            <button
              key={mode}
              onClick={() => set('pt_mode', mode)}
              className={`rounded-lg px-3 py-2 text-left ring-1 ${settings.pt_mode === mode ? 'bg-emerald-500/20 ring-emerald-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`}
            >
              <div className="text-[14px]">{label}</div>
              <div className="text-[12px] text-white/50">{desc}</div>
            </button>
          ))}
        </div>
        {settings.pt_mode === 'tenhou' && (
          <div className="mt-2 flex items-center gap-2 text-[13px] text-white/70">
            段位（决定 4 位扣分）
            <select
              value={settings.pt_dan ?? 7}
              onChange={(e) => set('pt_dan', Number(e.target.value))}
              className="rounded-md bg-white/10 px-2 py-1 text-white outline-none"
            >
              {DAN_NAMES.map((n, i) => (
                <option key={n} value={i + 1} className="bg-[#13241c]">
                  {n}
                </option>
              ))}
            </select>
            <span className="text-white/50">{ptRuleText(settings)}</span>
          </div>
        )}
        <div className="mt-1 text-[12px] text-white/45">切换后，所有牌谱和数据里的 pt 都按新方式重新计算。</div>

        <div className="mt-5 text-[12px] text-white/45">
          对局中的自动理牌 / 自动和牌 / 不吃碰杠 / 自动摸切，在对局画面左侧开关。
        </div>
      </Card>

      <Card className="mt-5 max-w-[640px]">
        <div className="text-[15px] font-semibold">AI 程序</div>
        <label className="mt-3 block text-[13px] text-white/70">
          AI 名称（显示为「{settings.ai_name || 'AI'} 推荐」「{settings.ai_name || 'AI'} 复盘」等）
          <input
            value={settings.ai_name ?? ''}
            maxLength={16}
            placeholder="Mortal"
            onChange={(e) => set('ai_name', e.target.value)}
            className={`${inputCls} w-60`}
          />
        </label>
        <label className="mt-4 block text-[13px] text-white/70">
          AI 程序文件夹
          <input
            value={settings.bot_dir ?? ''}
            onChange={(e) => set('bot_dir', e.target.value)}
            className={`${inputCls} font-mono`}
          />
        </label>
        <div className="mt-1 text-[12px] leading-relaxed text-white/45">
          可以是绝对路径或相对项目目录的路径，需与 Akagi 的 Mortal bot 结构一致（含 model.py、权重等）。
          <br />
          当前正在使用：<span className="font-mono text-white/65">{settings.bot_dir_loaded}</span>
          {settings.bot_dir_resolved && settings.bot_dir_loaded && settings.bot_dir_resolved !== settings.bot_dir_loaded && (
            <span className="ml-1 text-amber-300">（已改为 {settings.bot_dir_resolved}，保存后重启程序生效）</span>
          )}
        </div>
      </Card>

      <Card className="mt-5 max-w-[640px]">
        <div className="text-[15px] font-semibold">AI 对手</div>
        <div className="mt-1 text-[12px] text-white/45">名字、头像和温度都可以分别设置；名字从下一局开始生效。</div>
        <div className="mt-1 text-[12px] text-white/45">
          温度控制出牌的随机度：0 时总是选 AI 认为最好的动作；调高后按概率抽选，越高越随机。设为 0.3
          时，正好按「推荐」面板上显示的概率来选。座位每局随机分配。
        </div>
        <div className="mt-4 flex flex-col gap-4">
          {(['avatar_ai1', 'avatar_ai2', 'avatar_ai3'] as const).map((a, i) => {
            const t = settings.bot_temps?.[i] ?? 0
            const name = settings.bot_names?.[i] ?? DEFAULT_BOT_NAMES[i]
            return (
              <div key={a} className="flex items-center gap-6">
                <div className="w-[190px]">
                  <AvatarPicker
                    settings={settings}
                    asset={a}
                    name={name || DEFAULT_BOT_NAMES[i]}
                    label={<span className="text-white/70">头像</span>}
                    size={52}
                    onUpload={upload}
                  />
                </div>
                <div className="flex-1">
                  <input
                    value={name}
                    maxLength={16}
                    placeholder={DEFAULT_BOT_NAMES[i]}
                    onChange={(e) => {
                      const names = [...(settings.bot_names ?? DEFAULT_BOT_NAMES)]
                      names[i] = e.target.value
                      set('bot_names', names)
                    }}
                    className={`${inputCls} mt-0 py-1.5`}
                  />
                  <div className="mt-2 flex items-baseline justify-between text-[13px]">
                    <span className="text-white/70">温度</span>
                    <span>
                      <span className="font-mono tabular-nums">{t.toFixed(2)}</span>
                      <span className="ml-2 text-white/50">{tempLabel(t)}</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={t}
                    onChange={(e) => {
                      const temps = [...(settings.bot_temps ?? [0, 0, 0])]
                      temps[i] = Number(e.target.value)
                      set('bot_temps', temps)
                    }}
                    className="mt-1 w-full accent-emerald-400"
                  />
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-white/80">AI 代打（AI 替你打）的温度</span>
            <span>
              <span className="font-mono tabular-nums">{(settings.auto_temp ?? 0).toFixed(2)}</span>
              <span className="ml-2 text-white/50">{tempLabel(settings.auto_temp ?? 0)}</span>
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.auto_temp ?? 0}
            onChange={(e) => set('auto_temp', Number(e.target.value))}
            className="mt-1 w-full accent-amber-400"
          />
        </div>
        <div className="mt-3 text-[12px] text-white/45">头像会自动居中裁成正方形。「AI 提示」面板始终按严格（温度 0）的 Mortal 给出建议。</div>
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

        <div className="mt-4 text-[12px] text-white/45">
          图片保存在 <span className="font-mono text-white/65">{settings.asset_dir}</span>。头像上传后立即生效，其余设置点「保存」后生效。
        </div>

        {error && (
          <div className="mt-4">
            <ErrorBox message={error} />
          </div>
        )}
      </Card>

      {/* save: fixed at the right side, stays put while scrolling */}
      <div className="fixed top-24 right-8 z-40 flex w-[150px] flex-col items-center gap-2 rounded-xl border border-white/10 bg-black/60 p-4 shadow-2xl backdrop-blur">
        <button
          onClick={() =>
            save({
              ...settings,
              // an emptied name falls back to the default
              bot_names: (settings.bot_names ?? DEFAULT_BOT_NAMES).map((n, i) => n.trim() || DEFAULT_BOT_NAMES[i]),
            })
          }
          className="w-full rounded-full bg-emerald-600 py-2 font-bold hover:bg-emerald-500"
        >
          保存设置
        </button>
        <span className={`text-[12px] ${saved ? 'text-emerald-300' : 'text-white/45'}`}>{saved ? '已保存 ✓' : '修改后点此保存'}</span>
        <span className="text-center text-[11px] leading-snug text-white/35">头像上传后立即生效，无需保存</span>
      </div>
    </Shell>
  )
}
