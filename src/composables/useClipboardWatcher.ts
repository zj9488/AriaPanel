import { h } from 'vue'
import { NButton } from 'naive-ui'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { getCurrentWindow } from '@tauri-apps/api/window'

const URL_RE = /^https?:\/\/[^\s]+$/

export function useClipboardWatcher(
  notification: { info: (opts: Record<string, unknown>) => { destroy: () => void } },
  onUrl: (url: string) => void,
) {
  let lastText = ''
  let lastNotified = ''
  let timer: ReturnType<typeof setInterval> | null = null
  let unlistenFocus: (() => void) | null = null
  let inFlight = false

  async function check() {
    if (inFlight) return
    inFlight = true
    try {
      const text = await readText()
      if (!text || text === lastText) return
      lastText = text
      const match = text.trim().match(URL_RE)
      if (match && match[0] !== lastNotified) {
        const url = match[0]
        lastNotified = url
        const n = notification.info({
          title: '检测到下载链接',
          content: () =>
            h('div', [
              h('div', { style: 'margin-bottom:8px;word-break:break-all' }, url),
              h(
                NButton,
                {
                  size: 'small',
                  type: 'primary',
                  onClick: () => {
                    onUrl(url)
                    n.destroy()
                  },
                },
                () => '填入链接',
              ),
            ]),
          duration: 10000,
        })
      }
    } catch {
      /* ignore */
    } finally {
      inFlight = false
    }
  }

  function start() {
    if (timer) clearInterval(timer)
    if (unlistenFocus) {
      unlistenFocus()
      unlistenFocus = null
    }
    timer = setInterval(check, 2000)
    const win = getCurrentWindow()
    win
      .onFocusChanged(({ payload: focused }) => {
        if (focused) check()
      })
      .then((fn) => {
        unlistenFocus = fn
      })
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (unlistenFocus) {
      unlistenFocus()
      unlistenFocus = null
    }
  }

  return { start, stop }
}
