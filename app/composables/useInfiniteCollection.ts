import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, shallowRef, toValue, type MaybeRefOrGetter } from 'vue'
import { requestErrorMessage } from '~~/shared/utils/requestError'

type Page = { page: number; pages: number; total: number }
type Result<T> = { items: T[]; pagination: Page }

/** For APIs that already paginate. Queries are captured on reset so an unsent
 * search draft cannot change later batches. Refresh keeps all displayed pages. */
export function useInfiniteCollection<T, R extends Result<T>>(options: {
  query: () => Record<string, unknown>
  fetchPage: (page: number, query: Record<string, unknown>, signal: AbortSignal) => Promise<R>
  key: (item: T) => string | number
  onLoaded?: (response: R) => void
  paused?: MaybeRefOrGetter<boolean>
}) {
  const items = shallowRef<T[]>([])
  const loading = ref(false), loadingMore = ref(false), error = ref(''), moreError = ref('')
  const pagination = ref<Page>({ page: 0, pages: 1, total: 0 })
  const hasMore = computed(() => pagination.value.page < pagination.value.pages && items.value.length < pagination.value.total)
  const progress = computed(() => ({ shown: items.value.length, total: pagination.value.total, hasMore: hasMore.value, loading: loading.value || loadingMore.value, error: moreError.value }))
  let appliedQuery: Record<string, unknown> | undefined
  let owner = 0, active = true, controller: AbortController | undefined

  async function load(append = false, reset = false) {
    if (append && (!active || loading.value || loadingMore.value || !hasMore.value || toValue(options.paused))) return
    if (reset || !appliedQuery) appliedQuery = { ...options.query() }
    const current = ++owner
    controller?.abort()
    if (reset) { items.value = []; pagination.value = { page: 0, pages: 1, total: 0 } }
    if (!active) return
    const request = new AbortController()
    controller = request
    loading.value = !append; loadingMore.value = append; error.value = ''; moreError.value = ''
    const query = { ...appliedQuery }
    const first = append ? pagination.value.page + 1 : 1
    const last = append ? first : Math.max(1, pagination.value.page)
    const refreshed: T[] = []
    let result: R | undefined
    try {
      for (let page = first; page <= last; page++) {
        result = await options.fetchPage(page, query, request.signal)
        if (current !== owner) return
        if (append && result.pagination.page !== page) { void load(false, true); return }
        refreshed.push(...result.items)
        if (page >= result.pagination.pages) break
      }
      if (!result) return
      items.value = [...new Map((append ? [...items.value, ...refreshed] : refreshed).map(item => [options.key(item), item])).values()]
      pagination.value = result.pagination
      options.onLoaded?.(result)
    } catch (cause) {
      if (current !== owner || request.signal.aborted) return
      if (append) moreError.value = requestErrorMessage(cause, 'Unable to load more records. Please try again.')
      else error.value = requestErrorMessage(cause, 'Unable to load records. Please try again.')
    } finally {
      if (current === owner) { loading.value = false; loadingMore.value = false; controller = undefined }
    }
  }
  function stop() { active = false; ++owner; controller?.abort(); controller = undefined; loading.value = false; loadingMore.value = false }
  function invalidate() {
    ++owner; controller?.abort(); controller = undefined
    items.value = []; pagination.value = { page: 0, pages: 1, total: 0 }
    loading.value = false; loadingMore.value = false; error.value = ''; moreError.value = ''
  }
  onDeactivated(stop)
  onBeforeUnmount(stop)
  onActivated(() => {
    active = true
    if (appliedQuery && !items.value.length && !loading.value && !error.value) void load()
  })
  return { items, loading, loadingMore, error, moreError, pagination, progress, hasMore,
    refresh: () => load(), reset: () => load(false, true), loadMore: () => load(true), invalidate }
}
