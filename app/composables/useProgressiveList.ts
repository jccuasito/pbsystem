import { computed, onBeforeUnmount, onMounted, ref, toValue, watch, type MaybeRefOrGetter, type WatchSource } from 'vue'

/** Display batches without changing the complete collection used by filters,
 * totals, selections or exports. Pass filter/context values as resetKey; routine
 * data refreshes then retain the number of rows already revealed. */
export function useProgressiveList<T>(source: MaybeRefOrGetter<readonly T[]>, options: { batchSize?: number; resetKey?: WatchSource<unknown> } = {}) {
  const batchSize = Math.max(1, options.batchSize || 25)
  const limit = ref(batchSize)
  const printing = useListPrintMode()
  const all = computed(() => toValue(source))
  const visibleItems = computed(() => printing.value ? all.value : all.value.slice(0, limit.value))
  const progress = computed(() => ({ shown: visibleItems.value.length, total: all.value.length, hasMore: visibleItems.value.length < all.value.length }))
  const reset = () => { limit.value = batchSize }
  const loadMore = () => { limit.value = Math.min(limit.value + batchSize, all.value.length) }
  if (options.resetKey) watch(options.resetKey, reset, { deep: true, flush: 'sync' })

  return { visibleItems, progress, loadMore, reset }
}

/** Independent batches for expandable groups; expanding one group does not
 * expose every other group's children or change their full counts. */
export function useProgressiveGroups(options: { batchSize?: number; resetKey?: WatchSource<unknown> } = {}) {
  const batchSize = Math.max(1, options.batchSize || 25)
  const limits = ref<Record<string, number>>({})
  const printing = useListPrintMode()
  if (options.resetKey) watch(options.resetKey, () => { limits.value = {} }, { deep: true, flush: 'sync' })
  function rowsFor<T>(key: string | number, rows: readonly T[]) { return printing.value ? rows : rows.slice(0, limits.value[String(key)] || batchSize) }
  function progressFor(key: string | number, rows: readonly unknown[]) {
    const shown = rowsFor(key, rows).length
    return { shown, total: rows.length, hasMore: shown < rows.length }
  }
  function loadMoreGroup(key: string | number, rows: readonly unknown[]) { limits.value[String(key)] = Math.min((limits.value[String(key)] || batchSize) + batchSize, rows.length) }
  return { rowsFor, progressFor, loadMoreGroup }
}

function useListPrintMode() {
  const printing = ref(false)
  // Printing a directory must include all matching records, even before scrolling.
  let printQuery: MediaQueryList | undefined
  const beforePrint = () => { printing.value = true }
  const afterPrint = () => { printing.value = false }
  const printChanged = () => { printing.value = Boolean(printQuery?.matches) }
  onMounted(() => {
    printQuery = window.matchMedia('print')
    printChanged()
    printQuery.addEventListener('change', printChanged)
    window.addEventListener('beforeprint', beforePrint)
    window.addEventListener('afterprint', afterPrint)
  })
  onBeforeUnmount(() => {
    printQuery?.removeEventListener('change', printChanged)
    window.removeEventListener('beforeprint', beforePrint)
    window.removeEventListener('afterprint', afterPrint)
  })
  return printing
}
