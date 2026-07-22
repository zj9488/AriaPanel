import { createRouter, createWebHashHistory } from 'vue-router'
import TaskListView from '@/views/TaskListView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/', name: 'tasks', component: TaskListView }],
})
