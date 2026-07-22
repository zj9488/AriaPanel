<script setup lang="ts">
import { onMounted, provide, shallowRef, type Ref } from 'vue'
import { useAria2 } from '@/composables/useAria2'
import type { Aria2Client } from '@/lib/aria2/rpc-client'

const aria = useAria2()
const clientRef = shallowRef<Aria2Client | null>(null)
provide<Ref<Aria2Client | null>>('aria2-client', clientRef)
onMounted(async () => {
  await aria.start()
  clientRef.value = aria.getClient()
})
</script>

<template>
  <router-view />
</template>
