import { createError, getCookie, readBody, setCookie } from 'h3'
import pool from '../../connection/dbconnect'
import { assertPassword, hashPassword, hashToken, normalizeEmail, randomToken } from '../../utils/auth'
import { verifyToken } from '../../utils/jwt'
import { sendVerificationEmail } from '../../utils/mailer'
import { textInput } from '../../utils/inputValidation'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ firstName?: string; lastName?: string; gender?: string; email?: string; password?: string; departmentId?: number | string | null }>(event)
  const firstName = textInput(body?.firstName, 'first name', 100); const lastName = textInput(body?.lastName, 'last name', 100); const email = normalizeEmail(body?.email)
  if (!firstName || !lastName || !email || !body.password || !['Male', 'Female', 'Prefer not to say'].includes(body.gender || '')) throw createError({ statusCode: 400, statusMessage: 'Please complete all required fields.' })
  if (!/^\S+@\S+\.\S+$/.test(email)) throw createError({ statusCode: 400, statusMessage: 'Enter a valid email address.' })
  assertPassword(body.password)
  let google: any = null
  const pendingGoogle = getCookie(event, 'pbs_google_signup')
  if (pendingGoogle) { try { google = verifyToken(pendingGoogle) as any } catch { /* expired Google signup proof */ } }
  if (google?.signup !== true || google.email !== email) google = null
  const connection = await pool.getConnection()
  const token = randomToken()
  try {
    await connection.beginTransaction()
    let departmentId: number | null = null
    if (body.departmentId !== '' && body.departmentId !== null && body.departmentId !== undefined) {
      departmentId = Number(body.departmentId)
      if (!Number.isSafeInteger(departmentId) || departmentId < 1) throw createError({ statusCode: 400, statusMessage: 'Select an available department.' })
      const [departments] = await connection.execute<any[]>('SELECT DepartmentID FROM department WHERE DepartmentID = ? AND Status = \'Active\' LIMIT 1 FOR UPDATE', [departmentId])
      if (!departments.length) throw createError({ statusCode: 400, statusMessage: 'Select an available department.' })
    }
    const passwordHash = await hashPassword(body.password)
    if (google?.completeUserId) {
      const [result] = await connection.execute<any>('UPDATE `user` SET FirstName = ?, LastName = ?, Gender = ?, Password = ?, AuthProvider = \'google\', GoogleID = ?, EmailVerified = 0, VerificationToken = ?, VerificationTokenExpiry = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), DepartmentID = ? WHERE UserID = ? AND Email = ? AND Password IS NULL', [firstName, lastName, body.gender, passwordHash, google.googleId, hashToken(token), departmentId, google.completeUserId, email])
      if (!result.affectedRows) throw createError({ statusCode: 409, statusMessage: 'Your Google signup session expired. Please select Google again.' })
    } else {
      const [existing] = await connection.execute<any[]>('SELECT UserID FROM `user` WHERE Email = ? LIMIT 1 FOR UPDATE', [email])
      if (existing.length) throw createError({ statusCode: 409, statusMessage: 'An account already exists for this email. Log in or resend your verification link below.' })
      await connection.execute('INSERT INTO `user` (FirstName, LastName, Gender, Email, Password, AuthProvider, GoogleID, EmailVerified, VerificationToken, VerificationTokenExpiry, DepartmentID, UserType, Status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), ?, \'Viewer\', \'Active\')', [firstName, lastName, body.gender, email, passwordHash, google ? 'google' : 'local', google?.googleId || null, hashToken(token), departmentId])
    }
    await connection.commit()
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  if (google) setCookie(event, 'pbs_google_signup', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
  try { await sendVerificationEmail(email, token) }
  catch {
    console.error('[auth] Verification email delivery failed; check the server mail configuration.')
    return { message: 'Your account was created, but we could not send the verification link. Try Resend verification link. If it still fails, contact your administrator.', accountCreated: true, requiresVerification: true, emailSent: false, email }
  }
  return { message: 'Your account was created. Open the verification link in your email to sign in. The link expires in 15 minutes.', accountCreated: true, requiresVerification: true, emailSent: true, email }
})
