import { computed } from 'vue'
import { usePrefStore, type ThemeMode } from '@/stores/preferences'

export type { ThemeMode }

export function useTheme() {
  const prefs = usePrefStore()
  const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const isDark = computed(() => prefs.themeMode === 'dark' || (prefs.themeMode === 'system' && prefersDark()))
  const mode = computed(() => isDark.value ? 'dark' : 'light')

  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  mq?.addEventListener?.('change', () => { if (prefs.themeMode === 'system') { prefs.setTheme('system') } })

  function setTheme(m: ThemeMode) { prefs.setTheme(m) }

  return { mode, themeMode: computed(() => prefs.themeMode), setTheme }
}
