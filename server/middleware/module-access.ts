import { createError, getMethod, getRequestURL } from 'h3'
import { accessForUser, currentActor, moduleForPath } from '../utils/settingsAccess'
import { isDatabaseRestoring } from '../utils/databaseBackup.mjs'

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return
  if (isDatabaseRestoring() && !['GET', 'HEAD'].includes(getMethod(event).toUpperCase()) && path !== '/api/settings/backups/restore') {
    throw createError({ statusCode: 503, statusMessage: 'Database restore is in progress. Try again shortly.' })
  }
  const module = moduleForPath(path)
  if (!module) return
  const actor = await currentActor(event)
  event.context.activeUserType = actor.UserType
  if (actor.UserType === 'Admin') { event.context.moduleCanEdit = true; return }
  const access = await accessForUser(actor.UserID, actor.UserType)
  const permission = access[module]
  event.context.moduleCanEdit = permission?.canEdit === true
  const method = getMethod(event).toUpperCase()
  if (!permission?.canView || (method !== 'GET' && method !== 'HEAD' && !permission.canEdit)) {
    throw createError({ statusCode: 403, statusMessage: `You do not have ${method === 'GET' ? 'view' : 'edit'} access to ${module}.` })
  }
})
