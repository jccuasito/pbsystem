import { createError, getHeader, readMultipartFormData } from 'h3'
import { importDatabaseBackup } from '../../../utils/databaseBackup.mjs'
import { requireSession } from '../../../utils/auth'
import { requireAdmin } from '../../../utils/settingsAccess'

const MAX_SQL_SIZE = 100 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  void session.sub
  await requireAdmin(event)
  if (Number(getHeader(event, 'content-length') || 0) > MAX_SQL_SIZE + 1024 * 1024) {
    throw createError({ statusCode: 413, statusMessage: 'SQL backup exceeds the 100 MB import limit.' })
  }
  const parts = await readMultipartFormData(event)
  const sql = parts?.find(part => part.name === 'sql')
  if (!sql?.filename?.endsWith('.sql') || !sql.data || sql.data.length > MAX_SQL_SIZE) {
    throw createError({ statusCode: 400, statusMessage: 'Choose an SQL backup from this system, up to 100 MB.' })
  }
  try { return { backup: await importDatabaseBackup(sql.data) } }
  catch (error: any) { throw createError({ statusCode: 400, statusMessage: error.message || 'Backup import failed.' }) }
})
