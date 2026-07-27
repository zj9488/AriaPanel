import { ref, computed, watch, type Ref } from 'vue'
import { useCategoryStore } from '@/stores/category'

export function useCategoryDir(dir: Ref<string>) {
  const cats = useCategoryStore()
  const selectedCategory = ref<string | null>(null)

  const categoryOptions = computed(() => cats.categories.map((c) => ({ label: c.name, value: c.id })))

  watch(selectedCategory, (id) => {
    if (!id) return
    const cat = cats.getCategory(id)
    if (cat && cat.dir) dir.value = cat.dir
  })

  return { selectedCategory, categoryOptions }
}
