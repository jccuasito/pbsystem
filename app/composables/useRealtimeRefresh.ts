import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue'

type RefreshOptions = {
  intervalMs?: number
  immediate?: boolean
  shouldRefresh?: () => boolean
}

export function useRealtimeRefresh(refresh: () => Promise<void> | void, options: RefreshOptions = {}) {
  const intervalMs = options.intervalMs ?? 10000
  let timer: ReturnType<typeof window.setTimeout> | null = null
  let running = false
  let started = false
  let failures = 0

  function schedule() {
    if (timer) window.clearTimeout(timer)
    if (!started) return
    const delay = Math.min(intervalMs * 2 ** failures, 60000)
    timer = window.setTimeout(() => void run(), delay * (0.85 + Math.random() * 0.3))
  }

  async function run() {
    if (!started || running) return
    if (document.visibilityState === 'hidden' || !navigator.onLine || options.shouldRefresh?.() === false) { schedule(); return }
    running = true
    try {
      await refresh()
      failures = 0
    } catch {
      failures = Math.min(failures + 1, 4)
    } finally {
      running = false
      schedule()
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') void run()
  }

  function start() {
    if (started) return
    started = true
    if (options.immediate) void run()
    else schedule()
    window.addEventListener('focus', run)
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  function stop() {
    started = false
    if (timer) window.clearTimeout(timer)
    timer = null
    window.removeEventListener('focus', run)
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  onMounted(start)
  onActivated(start)
  onDeactivated(stop)
  onBeforeUnmount(stop)
}
