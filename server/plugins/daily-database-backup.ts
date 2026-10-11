import { ensureDailyDatabaseBackup } from '../utils/databaseBackup.mjs'

export default defineNitroPlugin(() => {
  if (process.env.DB_AUTO_BACKUP === 'false') return
  const check = () => { ensureDailyDatabaseBackup().catch(error => console.error('[database-backup]', error)) }
  const day = 24 * 60 * 60 * 1000
  const singaporeOffset = 8 * 60 * 60 * 1000
  const scheduleMidnight = () => {
    const delay = day - ((Date.now() + singaporeOffset) % day) + 1000
    setTimeout(() => { check(); scheduleMidnight() }, delay).unref?.()
  }
  scheduleMidnight()
  const timer = setInterval(check, 60 * 60 * 1000)
  timer.unref?.()
  setTimeout(check, 30_000).unref?.()
})
