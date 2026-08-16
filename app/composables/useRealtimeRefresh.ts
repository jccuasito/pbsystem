import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue'

type RefreshOptions = {
  intervalMs?: number
  immediate?: boolean
  shouldRefresh?: () => boolean
}

export function useRealtimeRefresh(refresh: () => Promise<void> | void, options: RefreshOptions = {}) {
  const intervalMs = options.intervalMs ?? 5000
  let timer: ReturnType<typeof window.setInterval> | null = null
  let running = false
  let started = false

  async function run() {
    if (running || options.shouldRefresh?.() === false) return
    running = true
    try {
      await refresh()
    } finally {
      running = false
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') void run()
  }

  function start() {
    if (started) return
    started = true
    if (options.immediate) void run()
    timer = window.setInterval(() => void run(), intervalMs)
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  function stop() {
    started = false
    if (timer) window.clearInterval(timer)
    timer = null
    window.removeEventListener('focus', run)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  onMounted(start)
  onActivated(start)
  onDeactivated(stop)
  onBeforeUnmount(stop)
}
