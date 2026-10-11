import { createDatabaseBackup } from '../../../utils/databaseBackup.mjs'
import { requireSession } from '../../../utils/auth'
import { requireAdmin } from '../../../utils/settingsAccess'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  void session.sub
  await requireAdmin(event)
  return { backup: await createDatabaseBackup('manual') }
})
