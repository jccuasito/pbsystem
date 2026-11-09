import pool from '../connection/dbconnect'
import { seedLegalHolidayDefaults } from '../utils/legalHolidayDefaults'
import { legalHolidayYears } from '../../shared/utils/philippineLegalHolidays'

export default defineNitroPlugin(async (nitroApp) => {
  let checkedYear: number | null = null
  let running = false
  const check = async () => {
    const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric' }).format(new Date()))
    if (running || checkedYear === year) return
    running = true
    let connection
    try {
      connection = await pool.getConnection()
      await seedLegalHolidayDefaults(connection, [...legalHolidayYears, year, year + 1])
      checkedYear = year
    } catch (error) { console.error('[legal-holiday-defaults] Unable to prepare Legal holidays:', error) }
    finally { connection?.release(); running = false }
  }
  await check()
  const timer = setInterval(() => void check(), 60 * 60 * 1000)
  timer.unref?.()
  nitroApp.hooks.hook('close', () => { clearInterval(timer) })
})
