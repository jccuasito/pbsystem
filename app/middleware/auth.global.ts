export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith('/dashboard')) return
  // During a full page refresh this middleware runs on the server. `useRequestFetch`
  // forwards the incoming cookie, so a valid pbs_session remains authenticated.
  const apiFetch = import.meta.server ? useRequestFetch() : $fetch
  try { await apiFetch('/api/auth/me') } catch { return navigateTo('/loginscreen') }
})
