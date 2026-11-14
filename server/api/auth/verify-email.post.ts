import { createError, readBody } from 'h3'
import pool from '../../connection/dbconnect'
import { hashToken, normalizeEmail } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const { email, code } = await readBody<{ email?: string; code?: string }>(event)
  if (typeof email !== 'string' || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw createError({ statusCode: 400, statusMessage: 'Enter the 6-digit verification code.' })
  const [result] = await pool.execute<any>('UPDATE `user` SET EmailVerified = 1, VerificationToken = NULL, VerificationTokenExpiry = NULL WHERE Email = ? AND VerificationToken = ? AND VerificationTokenExpiry > UTC_TIMESTAMP()', [normalizeEmail(email), hashToken(code)])
  if (!result.affectedRows) throw createError({ statusCode: 400, statusMessage: 'This verification code is invalid or expired.' })
  return { message: 'Email verified. You can sign in once an administrator has activated your staff account.' }
})
