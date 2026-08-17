import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { shallowRef } from 'vue'
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
  const apiRef = shallowRef<Aria2Api | null>(null)
  let client: Aria2Client | null = null
  let poller: Poller | null = null
  let ws: WsNotifier | null = null
  let downloadDir = ''

  async function start() {
    conn.setConnecting()

    await listen('aria2://failed', () => {
      conn.setError('aria2 连接失败')
      conn.setShowDiagnostics(true)
    })
    await listen('aria2://crashed', () => {
      conn.setReconnecting()
    })
    await listen('aria2://restarted', async () => {
      const ep = await invoke<{ url: string; secret: string; dir: string } | null>('get_rpc_endpoint')
      if (ep) reconnect(ep)
    })

    const ep = await waitForEndpoint()
    if (!ep) return
    connectToEndpoint(ep)
  }

  async function waitForEndpoint(): Promise<{ url: string; secret: string; dir: string } | null> {
    for (let i = 0; i < 100; i++) {
      const ep = await invoke<{ url: string; secret: string; dir: string } | null>('get_rpc_endpoint')
      if (ep) return ep
      await new Promise((r) => setTimeout(r, 100))
    }
    conn.setError('获取 aria2 端点超时')
    conn.setShowDiagnostics(true)
    return null
  }

  function connectToEndpoint(ep: { url: string; secret: string; dir: string }) {
    const wsUrl = ep.url.replace(/^http/, 'ws')
    client = new Aria2Client(ep.url, ep.secret)
    downloadDir = ep.dir
    conn.setConnected()
    poller = new Poller(
      client,
      (a, w, s) => {
        tasks.apply(a, w, s)
        refreshStat()
      },
      (connected) => {
        if (connected) conn.setConnected()
        else conn.setReconnecting()
      },
    )
    poller.start()
    ws = new WsNotifier(wsUrl, ep.secret, () => {})
    ws.start()
    apiRef.value = getApi()
  }

  async function refreshStat() {
    if (!client) return
    try {
      conn.setStat(await client.getGlobalStat())
    } catch {}
  }

  function getApi(): Aria2Api | null {
    if (!client || !poller) return null
    return { client, refresh: () => poller!.refreshNow(), dir: downloadDir }
  }

  function reconnect(endpoint: { url: string; secret: string; dir: string }) {
    poller?.stop()
    ws?.stop()
    connectToEndpoint(endpoint)
  }

  return { start, getApi, apiRef }
}
