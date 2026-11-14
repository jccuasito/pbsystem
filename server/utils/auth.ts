import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import { createError, getCookie, setCookie } from 'h3'
import { signToken, verifyToken } from './jwt'
import { emailInput } from './inputValidation'

export type AuthUser = { UserID: number; FirstName: string; LastName: string; Email: string; DepartmentID: number | null; UserType: string; Status: string }

const SESSION_COOKIE = 'pbs_session'

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')
export const randomToken = () => crypto.randomBytes(32).toString('hex')
export const randomVerificationCode = () => crypto.randomInt(100000, 1000000).toString()
export const normalizeEmail = (email: unknown) => emailInput(email)
export const hashPassword = (password: string) => bcrypt.hash(password, 12)
export const passwordMatches = (password: string, hash: string) => bcrypt.compare(password, hash)

export function assertPassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 12 characters, no more than 72 bytes, and include letters and numbers.' })
  }
}

export function safeUser(user: AuthUser) {
  return { id: user.UserID, firstName: user.FirstName, lastName: user.LastName, email: user.Email, departmentId: user.DepartmentID, userType: user.UserType }
}

export function setSession(event: any, user: AuthUser, historyId?: number) {
  setCookie(event, SESSION_COOKIE, signToken({ sub: user.UserID, email: user.Email, userType: user.UserType, historyId }), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7
  })
}

export function clearSession(event: any) {
  setCookie(event, SESSION_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
}

export function requireSession(event: any) {
  const token = getCookie(event, SESSION_COOKIE)
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Please sign in.' })
  try {
    const claims = verifyToken(token) as { sub: number; email: string; userType: string; historyId?: number }
    if (!claims || !Number.isSafeInteger(claims.sub) || claims.sub < 1 || typeof claims.email !== 'string' || !['Admin', 'Supervisor', 'Encoder', 'Viewer'].includes(claims.userType) || (claims as any).signup) throw new Error('Invalid session claims')
    return event.context?.activeUserType ? { ...claims, userType: event.context.activeUserType as string } : claims
  }
  catch { throw createError({ statusCode: 401, statusMessage: 'Your session has expired. Please sign in again.' }) }
}
