import { createError } from 'h3'
import type { Pool, PoolConnection } from 'mysql2/promise'

function databaseFailure(error: any) {
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR', 'ER_CON_COUNT_ERROR', 'ER_USER_LIMIT_REACHED', 'ER_TOO_MANY_USER_CONNECTIONS'].includes(error?.code)
    || ['Queue limit reached.', 'Pool is closed.', 'No connections available.'].includes(error?.message)) {
    return createError({ statusCode: 503, statusMessage: 'The database is temporarily busy or unavailable. Please try again shortly.', cause: error })
  }
  // Preserve domain/duplicate/transaction errors for the existing handlers.
  return error
}

export function managePool(driver: Pool, acquireTimeoutMs: number) {
  const acquire = driver.getConnection.bind(driver)
  const counts = { active: 0, acquiring: 0, timeouts: 0, failures: 0 }
  driver.getConnection = () => new Promise<PoolConnection>((resolve, reject) => {
    let expired = false
    counts.acquiring++
    const timer = setTimeout(() => {
      expired = true; counts.timeouts++
      reject(createError({ statusCode: 503, statusMessage: 'The database is busy. Please try again shortly.' }))
    }, acquireTimeoutMs)
    acquire().then(connection => {
      clearTimeout(timer); counts.acquiring--
      if (expired) { connection.release(); return }
      counts.active++
      let released = false
      const release = connection.release.bind(connection), destroy = connection.destroy.bind(connection)
      const finish = () => { if (released) return false; released = true; counts.active--; return true }
      connection.release = () => { if (finish()) release() }
      connection.destroy = () => { if (finish()) destroy() }
      const execute = connection.execute.bind(connection)
      connection.execute = (async (sql: any, values?: any) => {
        try { return await execute(sql, values) }
        catch (error) { counts.failures++; throw databaseFailure(error) }
      }) as typeof connection.execute
      for (const operation of ['beginTransaction', 'commit', 'rollback'] as const) {
        const call = connection[operation].bind(connection)
        connection[operation] = async () => { try { return await call() } catch (error) { throw databaseFailure(error) } }
      }
      resolve(connection)
    }, error => {
      clearTimeout(timer); counts.acquiring--; counts.failures++
      if (!expired) reject(databaseFailure(error))
    })
  })
  driver.execute = (async (sql: any, values?: any) => {
    const connection = await driver.getConnection()
    try { return await connection.execute(sql, values) }
    finally { connection.release() }
  }) as typeof driver.execute
  return { pool: driver, metrics: () => ({ ...counts }) }
}
