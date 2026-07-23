import type { Aria2Task, GlobalStat, RpcResponse } from './types'

export class Aria2Client {
  private id = 0
  constructor(
    private url: string,
    private secret: string,
    private fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = ++this.id
    const body = { jsonrpc: '2.0', id, method, params: [`token:${this.secret}`, ...params] }
    const resp = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw new Error(`rpc http ${resp.status}`)
    const data = (await resp.json()) as RpcResponse<T>
    if (data.error) throw new Error(data.error.message)
    return data.result as T
  }

  getVersion() { return this.call<{ version: string }>('aria2.getVersion') }
  getGlobalStat() { return this.call<GlobalStat>('aria2.getGlobalStat') }
  tellActive() { return this.call<Aria2Task[]>('aria2.tellActive') }
  tellWaiting(offset: number, num: number) { return this.call<Aria2Task[]>('aria2.tellWaiting', [offset, num]) }
  tellStopped(offset: number, num: number) { return this.call<Aria2Task[]>('aria2.tellStopped', [offset, num]) }
  pause(gid: string) { return this.call('aria2.pause', [gid]) }
  unpause(gid: string) { return this.call('aria2.unpause', [gid]) }
  remove(gid: string) { return this.call('aria2.remove', [gid]) }
  removeDownloadResult(gid: string) { return this.call('aria2.removeDownloadResult', [gid]) }
  forcePause(gid: string) { return this.call('aria2.forcePause', [gid]) }
  forceRemove(gid: string) { return this.call('aria2.forceRemove', [gid]) }
  pauseAll() { return this.call('aria2.pauseAll') }
  unpauseAll() { return this.call('aria2.unpauseAll') }

  purge(gid: string, status: Aria2Task['status']) {
    const stopped = status === 'complete' || status === 'error' || status === 'removed'
    return stopped ? this.removeDownloadResult(gid) : this.remove(gid)
  }
  forcePurge(gid: string, status: Aria2Task['status']) {
    const stopped = status === 'complete' || status === 'error' || status === 'removed'
    return stopped ? this.removeDownloadResult(gid) : this.forceRemove(gid)
  }
  addUri(uris: string[], options?: Record<string, unknown>) {
    const params = options ? [uris, options] : [uris]
    return this.call<string>('aria2.addUri', params)
  }
}
