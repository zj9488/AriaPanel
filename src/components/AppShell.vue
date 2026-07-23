<script setup lang="ts">
import { NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider, darkTheme } from 'naive-ui'
import { useTheme } from '@/composables/useTheme'
const { mode } = useTheme()
</script>

<template>
  <NConfigProvider :theme="mode === 'dark' ? darkTheme : null">
    <NMessageProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <slot />
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
