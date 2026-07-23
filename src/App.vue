<script setup lang="ts">
import { onMounted, provide, shallowRef, type Ref } from 'vue'
import { useAria2, type Aria2Api } from '@/composables/useAria2'
import AppShell from '@/components/AppShell.vue'

const aria = useAria2()
const apiRef = shallowRef<Aria2Api | null>(null)
provide<Ref<Aria2Api | null>>('aria2-api', apiRef)
onMounted(async () => {
  await aria.start()
  apiRef.value = aria.getApi()
})
</script>

<template>
  <AppShell>
    <router-view />
  </AppShell>
</template>
