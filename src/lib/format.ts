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

export function taskName(t: {
  bittorrent?: { info?: { name?: string } }
  files?: { path?: string }[]
  gid: string
}): string {
  return t.bittorrent?.info?.name || t.files?.[0]?.path?.split(/[\\/]/).pop() || t.gid
}
