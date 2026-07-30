import { createError, getQuery } from 'h3'
import pool from '../../connection/dbconnect'
import { hashToken } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const token = getQuery(event).token
  if (typeof token !== 'string' || token.length !== 64) throw createError({ statusCode: 400, statusMessage: 'Invalid verification link.' })
  const [result] = await pool.execute<any>('UPDATE `user` SET EmailVerified = 1, VerificationToken = NULL, VerificationTokenExpiry = NULL WHERE VerificationToken = ? AND VerificationTokenExpiry > UTC_TIMESTAMP()', [hashToken(token)])
  if (!result.affectedRows) throw createError({ statusCode: 400, statusMessage: 'This verification link is invalid or expired.' })
  return { message: 'Email verified. You may now log in.' }
})
