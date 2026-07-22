import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskTable from './TaskTable.vue'
import type { Aria2Task } from '@/lib/aria2/types'

const tasks: Aria2Task[] = [{
  gid: 'g1', status: 'active', totalLength: '1000', completedLength: '500',
  downloadSpeed: '100', uploadSpeed: '0', dir: 'D:/dl',
  files: [{ path: 'D:/dl/file.bin', length: '1000', completedLength: '500', selected: 'true', uris: [] }],
}]

describe('TaskTable', () => {
  it('renders task name, progress and speed', () => {
    const w = mount(TaskTable, { props: { tasks } })
    expect(w.text()).toContain('file.bin')
    expect(w.text()).toContain('50%')
    expect(w.text()).toContain('100 B/s')
  })
})
