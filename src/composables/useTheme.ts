import { computed, ref } from 'vue'
import { usePrefStore, type ThemeMode } from '@/stores/preferences'

export type { ThemeMode }

export function useTheme() {
  const prefs = usePrefStore()
  const systemDark = ref(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  mq?.addEventListener?.('change', (e) => {
    systemDark.value = e.matches
  })

  const isDark = computed(() => prefs.themeMode === 'dark' || (prefs.themeMode === 'system' && systemDark.value))
  const mode = computed(() => (isDark.value ? 'dark' : 'light'))

  function setTheme(m: ThemeMode) {
    prefs.setTheme(m)
  }

  return { mode, themeMode: computed(() => prefs.themeMode), setTheme }
}
