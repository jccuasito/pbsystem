import { createError, getQuery } from 'h3'
import pool from '../../connection/dbconnect'
import { hashToken } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const token = getQuery(event).token
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw createError({ statusCode: 400, statusMessage: 'Invalid verification link.' })
  const [result] = await pool.execute<any>('UPDATE `user` SET EmailVerified = 1, VerificationToken = NULL, VerificationTokenExpiry = NULL WHERE VerificationToken = ? AND VerificationTokenExpiry > UTC_TIMESTAMP()', [hashToken(token)])
  if (!result.affectedRows) throw createError({ statusCode: 400, statusMessage: 'This verification link is invalid or expired.' })
  return { message: 'Email verified. You can sign in once an administrator has activated your staff account.' }
})
