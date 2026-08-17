import { describe, it, expect, vi } from 'vitest'
import { Aria2Client } from './rpc-client'

function fakeFetch(resp: unknown) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      ({
        ok: true,
        status: 200,
        json: async () => resp,
      }) as unknown as Response,
  )
}

describe('Aria2Client', () => {
  it('injects token as first param', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: { downloadSpeed: '0' } })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.getGlobalStat()
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.getGlobalStat')
    expect(body.params).toEqual(['token:S'])
  })

  it('throws on rpc error', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'bad' } })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await expect(c.getGlobalStat()).rejects.toThrow('bad')
  })

  it('tellActive returns result array', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: [{ gid: 'g1' }] })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    const r = await c.tellActive()
    expect(r).toEqual([{ gid: 'g1' }])
  })

  it('pause sends gid as second param', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: 'OK' })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.pause('g1')
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.pause')
    expect(body.params).toEqual(['token:S', 'g1'])
  })

  it('pauseAll sends no extra params', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: 'OK' })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.pauseAll()
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.pauseAll')
    expect(body.params).toEqual(['token:S'])
  })

  it('addUri passes options as third param', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: 'gid-new' })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.addUri(['http://x/f.bin'], { dir: '/dl', out: 'f.bin' })
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.addUri')
    expect(body.params).toEqual(['token:S', ['http://x/f.bin'], { dir: '/dl', out: 'f.bin' }])
  })

  it('addUri without options omits third param', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: 'gid-new' })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.addUri(['http://x/f.bin'])
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.params).toEqual(['token:S', ['http://x/f.bin']])
  })

  it('tellStatus sends gid', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: { gid: 'g1' } })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.tellStatus('g1')
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.tellStatus')
    expect(body.params).toEqual(['token:S', 'g1'])
  })

  it('changeOption sends gid and options', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: 'OK' })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.changeOption('g1', { 'select-file': '1,2' })
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.changeOption')
    expect(body.params).toEqual(['token:S', 'g1', { 'select-file': '1,2' }])
  })

  it('changeGlobalOption sends options', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: 'OK' })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.changeGlobalOption({ 'max-concurrent-downloads': '3' })
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.changeGlobalOption')
    expect(body.params).toEqual(['token:S', { 'max-concurrent-downloads': '3' }])
  })

  it('addTorrent sends base64 and options', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: 'gid-new' })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.addTorrent('dGVzdA==', [], { dir: '/dl' })
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.addTorrent')
    expect(body.params).toEqual(['token:S', 'dGVzdA==', [], { dir: '/dl' }])
  })
})
