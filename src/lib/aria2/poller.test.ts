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

  it('calls onStatus(false) after 3 consecutive failures', async () => {
    const failClient = {
      tellActive: vi.fn().mockRejectedValue(new Error('rpc')),
      tellWaiting: vi.fn().mockRejectedValue(new Error('rpc')),
      tellStopped: vi.fn().mockRejectedValue(new Error('rpc')),
    } as unknown as Aria2Client
    const onTick = vi.fn()
    const onStatus = vi.fn()
    const p = new Poller(failClient, onTick, onStatus)
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onStatus).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(onStatus).toHaveBeenCalledWith(false)
    p.stop()
  })

  it('calls onStatus(true) on recovery after failures', async () => {
    let failCount = 0
    const flakyClient = {
      tellActive: vi.fn(async () => {
        failCount++
        if (failCount <= 3) throw new Error('rpc')
        return []
      }),
      tellWaiting: vi.fn(async () => []),
      tellStopped: vi.fn(async () => []),
    } as unknown as Aria2Client
    const onTick = vi.fn()
    const onStatus = vi.fn()
    const p = new Poller(flakyClient, onTick, onStatus)
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(onStatus).toHaveBeenCalledWith(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onStatus).toHaveBeenCalledWith(true)
    p.stop()
  })

  it('does not call onStatus for 1-2 transient failures', async () => {
    let failCount = 0
    const blipClient = {
      tellActive: vi.fn(async () => {
        failCount++
        if (failCount === 1) throw new Error('blip')
        return []
      }),
      tellWaiting: vi.fn(async () => []),
      tellStopped: vi.fn(async () => []),
    } as unknown as Aria2Client
    const onTick = vi.fn()
    const onStatus = vi.fn()
    const p = new Poller(blipClient, onTick, onStatus)
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onStatus).not.toHaveBeenCalled()
    p.stop()
  })
})
