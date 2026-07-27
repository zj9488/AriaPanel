import type { Aria2Client } from './rpc-client'
import type { Aria2Task } from './types'

export class Poller {
  private timer: ReturnType<typeof setTimeout> | null = null
  private active = false
  private inFlight = false
  private failCount = 0
  constructor(
    private client: Aria2Client,
    private onTick: (a: Aria2Task[], w: Aria2Task[], s: Aria2Task[]) => void,
    private onStatus?: (connected: boolean) => void,
  ) {}

  start() {
    this.schedule(0)
  }
  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  refreshNow() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.schedule(0)
  }

  private schedule(ms: number) {
    this.timer = setTimeout(() => {
      this.tick()
    }, ms)
  }

  private async tick() {
    if (this.inFlight) return
    this.inFlight = true
    let interval = this.active ? 1000 : 5000
    try {
      const [a, w, s] = await Promise.all([
        this.client.tellActive(),
        this.client.tellWaiting(0, 100),
        this.client.tellStopped(0, 100),
      ])
      this.active = a.length > 0
      this.onTick(a, w, s)
      if (this.failCount >= 3) this.onStatus?.(true)
      this.failCount = 0
      interval = this.active ? 1000 : 5000
    } catch {
      this.failCount++
      if (this.failCount === 3) this.onStatus?.(false)
      interval = 1001
    } finally {
      this.inFlight = false
      this.schedule(interval)
    }
  }
}
