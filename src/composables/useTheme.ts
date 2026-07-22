import { ref } from 'vue'

export type ThemeMode = 'light' | 'dark'

export function useTheme() {
  const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const mode = ref<ThemeMode>(prefersDark() ? 'dark' : 'light')
  const apply = (m: ThemeMode) => { mode.value = m }
  // 监听系统变化
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', e => { mode.value = e.matches ? 'dark' : 'light' })
  return { mode, apply }
}
