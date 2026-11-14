import { requireSession } from '../../utils/auth'
import { requireAdmin } from '../../utils/settingsAccess'
import { databaseMetrics } from '../../connection/dbconnect'
import { requestCapacity } from '../../utils/requestCapacity'
import { databaseReady } from '../../utils/serviceHealth'

export default defineEventHandler(async event => {
  const session = requireSession(event)
  void session.sub
  await requireAdmin(event)
  const ready = await databaseReady()
  return { database: ready ? 'ok' : 'unavailable', uptimeSeconds: Math.floor(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576), requests: requestCapacity(), pool: databaseMetrics() }
})
