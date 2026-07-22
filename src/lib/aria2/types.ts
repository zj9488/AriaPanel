export interface RpcError { code: number; message: string }
export interface RpcResponse<T> { jsonrpc: '2.0'; id: number; result?: T; error?: RpcError }

export interface Aria2Task {
  gid: string
  status: 'active' | 'waiting' | 'paused' | 'complete' | 'removed' | 'error'
  totalLength: string
  completedLength: string
  downloadSpeed: string
  uploadSpeed: string
  files: Array<{ path: string; length: string; completedLength: string; selected: string }>
  bittorrent?: { info: { name?: string } }
  errorCode?: string
  errorMessage?: string
}

export interface GlobalStat {
  downloadSpeed: string
  uploadSpeed: string
  active: string
  waiting: string
  stoppedTotal: string
}
