import pool from '../connection/dbconnect'
import {stopPayrollQueue} from '../utils/payrollQueue'

export default defineNitroPlugin(nitroApp => {
  nitroApp.hooks.hook('close', async () => { await stopPayrollQueue();await pool.end() })
})
