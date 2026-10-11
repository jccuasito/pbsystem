import { createError, readBody } from 'h3'
import { restoreDatabaseBackup } from '../../../utils/databaseBackup.mjs'
import { requireSession } from '../../../utils/auth'
import { requireAdmin } from '../../../utils/settingsAccess'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  const actor = await requireAdmin(event)
  const body = await readBody<{ name?: string; confirmation?: string }>(event)
  if (body?.confirmation !== 'RESTORE') throw createError({ statusCode: 400, statusMessage: 'Type RESTORE to confirm.' })
  try { return await restoreDatabaseBackup(String(body?.name || ''), actor.UserID) }
  catch (error: any) { throw createError({ statusCode: 500, statusMessage: `Restore failed. Check the safety backup and server logs. ${error.message || ''}` }) }
})
