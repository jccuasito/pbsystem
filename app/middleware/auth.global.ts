export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith('/dashboard')) return
  try { await $fetch('/api/auth/me') } catch { return navigateTo('/loginscreen') }
})
