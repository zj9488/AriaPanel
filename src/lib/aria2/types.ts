export interface RpcError {
  code: number
  message: string
}
export interface RpcResponse<T> {
  jsonrpc: '2.0'
  id: number
  result?: T
  error?: RpcError
}

export interface Aria2Task {
  gid: string
  status: 'active' | 'waiting' | 'paused' | 'complete' | 'removed' | 'error'
  totalLength: string
  completedLength: string
  downloadSpeed: string
  uploadSpeed: string
  dir: string
  files: Array<{
    path: string
    length: string
    completedLength: string
    selected: string
    uris: Array<{ uri: string; status: string }>
  }>
  bittorrent?: {
    info: { name?: string }
    mode?: 'single' | 'multi'
    announceList?: string[][]
    comment?: string
    creationDate?: number
  }
  infoHash?: string
  numSeeders?: string
  seeder?: string
  errorCode?: string
  errorMessage?: string
  followedBy?: string[]
  following?: string
}

export interface Peer {
  peerId: string
  ip: string
  port: string
  bitfield: string
  amChoking: string
  peerChoking: string
  downloadSpeed: string
  uploadSpeed: string
  seeder: string
}

export interface GlobalStat {
  downloadSpeed: string
  uploadSpeed: string
  active: string
  waiting: string
  stoppedTotal: string
}

export interface Aria2TaskDetail extends Aria2Task {
  pieceLength: string
  numPieces: string
  bitfield: string
  connections: string
  peers?: Peer[]
}
