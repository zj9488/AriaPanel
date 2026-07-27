import { open } from '@tauri-apps/plugin-dialog'
import type { Ref } from 'vue'

export function useDirBrowser(dir: Ref<string>) {
  async function browse() {
    const selected = await open({ directory: true, defaultPath: dir.value })
    if (selected) dir.value = selected
  }
  return { browse }
}
