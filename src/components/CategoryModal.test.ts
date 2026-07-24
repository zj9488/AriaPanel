import { describe, it, expect, beforeEach } from 'vitest'
import { mount, DOMWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import CategoryModal from './CategoryModal.vue'

describe('CategoryModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  function mountModal(props: { show: boolean; category: unknown }) {
    return mount(
      {
        components: { NConfigProvider, NMessageProvider, NDialogProvider, CategoryModal },
        props: ['show', 'category'],
        template: `
          <NConfigProvider>
            <NMessageProvider>
              <NDialogProvider>
                <CategoryModal :show="show" :category="category" />
              </NDialogProvider>
            </NMessageProvider>
          </NConfigProvider>
        `,
      },
      { props },
    )
  }

  function el(selector: string): HTMLElement {
    return document.body.querySelector(selector)!
  }

  it('renders empty form in add mode', () => {
    mountModal({ show: true, category: null })
    expect(document.body.textContent).toContain('添加分类')
    expect(el('input[placeholder="分类名称"]')).toBeTruthy()
  })

  it('renders title edit mode and prefills', () => {
    mountModal({ show: true, category: { id: 'music', name: '音乐', dir: 'D:/Music' } })
    expect(document.body.textContent).toContain('编辑分类')
    expect((el('input[placeholder="分类名称"]') as HTMLInputElement).value).toBe('音乐')
  })

  it('emits submit with name and dir', async () => {
    const w = mountModal({ show: true, category: null })
    await new DOMWrapper(el('input[placeholder="分类名称"]')).setValue('游戏')
    await new DOMWrapper(el('input[placeholder="保存目录（留空使用默认目录）"]')).setValue('D:/Games')
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    const modal = w.findComponent(CategoryModal)
    expect(modal.emitted('submit')).toBeTruthy()
    expect(modal.emitted('submit')![0]).toEqual(['游戏', 'D:/Games'])
  })
})
