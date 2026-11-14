import pool from '../connection/dbconnect'

export default defineNitroPlugin(nitroApp => {
  nitroApp.hooks.hook('close', async () => { await pool.end() })
})
