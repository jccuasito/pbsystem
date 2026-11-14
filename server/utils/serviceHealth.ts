import pool from '../connection/dbconnect'

let checkedAt = 0, healthy = false
let checking: Promise<boolean> | null = null
export function databaseReady(): Promise<boolean> {
  if (checking) return checking
  if (Date.now() - checkedAt < 2000) return Promise.resolve(healthy)
  checking = pool.execute('SELECT 1').then(() => { healthy = true; return true }, () => { healthy = false; return false })
    .finally(() => { checkedAt = Date.now(); checking = null })
  return checking
}
