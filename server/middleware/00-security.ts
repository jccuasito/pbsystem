import { createError, getRequestURL, setHeader } from 'h3'
import { secureApiRequest } from '../utils/requestSecurity'
import { currentActor, requireAdmin } from '../utils/settingsAccess'
import { requireEmployeeSession } from '../utils/employeePortalAuth'

const publicPaths = new Set([
  '/api/auth/login', '/api/auth/register', '/api/auth/google', '/api/auth/google-code',
  '/api/auth/departments', '/api/auth/forgot-password', '/api/auth/reset-password',
  '/api/auth/verify-email', '/api/auth/verify-reset-token', '/api/auth/resend-verification', '/api/auth/logout',
  '/api/employee-portal/auth/signup', '/api/employee-portal/auth/login',
  '/api/employee-portal/auth/recovery', '/api/employee-portal/auth/logout'
])

export default defineEventHandler(async (event) => {
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'X-Frame-Options', 'SAMEORIGIN')
  setHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
  setHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  setHeader(event, 'Content-Security-Policy', "frame-ancestors 'self'; object-src 'none'; base-uri 'self'")
  const path = getRequestURL(event).pathname.replace(/\/+$/, '')
  if (path.includes('%')) {
    let decoded = ''
    try { decoded = decodeURIComponent(path) } catch { /* invalid encoding */ }
    if (path.toLowerCase().startsWith('/api/') || decoded.toLowerCase().startsWith('/api/')) throw createError({ statusCode: 400, statusMessage: 'Use an unencoded API path.' })
  }
  if (!path.toLowerCase().startsWith('/api/')) return
  if (path !== path.toLowerCase()) throw createError({ statusCode: 400, statusMessage: 'Use a lowercase API path.' })
  if (!publicPaths.has(path)) {
    if (path.startsWith('/api/employee-portal/')) await requireEmployeeSession(event)
    else await currentActor(event)
  }
  // Never buffer a large SQL import for an unauthenticated / non-admin request.
  if (path === '/api/settings/backups/import') await requireAdmin(event)
  await secureApiRequest(event, path)
})
