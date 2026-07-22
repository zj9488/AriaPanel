import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Poller } from './poller'
import type { Aria2Client } from './rpc-client'

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
})
