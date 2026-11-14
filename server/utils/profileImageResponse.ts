import { createError, getRouterParam, setHeader } from 'h3'
import { promises as fs } from 'node:fs'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { accessForUser, currentActor } from './settingsAccess'
import { privateProfilePath } from './privateProfileImages.mjs'

export async function profileImageResponse(event: any, kind: 'employees' | 'avatars') {
  const session = requireSession(event)
  void session.sub
  const actor = await currentActor(event)
  if (kind === 'employees' && actor.UserType !== 'Admin') {
    const permissions = await accessForUser(actor.UserID, actor.UserType)
    if (!permissions.employees?.canView) throw createError({ statusCode: 403, statusMessage: 'Employee view access is required.' })
  }
  const name = getRouterParam(event, 'name')
  let file: string
  try { file = privateProfilePath(kind, name) } catch { throw createError({ statusCode: 404, statusMessage: 'Image not found.' }) }
  const url = `/uploads/${kind}/${name}`
  const [rows] = kind === 'employees'
    ? await pool.execute<any[]>('SELECT EmployeeID FROM employee WHERE PhotoPath=? LIMIT 1', [url])
    : await pool.execute<any[]>('SELECT UserID FROM `user` WHERE Image=? LIMIT 1', [url])
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'Image not found.' })
  let bytes: Buffer
  try { bytes = await fs.readFile(file) } catch { throw createError({ statusCode: 404, statusMessage: 'Image not found.' }) }
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Content-Type', name!.endsWith('.jpg') ? 'image/jpeg' : name!.endsWith('.png') ? 'image/png' : 'image/webp')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return bytes
}
