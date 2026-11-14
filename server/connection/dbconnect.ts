import mysql from 'mysql2/promise'
import { managePool } from './managedPool'
import { boundedSetting } from '../utils/requestCapacity'

const required = ['DB_HOST', 'DB_USER', 'DB_NAME'] as const
for (const key of required) {
  if (!process.env[key]) console.warn(`[database] Missing ${key}; database requests will fail until it is configured.`)
}

const connectionLimit = boundedSetting('DB_POOL_SIZE', 10, 2, 32)
const managed = managePool(mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
  waitForConnections: true,
  connectionLimit,
  maxIdle: connectionLimit,
  idleTimeout: 60000,
  queueLimit: boundedSetting('DB_POOL_QUEUE_LIMIT', 200, 10, 1000),
  connectTimeout: boundedSetting('DB_CONNECT_TIMEOUT_MS', 10000, 1000, 30000),
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  multipleStatements: false,
  namedPlaceholders: false,
  timezone: 'Z'
}), boundedSetting('DB_ACQUIRE_TIMEOUT_MS', 5000, 100, 30000))

const pool = managed.pool
export const databaseMetrics = managed.metrics

/** Shared parameterized MySQL pool. Import this from API routes; never concatenate user input into SQL. */
export default pool
