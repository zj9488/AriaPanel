<script setup lang="ts">
import { NButton, NCollapse, NCollapseItem, NTag } from 'naive-ui'
import { computed } from 'vue'
import type { Aria2TaskDetail } from '@/lib/aria2/types'
import { fmtSpeed } from '@/lib/format'

const props = defineProps<{ detail: Aria2TaskDetail }>()

const peers = computed(() =>
  [...(props.detail.peers ?? [])].sort((a, b) => Number(b.downloadSpeed) - Number(a.downloadSpeed)),
)
const seederCount = computed(() => peers.value.filter((p) => p.seeder === 'true').length)
const leecherCount = computed(() => peers.value.length - seederCount.value)
const infoHashShort = computed(() => (props.detail.infoHash ? props.detail.infoHash.slice(0, 8) + '...' : ''))

async function copyInfoHash() {
  if (props.detail.infoHash) await navigator.clipboard?.writeText(props.detail.infoHash)
}
</script>

<template>
  <section>
    <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7">BT 信息</h4>
    <div style="font-size: 13px; line-height: 1.8">
      infoHash：{{ infoHashShort }}
      <NButton size="tiny" quaternary data-test="copy-infohash" @click="copyInfoHash">复制</NButton>
      <br />
      做种 {{ seederCount }} · 下载 {{ leecherCount }} · 连接 {{ peers.length }}
    </div>
    <NCollapse :default-expanded-names="[]">
      <NCollapseItem title="Peer 列表" name="peers">
        <div v-if="peers.length === 0" style="font-size: 13px">暂无连接的节点</div>
        <div
          v-for="peer in peers"
          :key="peer.peerId"
          class="peer-row"
          style="display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 2px"
        >
          <span>{{ peer.ip }}:{{ peer.port }}</span>
          <NTag v-if="peer.seeder === 'true'" size="small" type="success" :bordered="false">做种</NTag>
          <span>↓{{ fmtSpeed(peer.downloadSpeed) }}</span>
          <span>↑{{ fmtSpeed(peer.uploadSpeed) }}</span>
        </div>
      </NCollapseItem>
    </NCollapse>
  </section>
</template>
