import { requireSession } from '../../utils/auth'
import { requireAdmin } from '../../utils/settingsAccess'
import { databaseMetrics } from '../../connection/dbconnect'
import { requestCapacity } from '../../utils/requestCapacity'
import { databaseReady } from '../../utils/serviceHealth'
import { performance } from 'node:perf_hooks'
import {lookupCacheMetrics} from '../../utils/lookupCache'
import {payrollQueueEnabled} from '../../utils/payrollJobStore'
import {activityHistoryMetrics} from '../../utils/activityHistory'

export default defineEventHandler(async event => {
  const session = requireSession(event)
  void session.sub
  await requireAdmin(event)
  const ready = await databaseReady()
  const memory = process.memoryUsage(), cpu = process.cpuUsage()
  return { database: ready ? 'ok' : 'unavailable', uptimeSeconds: Math.floor(process.uptime()), memoryMb: Math.round(memory.rss / 1048576),
    heapUsedMb: Math.round(memory.heapUsed / 1048576), cpuMs: { user: Math.round(cpu.user / 1000), system: Math.round(cpu.system / 1000) },
    eventLoop: performance.eventLoopUtilization(), requests: requestCapacity(), pool: databaseMetrics(),lookupCache:lookupCacheMetrics(),payrollQueueEnabled:payrollQueueEnabled(),activityHistory:activityHistoryMetrics() }
})
