<script setup lang="ts">
import { NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider, NGlobalStyle, darkTheme } from 'naive-ui'
import { useTheme } from '@/composables/useTheme'
const { mode } = useTheme()
</script>

<template>
  <NConfigProvider :theme="mode === 'dark' ? darkTheme : null">
    <NGlobalStyle />
    <NMessageProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <slot />
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
