import { computed, inject, onBeforeUnmount, onMounted, provide, ref, type InjectionKey, type Ref } from 'vue'

const themeKey: InjectionKey<Ref<boolean>> = Symbol('app-theme')

/** One theme for routes, embedded workspaces and dialogs teleported to body. */
export function provideAppTheme() {
  const current = ref(false)
  const isDark = computed({
    get: () => current.value,
    set: (value: boolean) => {
      current.value = value
      try { localStorage.setItem('dja-theme', value ? 'dark' : 'light') } catch { /* Storage may be disabled. */ }
    }
  })
  provide(themeKey, isDark)
  const readPreference = () => {
    try {
      const saved = localStorage.getItem('dja-theme')
      // New visitors start in light mode, independently of the OS/browser theme.
      current.value = saved === 'dark'
    } catch { current.value = false }
  }
  const followOtherTab = (event: StorageEvent) => { if (event.key === 'dja-theme' || event.key === null) readPreference() }
  onMounted(() => {
    readPreference()
    window.addEventListener('storage', followOtherTab)
  })
  function toggleTheme() {
    isDark.value = !isDark.value
  }
  onBeforeUnmount(() => {
    window.removeEventListener('storage', followOtherTab)
  })
  return { isDark, toggleTheme }
}

export function useAppTheme() {
  return inject(themeKey, () => ref(false), true)
}
