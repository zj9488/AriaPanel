type NotifyMethod =
  | 'aria2.onDownloadStart'
  | 'aria2.onDownloadPause'
  | 'aria2.onDownloadStop'
  | 'aria2.onDownloadComplete'
  | 'aria2.onDownloadError'
  | 'aria2.onBtDownloadComplete'

export class WsNotifier {
  private ws: WebSocket | null = null
  private stopped = false
  private retry = 0
  constructor(
    private wsUrl: string,
    private secret: string,
    private onEvent: (method: NotifyMethod) => void,
  ) {}

  start() {
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    this.ws?.close()
    this.ws = null
  }

  private connect() {
    if (this.stopped) return
    try {
      this.ws = new WebSocket(this.wsUrl)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws.onopen = () => {
      this.retry = 0
    }
    this.ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data)
        if (typeof m?.method === 'string') this.onEvent(m.method as NotifyMethod)
      } catch {
        /* ignore */
      }
    }
    this.ws.onclose = () => this.scheduleReconnect()
    this.ws.onerror = () => this.ws?.close()
  }

  private scheduleReconnect() {
    if (this.stopped) return
    const delay = Math.min(30000, 500 * 2 ** this.retry++)
    setTimeout(() => this.connect(), delay)
  }
}
