import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Poller } from './poller'
import type { Aria2Client } from './rpc-client'
import type { Aria2Task } from './types'

function makeClient(active = 0) {
  return {
    tellActive: vi.fn(async () => Array.from({ length: active }, (_, i) => ({ gid: String(i) }))),
    tellWaiting: vi.fn(async () => []),
    tellStopped: vi.fn(async () => []),
  } as unknown as Aria2Client
}

describe('Poller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('probes immediately then polls every 1s when there are active tasks', async () => {
    const onTick = vi.fn()
    const p = new Poller(makeClient(2), onTick)
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(onTick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onTick).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onTick).toHaveBeenCalledTimes(3)
    p.stop()
  })

  it('slows to 5s cadence when idle after the bootstrap probe', async () => {
    const onTick = vi.fn()
    const p = new Poller(makeClient(0), onTick)
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(onTick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4000)
    expect(onTick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onTick).toHaveBeenCalledTimes(2)
    p.stop()
  })

  it('refreshNow triggers an immediate tick', async () => {
    const onTick = vi.fn()
    const p = new Poller(makeClient(0), onTick)
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(onTick).toHaveBeenCalledTimes(1)
    onTick.mockClear()
    p.refreshNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(onTick).toHaveBeenCalledTimes(1)
    p.stop()
  })

  it('does not re-enter tick while one is in flight', async () => {
    let resolveTell!: () => void
    const slowClient = {
      tellActive: vi.fn(
        () =>
          new Promise<Aria2Task[]>((r) => {
            resolveTell = () => r([])
          }),
      ),
      tellWaiting: vi.fn(async () => []),
      tellStopped: vi.fn(async () => []),
    } as unknown as Aria2Client
    const onTick = vi.fn()
    const p = new Poller(slowClient, onTick)
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    p.refreshNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(slowClient.tellActive).toHaveBeenCalledTimes(1)
    resolveTell()
    await vi.advanceTimersByTimeAsync(0)
    p.stop()
  })
})
