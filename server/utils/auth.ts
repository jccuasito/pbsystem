import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import { createError, getCookie, setCookie } from 'h3'
import { signToken, verifyToken } from './jwt'

export type AuthUser = { UserID: number; FirstName: string; LastName: string; Email: string; DepartmentID: number | null; UserType: string; Status: string }

const SESSION_COOKIE = 'pbs_session'

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')
export const randomToken = () => crypto.randomBytes(32).toString('hex')
export const randomVerificationCode = () => crypto.randomInt(100000, 1000000).toString()
export const normalizeEmail = (email: string) => email.trim().toLowerCase()
export const hashPassword = (password: string) => bcrypt.hash(password, 12)
export const passwordMatches = (password: string, hash: string) => bcrypt.compare(password, hash)

export function assertPassword(password: string) {
  if (password.length < 12 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 12 characters and include letters and numbers.' })
  }
}

export function safeUser(user: AuthUser) {
  return { id: user.UserID, firstName: user.FirstName, lastName: user.LastName, email: user.Email, departmentId: user.DepartmentID, userType: user.UserType }
}

export function setSession(event: any, user: AuthUser) {
  setCookie(event, SESSION_COOKIE, signToken({ sub: user.UserID, email: user.Email, userType: user.UserType }), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7
  })
}

export function clearSession(event: any) {
  setCookie(event, SESSION_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
}

export function requireSession(event: any) {
  const token = getCookie(event, SESSION_COOKIE)
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Please sign in.' })
  try { return verifyToken(token) as { sub: number } } catch { throw createError({ statusCode: 401, statusMessage: 'Your session has expired. Please sign in again.' }) }
}
