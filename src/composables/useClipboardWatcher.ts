import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { getCurrentWindow } from '@tauri-apps/api/window'

const URL_RE = /^https?:\/\/[^\s]+$/

export function useClipboardWatcher(
  notification: { info: (opts: Record<string, unknown>) => void },
  onUrl: (url: string) => void,
) {
  let lastText = ''
  let lastNotified = ''
  let timer: ReturnType<typeof setInterval> | null = null
  let unlistenFocus: (() => void) | null = null

  async function check() {
    try {
      const text = await readText()
      if (!text || text === lastText) return
      lastText = text
      const match = text.trim().match(URL_RE)
      if (match && match[0] !== lastNotified) {
        const url = match[0]
        lastNotified = url
        notification.info({
          title: '检测到下载链接',
          content: url,
          duration: 10000,
          onClick: () => onUrl(url),
        })
      }
    } catch { }
  }

  function start() {
    timer = setInterval(check, 2000)
    const win = getCurrentWindow()
    win.onFocusChanged(({ payload: focused }) => { if (focused) check() }).then(fn => { unlistenFocus = fn })
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null }
    if (unlistenFocus) { unlistenFocus(); unlistenFocus = null }
  }

  return { start, stop }
}
