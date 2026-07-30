import mysql from 'mysql2/promise'

const required = ['DB_HOST', 'DB_USER', 'DB_NAME'] as const
for (const key of required) {
  if (!process.env[key]) console.warn(`[database] Missing ${key}; database requests will fail until it is configured.`)
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z'
})

/** Shared parameterized MySQL pool. Import this from API routes; never concatenate user input into SQL. */
export default pool
