import { createError, readBody } from 'h3'
import pool from '../../connection/dbconnect'
import { hashToken, normalizeEmail, randomToken } from '../../utils/auth'
import { sendVerificationEmail } from '../../utils/mailer'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string }>(event)
  const address = normalizeEmail(body?.email)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute<any[]>('SELECT UserID, EmailVerified FROM `user` WHERE Email = ? LIMIT 1 FOR UPDATE', [address])
    const user = rows[0]
    if (user && !user.EmailVerified) {
      const token = randomToken()
      await connection.execute('UPDATE `user` SET VerificationToken = ?, VerificationTokenExpiry = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE) WHERE UserID = ?', [hashToken(token), user.UserID])
      // Keep the previous link valid if delivery fails. The row lock also serializes resends.
      try { await sendVerificationEmail(address, token) }
      catch {
        console.error('[auth] Verification email delivery failed; check the server mail configuration.')
        throw createError({ statusCode: 503, statusMessage: 'We could not send the verification link. Please try again later or contact your administrator.' })
      }
    }
    await connection.commit()
  } catch (error) { await connection.rollback(); throw error }
  finally { connection.release() }
  return { message: 'If this email belongs to an account that needs verification, we sent a new link. Check your inbox and spam folder.' }
})
