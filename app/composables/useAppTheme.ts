import { computed, inject, onBeforeUnmount, onMounted, provide, ref, type InjectionKey, type Ref } from 'vue'

const themeKey: InjectionKey<Ref<boolean>> = Symbol('app-theme')

/** One theme for routes, embedded workspaces and dialogs teleported to body. */
export function provideAppTheme() {
  const current = ref(false)
  let media: MediaQueryList | undefined
  let hasPreference = false
  const isDark = computed({
    get: () => current.value,
    set: (value: boolean) => {
      hasPreference = true
      current.value = value
      try { localStorage.setItem('dja-theme', value ? 'dark' : 'light') } catch { /* Storage may be disabled. */ }
    }
  })
  provide(themeKey, isDark)
  const readPreference = () => {
    try {
      const saved = localStorage.getItem('dja-theme')
      hasPreference = saved === 'dark' || saved === 'light'
      current.value = hasPreference ? saved === 'dark' : Boolean(media?.matches)
    } catch { current.value = Boolean(media?.matches) }
  }
  const followSystem = () => { if (!hasPreference) current.value = Boolean(media?.matches) }
  const followOtherTab = (event: StorageEvent) => { if (event.key === 'dja-theme' || event.key === null) readPreference() }
  onMounted(() => {
    media = window.matchMedia('(prefers-color-scheme: dark)')
    readPreference()
    media.addEventListener('change', followSystem)
    window.addEventListener('storage', followOtherTab)
  })
  function toggleTheme() {
    isDark.value = !isDark.value
  }
  onBeforeUnmount(() => {
    media?.removeEventListener('change', followSystem)
    window.removeEventListener('storage', followOtherTab)
  })
  return { isDark, toggleTheme }
}

export function useAppTheme() {
  return inject(themeKey, () => ref(false), true)
}
