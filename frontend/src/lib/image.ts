// Client-side image preparation before upload.

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('无法读取这张图片'))
    img.src = url
  })
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片转换失败'))), type, quality),
  )
}

/** Center-crop to 1:1 and scale to `size` px (PNG). */
export async function squareAvatar(file: File, size = 256): Promise<Blob> {
  const img = await loadImage(file)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
  return toBlob(canvas, 'image/png')
}

/** Scale down so the longer side is at most `max` px (JPEG). */
export async function scaledImage(file: File, max = 1920): Promise<Blob> {
  const img = await loadImage(file)
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * k)
  canvas.height = Math.round(img.naturalHeight * k)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return toBlob(canvas, 'image/jpeg', 0.9)
}
