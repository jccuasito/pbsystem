import { createError, readBody } from 'h3'
import pool from '../../connection/dbconnect'
import { assertPassword, hashPassword, hashToken } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const { token, password } = await readBody<{ token?: string; password?: string }>(event)
  if (!token || token.length !== 64 || !password) throw createError({ statusCode: 400, statusMessage: 'Invalid reset request.' })
  assertPassword(password)
  const [result] = await pool.execute<any>('UPDATE `user` SET Password = ?, AuthProvider = \'local\', ResetPasswordToken = NULL, ResetPasswordExpiry = NULL WHERE ResetPasswordToken = ? AND ResetPasswordExpiry > UTC_TIMESTAMP()', [await hashPassword(password), hashToken(token)])
  if (!result.affectedRows) throw createError({ statusCode: 400, statusMessage: 'This reset link is invalid or expired.' })
  return { message: 'Password updated. You may now log in.' }
})