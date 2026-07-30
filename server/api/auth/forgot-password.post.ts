import { readBody } from 'h3'
import pool from '../../connection/dbconnect'
import { hashToken, normalizeEmail, randomToken } from '../../utils/auth'
import { sendPasswordResetEmail } from '../../utils/mailer'

export default defineEventHandler(async (event) => {
  const { email } = await readBody<{ email?: string }>(event)
  if (email) { const address = normalizeEmail(email); const [rows] = await pool.execute<any[]>('SELECT UserID, AuthProvider FROM `user` WHERE Email = ? LIMIT 1', [address]); if (rows[0]?.AuthProvider !== 'google') { const token = randomToken(); await pool.execute('UPDATE `user` SET ResetPasswordToken = ?, ResetPasswordExpiry = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR) WHERE UserID = ?', [hashToken(token), rows[0]?.UserID]); await sendPasswordResetEmail(address, token).catch((error) => console.error('[auth] Password reset email failed', error)) } }
  return { message: 'If that email belongs to a local account, a reset link has been sent.' }
})
