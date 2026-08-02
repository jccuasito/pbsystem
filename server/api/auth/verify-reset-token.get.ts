import { getQuery } from 'h3'
import pool from '../../connection/dbconnect'
import { hashToken } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const { token } = getQuery(event) as { token?: string }
  if (!token || token.length !== 64) return { valid: false }
  const [rows] = await pool.execute<any[]>('SELECT UserID FROM `user` WHERE ResetPasswordToken = ? AND ResetPasswordExpiry > UTC_TIMESTAMP() LIMIT 1', [hashToken(token)])
  return { valid: Boolean(rows[0]) }
})