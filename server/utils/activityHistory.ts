import { createError, getQuery, setHeader } from 'h3'
import pool from '../connection/dbconnect'
import type { Entry } from './activityHistoryPolicy'
import { requireSession } from './auth'
import { currentActor, accessForUser } from './settingsAccess'
import { coalesceRead } from './requestCapacity'
import { activityScopes, activityActions, type ActivityItem } from '../../shared/utils/activityHistory'

// One awaited insert per small batch, not one write per imported row. No
// unbounded in-memory job queue and no detached fire-and-forget logging.
const pending: { entry: Entry; resolve: (ok: boolean) => void }[] = []
let writing = false, readEpoch = 0, recorderRegistered = false
const metrics = { recorded: 0, failures: 0, lastFailureAt: null as string | null }
export function registerActivityRecorder() { recorderRegistered = true }
export function activityHistoryMetrics() { return { ...metrics, pending: pending.length, recorderRegistered } }
export async function insertActivityEvents(db: any, entries: Entry[]) {
  if (!entries.length) return
  await db.execute(`INSERT INTO user_activity_event(EventKey,Scope,ActorUserID,ActorName,ActorRole,Action,Operation,Outcome,DetailsJson,CreatedAt)
    VALUES ${entries.map(() => '(?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6))').join(',')}`,
    entries.flatMap(e => [e.key, e.scope, e.actorId, e.actorName, e.actorRole, e.action, e.operation, e.outcome, JSON.stringify(e.details)]))
}
export function appendActivity(entry: Entry): Promise<boolean> {
  if (pending.length >= 1000) { metrics.failures++; metrics.lastFailureAt = new Date().toISOString(); return Promise.resolve(false) }
  return new Promise(resolve => { pending.push({ entry, resolve }); void drain() })
}
async function drain() {
  if (writing) return
  writing = true
  try {
    while (pending.length) {
      const batch = pending.splice(0, 50)
      try { await insertActivityEvents(pool, batch.map(item => item.entry)); readEpoch++; metrics.recorded += batch.length; for (const item of batch) item.resolve(true) }
      catch { metrics.failures += batch.length; metrics.lastFailureAt = new Date().toISOString(); console.warn('[activity-history] History storage unavailable; operation was not replayed.'); for (const item of batch) item.resolve(false) }
    }
  } finally { writing = false }
}

// Completed queued financial work is recorded inside its existing transaction.
// The HTTP submission itself is only Accepted; it is not a finalized payroll.
export async function recordQueuedPayrollActivity(db: any, jobId: string) {
  const [[job]] = await db.execute(`SELECT j.RequestedBy,j.BatchID,u.FirstName,u.LastName,u.UserType,
    CONCAT_WS(' · ',a.AgencyName,s.SiteName,CONCAT(DATE_FORMAT(d.PeriodStart,'%Y-%m-%d'),' to ',DATE_FORMAT(d.PeriodEnd,'%Y-%m-%d'))) AS DtrLabel FROM payroll_job j
    LEFT JOIN \`user\` u ON u.UserID=j.RequestedBy LEFT JOIN attendance_dtr d ON d.BatchID=j.BatchID
    LEFT JOIN agency a ON a.AgencyID=d.AgencyID LEFT JOIN site s ON s.SiteID=d.SiteID WHERE j.JobID=?`, [jobId])
  if (!job) throw Error('Payroll job unavailable for activity history')
  await insertActivityEvents(db, [{ key: `payroll-job:${jobId}`, scope: 'payroll-processing', actorId: job.RequestedBy,
    actorName: [job.FirstName, job.LastName].filter(Boolean).join(' ').slice(0, 200) || `User #${job.RequestedBy}`,
    actorRole: job.UserType || 'Former user', action: 'Process', operation: 'finalize queued payroll', outcome: 'Completed',
    details: { references: [`BatchID #${job.BatchID}`, `Job ${jobId}`], fields: [], counts: {},
      subjects:job.DtrLabel?[{kind:'dtr',id:String(job.BatchID),label:String(job.DtrLabel).slice(0,220)}]:[] } }])
}

