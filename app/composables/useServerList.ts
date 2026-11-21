import { computed, onBeforeUnmount, onDeactivated, onMounted, ref, watch, toValue, type MaybeRefOrGetter } from 'vue'
import { useInfiniteCollection } from './useInfiniteCollection'

/** Server-filtered directories: debounce typing, fetch metadata once per refresh,
 * and never carry an old query's rows into a new search. */
export function useServerList<T>(options: {
  query: () => Record<string, unknown>
  fetchPage: (page: number, query: Record<string, unknown>, signal: AbortSignal) => Promise<any>
  key: (item: T) => string | number
  onLoaded?: (response: any) => void
  paused?: MaybeRefOrGetter<boolean>
}) {
  const pending = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const collection = useInfiniteCollection<T, any>({ ...options, paused: () => pending.value || toValue(options.paused) })
  function cancelTimer() { if (timer) clearTimeout(timer); timer = undefined; pending.value = false }
  async function reset() { cancelTimer(); await collection.reset() }
  async function refresh() { if (!pending.value) await collection.refresh() }
  watch(() => JSON.stringify(options.query()), () => {
    cancelTimer(); collection.invalidate(); pending.value = true
    timer = setTimeout(() => { void reset() }, 300)
  })
  onMounted(reset)
  onDeactivated(() => { if (pending.value) { cancelTimer(); void collection.reset() } })
  onBeforeUnmount(cancelTimer)
  return { ...collection, reset, refresh,
    poll: async () => { await refresh(); if (collection.error.value) throw new Error(collection.error.value) },
    loadMore: () => collection.error.value ? reset() : collection.loadMore(),
    loading: computed(() => pending.value || collection.loading.value),
    progress: computed(() => ({ ...collection.progress.value,
      hasMore: !!collection.error.value || collection.hasMore.value,
      error: collection.error.value || collection.moreError.value,
      loading: pending.value || collection.progress.value.loading })) }
}
