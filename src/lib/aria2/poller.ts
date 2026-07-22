import type { Aria2Client } from './rpc-client'
import type { Aria2Task } from './types'

export class Poller {
  private timer: ReturnType<typeof setTimeout> | null = null
  private active = false
  constructor(
    private client: Aria2Client,
    private onTick: (a: Aria2Task[], w: Aria2Task[], s: Aria2Task[]) => void,
  ) {}

  start() { this.schedule(0) }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null }

  private schedule(ms: number) {
    this.timer = setTimeout(() => { this.tick() }, ms)
  }

  private async tick() {
    try {
      const [a, w, s] = await Promise.all([
        this.client.tellActive(),
        this.client.tellWaiting(0, 100),
        this.client.tellStopped(0, 100),
      ])
      this.active = a.length > 0
      this.onTick(a, w, s)
    } catch {
      /* 网络瞬断忽略，下次重试 */
    }
    this.schedule(this.active ? 1000 : 5000)
  }
}