const cache = new Map<string, { expires: number; json: string; bytes: number }>()
let cacheBytes = 0
export async function listActivityHistory(event: any) {
  const session = requireSession(event)
  const actor = await currentActor(event)
  const query = getQuery(event)
  if (Object.keys(query).some(key => !['scope', 'before', 'action', 'period', 'asOf'].includes(key))) throw createError({ statusCode: 400, statusMessage: 'Unknown history filter.' })
  const scope = String(query.scope || 'all'), before = query.before === undefined ? null : String(query.before), action = query.action === undefined ? null : String(query.action)
  const period = String(query.period || 'recent')
  const asOf = query.asOf === undefined ? new Date(Math.floor(Date.now() / 60000) * 60000).toISOString() : String(query.asOf)
  const anchor = Date.parse(asOf)
  if (!['recent', 'archive'].includes(period) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(asOf) || !Number.isFinite(anchor) || new Date(anchor).toISOString() !== asOf || anchor < Date.UTC(2000, 0, 1) || anchor > Date.now() + 60000) throw createError({ statusCode: 400, statusMessage: 'Choose a valid history period.' })
  let cursor: { at: string; id: string } | null = null
  const validId = (value: string) => /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= BigInt('18446744073709551615')
  if (before && !validId(before)) {
    if (before.length <= 100 && /^[A-Za-z0-9_-]+$/.test(before)) {
      const decoded = Buffer.from(before, 'base64url').toString('utf8'), parts = decoded.split('|')
      const at = parts[0] || '', id = parts[1] || ''
      const parsed = Date.parse(at.slice(0, 23).replace(' ', 'T') + 'Z')
      if (parts.length === 2 && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(at) && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 23).replace('T', ' ') === at.slice(0, 23) && validId(id)) cursor = { at, id }
    }
    if (!cursor) throw createError({ statusCode: 400, statusMessage: 'Choose a valid history cursor.' })
  }
  if (scope !== 'all' && !Object.hasOwn(activityScopes, scope) || action !== null && !(activityActions as readonly string[]).includes(action)) throw createError({ statusCode: 400, statusMessage: 'Choose a valid history filter.' })
  const cutoff = new Date(anchor - 7 * 86400000).toISOString()
  const cutoffSql = cutoff.replace('T', ' ').replace('Z', '')
  const access = await accessForUser(session.sub, actor.UserType)
  const allowed = Object.keys(activityScopes).filter(key => activityScopes[key]!.module === 'settings' || access[activityScopes[key]!.module]?.canView)
  if (scope !== 'all' && !allowed.includes(scope)) throw createError({ statusCode: 403, statusMessage: 'You do not have access to this page history.' })
  if (!recorderRegistered) throw createError({ statusCode: 503, statusMessage: 'Activity recording is not active. Restart the application to enable history.' })
  // Supervisors can inspect team history only for modules they can currently
  // view. Settings team history is restricted to administrators.
  const team = actor.UserType === 'Admin' || actor.UserType === 'Supervisor' && scope !== 'settings' && scope !== 'all'
  const clauses = [scope === 'all' ? `Scope IN (${allowed.map(() => '?').join(',')})` : 'Scope=?']
  const params: any[] = scope === 'all' ? allowed : [scope]
  if (!team) { clauses.push('ActorUserID=?'); params.push(session.sub) }
  clauses.push(period === 'recent' ? 'CreatedAt>=?' : 'CreatedAt<?'); params.push(cutoffSql)
  if (cursor) { clauses.push('(CreatedAt<? OR (CreatedAt=? AND EventID<?))'); params.push(cursor.at, cursor.at, cursor.id) }
  else if (before) { clauses.push('EventID<?'); params.push(before) } // Earlier clients retain bounded ID paging.

  if (action) { clauses.push('Action=?'); params.push(action) }
  // Permissions are rechecked BEFORE looking in this server-only bounded
  // cache. Only older cursor pages are retained for 10s; first page is fresh.
  const key = JSON.stringify([session.sub, actor.UserType, scope, allowed, before, action, period, asOf, readEpoch])
  // Match the equality prefix to this authorized view. In particular, a rare
  // user's archive must not scan everybody else's old events to fill a page.
  // These are fixed schema indexes, never request-provided SQL identifiers.
  const index = scope === 'all'
    ? team ? action ? 'ix_activity_action_cursor' : 'ix_activity_time_cursor' : action ? 'ix_activity_actor_action_cursor' : 'ix_activity_actor_cursor'
    : team ? action ? 'ix_activity_scope_action_cursor' : 'ix_activity_scope_cursor' : action ? 'ix_activity_scope_actor_action_cursor' : 'ix_activity_scope_actor_cursor'
  const read = async () => {
    const [rows] = await pool.execute<any[]>(`SELECT CAST(EventID AS CHAR) AS id,Scope,ActorUserID,ActorName,ActorRole,Action,Operation,Outcome,DetailsJson,CreatedAt,DATE_FORMAT(CreatedAt,'%Y-%m-%d %H:%i:%s.%f') AS CursorAt
      FROM user_activity_event FORCE INDEX (${index}) WHERE ${clauses.join(' AND ')} ORDER BY CreatedAt DESC,EventID DESC LIMIT 26`, params)
    const items: ActivityItem[] = rows.slice(0, 25).map(row => {
      const details = typeof row.DetailsJson === 'string' ? JSON.parse(row.DetailsJson) : row.DetailsJson
      return { id: row.id, at: row.CreatedAt instanceof Date ? row.CreatedAt.toISOString() : row.CreatedAt, scope: row.Scope,
        actorId: row.ActorUserID, actorName: row.ActorName, actorRole: row.ActorRole, action: row.Action, operation: row.Operation, outcome: row.Outcome, ...details }
    })
    const last = rows[Math.min(25, rows.length) - 1]
    const nextCursor = rows.length > 25 ? Buffer.from(`${last.CursorAt}|${last.id}`).toString('base64url') : null
    return JSON.stringify({ items, nextCursor, period, asOf, cutoff, visibility: team ? 'Team' : 'Own', cachedSeconds: before ? 10 : 0 })
  }
  const now = Date.now()
  for (const [name, value] of cache) if (value.expires <= now) { cache.delete(name); cacheBytes -= value.bytes }
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (before && cache.has(key)) return JSON.parse(cache.get(key)!.json)
  let json: string
  try { json = await coalesceRead('activity:' + key, read) }
  catch { throw createError({ statusCode: 503, statusMessage: 'Activity history is unavailable. Please try again shortly.' }) }
  const size = Buffer.byteLength(json)
  if (before && size <= 128 * 1024) {
    while (cache.size >= 64 || cacheBytes + size > 2 * 1024 * 1024) { const name = cache.keys().next().value!; cacheBytes -= cache.get(name)!.bytes; cache.delete(name) }
    const old = cache.get(key); if (old) cacheBytes -= old.bytes
    cache.set(key, { json, expires: Date.now() + 10000, bytes: size }); cacheBytes += size
  }
  return JSON.parse(json)
}
