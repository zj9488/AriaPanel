<script setup lang="ts">
import { onMounted } from 'vue'
import { useAria2 } from '@/composables/useAria2'

const aria = useAria2()
onMounted(() => { aria.start() })
</script>

<template>
  <router-view />
</template>
