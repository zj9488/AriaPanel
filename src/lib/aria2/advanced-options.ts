interface AdvancedOptionDef {
  key: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  label: string
  values?: string[]
}

export const advancedOptions: AdvancedOptionDef[] = [
  { key: 'max-tries', type: 'number', label: '最大重试次数' },
  { key: 'retry-wait', type: 'number', label: '重试等待秒数' },
  { key: 'timeout', type: 'number', label: '超时秒数' },
  { key: 'connect-timeout', type: 'number', label: '连接超时秒数' },
  { key: 'http-accept-gzip', type: 'boolean', label: '接受 Gzip 压缩' },
  { key: 'check-integrity', type: 'boolean', label: '下载后校验完整性' },
  { key: 'check-certificate', type: 'boolean', label: '校验 SSL 证书' },
  { key: 'max-file-not-found', type: 'number', label: '最大 404 重试次数' },
  { key: 'remote-time', type: 'boolean', label: '从服务器获取文件时间' },
  { key: 'realtime-chunk-checksum', type: 'boolean', label: '实时分块校验' },
  {
    key: 'console-log-level',
    type: 'enum',
    label: '控制台日志级别',
    values: ['debug', 'info', 'notice', 'warn', 'error'],
  },
  {
    key: 'log-level',
    type: 'enum',
    label: '日志级别',
    values: ['debug', 'info', 'notice', 'warn', 'error'],
  },
  { key: 'bt-enable-lpd', type: 'boolean', label: '启用本地节点发现' },
  { key: 'bt-require-crypto', type: 'boolean', label: '要求加密连接' },
  { key: 'bt-force-encryption', type: 'boolean', label: '强制加密' },
  { key: 'bt-hash-check-seed', type: 'boolean', label: '做种时校验 hash' },
  { key: 'bt-prioritize-piece', type: 'boolean', label: '优先下载首尾块' },
  { key: 'bt-max-open-files', type: 'number', label: '最大打开文件数' },
  { key: 'bt-tracker-connect-timeout', type: 'number', label: 'Tracker 连接超时' },
  { key: 'bt-tracker-interval', type: 'number', label: 'Tracker 请求间隔' },
  { key: 'bt-remove-unselected-file', type: 'boolean', label: '下载后删除未选文件' },
  { key: 'rpc-save-upload-metadata', type: 'boolean', label: '保存 torrent 元数据' },
  { key: 'ftp-pasv', type: 'boolean', label: 'FTP 被动模式' },
  {
    key: 'ftp-type',
    type: 'enum',
    label: 'FTP 传输类型',
    values: ['binary', 'ascii'],
  },
]
