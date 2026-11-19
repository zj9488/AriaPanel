import { defineStore } from 'pinia'
import { ref } from 'vue'

const KEY = 'ap:size-meta'
const CAP = 500
const KEEP = 250

type Entry = { expected?: number; actual?: number }

function load(): Record<string, Entry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

// gid → { expected: HEAD 探测的预期大小, actual: 完成后磁盘实际大小 }
// expected/actual 不一致 = 服务器以 chunked 流式输出（无长度），断流被 aria2 误标为完成。
export const useDownloadMetaStore = defineStore('download-meta', () => {
  const meta = ref<Record<string, Entry>>(load())

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(meta.value))
  }

  function prune() {
    const keys = Object.keys(meta.value)
    if (keys.length <= CAP) return
    for (const k of keys.slice(0, keys.length - KEEP)) delete meta.value[k]
  }

  function setExpected(gid: string, size: number) {
    meta.value[gid] = { ...meta.value[gid], expected: size }
    prune()
    persist()
  }

  function verify(gid: string, actual: number) {
    const m = meta.value[gid]
    if (!m || m.actual !== undefined) return
    meta.value[gid] = { ...m, actual }
    persist()
  }

  function carry(fromGid: string, toGid: string) {
    const expected = meta.value[fromGid]?.expected
    if (expected !== undefined) setExpected(toGid, expected)
  }

  return { meta, setExpected, verify, carry }
})
