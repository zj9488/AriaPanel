import { getCurrentWindow, LogicalSize, LogicalPosition } from '@tauri-apps/api/window'

export function useWindowGeometry() {
  const win = getCurrentWindow()
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  async function save() {
    try {
      const size = await win.outerSize()
      const pos = await win.outerPosition()
      const scale = await win.scaleFactor()
      localStorage.setItem('ap:winW', String(Math.round(size.width / scale)))
      localStorage.setItem('ap:winH', String(Math.round(size.height / scale)))
      localStorage.setItem('ap:winX', String(Math.round(pos.x / scale)))
      localStorage.setItem('ap:winY', String(Math.round(pos.y / scale)))
    } catch { }
  }

  function debounceSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 500)
  }

  async function restore() {
    const w = localStorage.getItem('ap:winW')
    const h = localStorage.getItem('ap:winH')
    const x = localStorage.getItem('ap:winX')
    const y = localStorage.getItem('ap:winY')
    if (w && h) {
      try { await win.setSize(new LogicalSize(Number(w), Number(h))) } catch { }
    }
    if (x && y) {
      try { await win.setPosition(new LogicalPosition(Number(x), Number(y))) } catch { }
    }
  }

  function start() {
    restore()
    win.onResized(debounceSave)
    win.onMoved(debounceSave)
  }

  return { start, save }
}
