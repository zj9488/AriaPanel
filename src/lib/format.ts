export function fmtSpeed(s: string): string {
  const n = Number(s)
  if (!n) return '0 B/s'
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${u[i]}`
}

export function fmtBytes(s: string | number): string {
  const n = Number(s)
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${u[i]}`
}

export function fmtProgress(t: { totalLength: string; completedLength: string }): number {
  const total = Number(t.totalLength) || 0
  const done = Number(t.completedLength) || 0
  return total === 0 ? 0 : Math.round((done / total) * 100)
}

export function etaSeconds(t: { totalLength: string; completedLength: string; downloadSpeed: string }): number {
  const remaining = Number(t.totalLength) - Number(t.completedLength)
  const speed = Number(t.downloadSpeed)
  if (remaining <= 0 || speed <= 0) return Infinity
  return remaining / speed
}

export function fmtEta(t: { totalLength: string; completedLength: string; downloadSpeed: string }): string {
  const secs = etaSeconds(t)
  if (!isFinite(secs)) return '—'
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (d > 0) return `${d}天${h}小时`
  if (h > 0) return `${h}小时${m}分`
  if (m > 0) return `${m}分${s}秒`
  return `${s}秒`
}

export function taskName(t: {
  bittorrent?: { info?: { name?: string } }
  files?: { path?: string }[]
  gid: string
}): string {
  return t.bittorrent?.info?.name || t.files?.[0]?.path?.split(/[\\/]/).pop() || t.gid
}
