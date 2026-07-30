import { createError, readBody } from 'h3'
import pool from '../../connection/dbconnect'
import { hashToken, normalizeEmail, randomVerificationCode } from '../../utils/auth'
import { sendVerificationEmail } from '../../utils/mailer'

export default defineEventHandler(async (event) => {
  const { email } = await readBody<{ email?: string }>(event)
  if (!email) throw createError({ statusCode: 400, statusMessage: 'Email is required.' })
  const address = normalizeEmail(email); const [rows] = await pool.execute<any[]>('SELECT UserID, EmailVerified FROM `user` WHERE Email = ? LIMIT 1', [address]); const user = rows[0]
  if (user && !user.EmailVerified) { const code = randomVerificationCode(); await pool.execute('UPDATE `user` SET VerificationToken = ?, VerificationTokenExpiry = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE) WHERE UserID = ?', [hashToken(code), user.UserID]); await sendVerificationEmail(address, code) }
  return { message: 'If the account needs verification, a new code has been sent.' }
})
