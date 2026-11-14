import { ensureDailyDatabaseBackup } from '../utils/databaseBackup.mjs'

export default defineNitroPlugin(nitroApp => {
  if (process.env.DB_AUTO_BACKUP === 'false') return
  const check = () => { ensureDailyDatabaseBackup().catch(error => console.error('[database-backup]', error)) }
  const day = 24 * 60 * 60 * 1000
  const singaporeOffset = 8 * 60 * 60 * 1000
  let stopped = false
  let midnightTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleMidnight = () => {
    if (stopped) return
    const delay = day - ((Date.now() + singaporeOffset) % day) + 1000
    midnightTimer = setTimeout(() => { check(); scheduleMidnight() }, delay)
    midnightTimer.unref?.()
  }
  scheduleMidnight()
  const timer = setInterval(check, 60 * 60 * 1000)
  timer.unref?.()
  const startupTimer = setTimeout(check, 30_000)
  startupTimer.unref?.()
  nitroApp.hooks.hook('close', () => { stopped = true; clearInterval(timer); clearTimeout(startupTimer); clearTimeout(midnightTimer) })
})
