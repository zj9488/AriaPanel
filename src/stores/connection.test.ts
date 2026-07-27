import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useConnectionStore } from './connection'

describe('useConnectionStore', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('transitions states and stores stat', () => {
    const s = useConnectionStore()
    expect(s.status).toBe('idle')
    s.setConnecting()
    expect(s.status).toBe('connecting')
    s.setConnected()
    expect(s.status).toBe('connected')
    s.setStat({ downloadSpeed: '1000', uploadSpeed: '0', active: '1', waiting: '0', stoppedTotal: '0' })
    expect(s.globalStat.active).toBe('1')
    s.setError('boom')
    expect(s.status).toBe('error')
  })
})
