import { ref } from 'vue'
import { check as checkUpdate, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export function useUpdater() {
  const updateAvailable = ref(false)
  const updateInfo = ref<{ version: string; date: string; body: string } | null>(null)
  const downloading = ref(false)
  const progress = ref(0)
  const error = ref<string | null>(null)
  let pendingUpdate: Update | null = null

  async function check() {
    error.value = null
    try {
      const update = await checkUpdate()
      if (update) {
        pendingUpdate = update
        updateAvailable.value = true
        updateInfo.value = {
          version: update.version,
          date: update.date ?? '',
          body: update.body ?? '',
        }
      } else {
        updateAvailable.value = false
        updateInfo.value = null
      }
    } catch (e) {
      error.value = String(e).replace(/^Error:\s*/, '')
    }
  }

  async function downloadAndInstall() {
    if (!pendingUpdate) return
    downloading.value = true
    error.value = null
    progress.value = 0
    try {
      let total = 0
      let downloaded = 0
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started' && event.data.contentLength) {
          total = event.data.contentLength
        } else if (event.event === 'Progress' && event.data.chunkLength) {
          downloaded += event.data.chunkLength
          if (total > 0) {
            progress.value = Math.round((downloaded / total) * 100)
          }
        }
      })
      await relaunch()
    } catch (e) {
      error.value = String(e).replace(/^Error:\s*/, '')
    } finally {
      downloading.value = false
    }
  }

  return { updateAvailable, updateInfo, downloading, progress, error, check, downloadAndInstall }
}
