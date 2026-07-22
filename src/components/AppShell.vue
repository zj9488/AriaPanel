<script setup lang="ts">
import { NConfigProvider, darkTheme } from 'naive-ui'
import { useTheme } from '@/composables/useTheme'
const { mode } = useTheme()
</script>

<template>
  <NConfigProvider :theme="mode === 'dark' ? darkTheme : null">
    <slot />
  </NConfigProvider>
</template>
