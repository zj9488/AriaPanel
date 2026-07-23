import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Aria2Client } from '@/lib/aria2/rpc-client'
import { Poller } from '@/lib/aria2/poller'
import { WsNotifier } from '@/lib/aria2/ws-notify'
import { useConnectionStore } from '@/stores/connection'
import { useTaskStore } from '@/stores/task'

export interface Aria2Api {
  client: Aria2Client
  refresh: () => void
  dir: string
}

export function useAria2() {
  const conn = useConnectionStore()
  const tasks = useTaskStore()
  let client: Aria2Client | null = null
  let poller: Poller | null = null
  let ws: WsNotifier | null = null
  let downloadDir = ''

  async function start() {
    conn.setConnecting()
    // 等待 Rust 侧 supervisor 就绪事件（或轮询命令）
    await listen('aria2://failed', () => conn.setError('aria2 启动失败'))
    const ep = await waitForEndpoint()
    if (!ep) return
    const wsUrl = ep.url.replace(/^http/, 'ws')
    client = new Aria2Client(ep.url, ep.secret)
    downloadDir = ep.dir
    conn.setConnected()
    poller = new Poller(client, (a, w, s) => { tasks.apply(a, w, s); refreshStat() })
    poller.start()
    ws = new WsNotifier(wsUrl, ep.secret, () => {/* M1：仅作触发；Poller 会刷新 */})
    ws.start()
  }

  async function waitForEndpoint(): Promise<{ url: string; secret: string; dir: string } | null> {
    for (let i = 0; i < 100; i++) {
      const ep = await invoke<{ url: string; secret: string; dir: string } | null>('get_rpc_endpoint')
      if (ep) return ep
      await new Promise(r => setTimeout(r, 100))
    }
    conn.setError('获取 aria2 端点超时')
    return null
  }

  async function refreshStat() {
    if (!client) return
    try { conn.setStat(await client.getGlobalStat()) } catch { /* ignore */ }
  }

  function getApi(): Aria2Api | null {
    if (!client || !poller) return null
    return { client, refresh: () => poller!.refreshNow(), dir: downloadDir }
  }

  function reconnect(endpoint: { url: string; secret: string; dir: string }) {
    poller?.stop()
    ws?.stop()
    client = new Aria2Client(endpoint.url, endpoint.secret)
    downloadDir = endpoint.dir
    const wsUrl = endpoint.url.replace(/^http/, 'ws')
    poller = new Poller(client, (a, w, s) => { tasks.apply(a, w, s); refreshStat() })
    poller.start()
    ws = new WsNotifier(wsUrl, endpoint.secret, () => {})
    ws.start()
  }

  return { start, getApi, reconnect }
}
