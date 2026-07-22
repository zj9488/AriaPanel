import { describe, it, expect, vi } from 'vitest'
import { Aria2Client } from './rpc-client'

function fakeFetch(resp: unknown) {
  return vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => resp,
  } as unknown as Response))
}

describe('Aria2Client', () => {
  it('injects token as first param', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: { version: '1.37.0' } })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.getVersion()
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.getVersion')
    expect(body.params).toEqual(['token:S'])
  })

  it('throws on rpc error', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'bad' } })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await expect(c.getVersion()).rejects.toThrow('bad')
  })

  it('tellActive returns result array', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: [{ gid: 'g1' }] })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    const r = await c.tellActive()
    expect(r).toEqual([{ gid: 'g1' }])
  })
})
