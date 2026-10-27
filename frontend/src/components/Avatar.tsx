// Square avatar: the uploaded image, or a default (initial on a gradient picked from the name).

function hue(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360
  return h
}

export function Avatar({ url, name, size, className = '' }: { url: string | null; name: string; size: number; className?: string }) {
  if (url)
    return (
      <img
        src={url}
        alt={name}
        draggable={false}
        className={`shrink-0 rounded-lg object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    )
  const h = hue(name || '?')
  const initial = name.startsWith('Mortal-') ? name.slice(7, 8) : [...(name || '?')][0].toUpperCase()
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-lg font-black text-white/90 select-none ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.46,
        background: `linear-gradient(135deg, hsl(${h} 55% 45%), hsl(${(h + 40) % 360} 60% 25%))`,
      }}
    >
      {initial}
    </div>
  )
}
