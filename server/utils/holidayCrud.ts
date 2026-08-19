import { createError, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

type HolidayBody = Record<string, unknown>

function holidayId(value: unknown) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'A valid holiday ID is required.' })
  return id
}

function holidayDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw createError({ statusCode: 400, statusMessage: 'Holiday date is required.' })
  return value
}

function holidayName(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw createError({ statusCode: 400, statusMessage: 'Holiday name is required.' })
  return value.trim()
}

function holidayType(value: unknown) {
  if (value !== 'Legal' && value !== 'Special') throw createError({ statusCode: 400, statusMessage: 'Holiday type must be Legal or Special.' })
  return value
}

function status(value: unknown) {
  if (value === undefined || value === null || value === '') return 'Active'
  if (value === 'Active' || value === 'Inactive') return value
  throw createError({ statusCode: 400, statusMessage: 'Status must be Active or Inactive.' })
}

function recurring(value: unknown) {
  return value === true || value === 1 || value === '1' ? 1 : 0
}

function values(body: HolidayBody) {
  return [holidayName(body.HolidayName), holidayDate(body.HolidayDate), holidayType(body.HolidayType), recurring(body.Recurring), status(body.Status)] as const
}

async function ensureNoDuplicate(name: string, date: string, excludeId?: number) {
  const sql = `SELECT HolidayID FROM holiday WHERE HolidayName = ? AND HolidayDate = ?${excludeId ? ' AND HolidayID <> ?' : ''} LIMIT 1`
  const [rows] = await pool.execute<any[]>(sql, excludeId ? [name, date, excludeId] : [name, date])
  if (rows[0]) throw createError({ statusCode: 409, statusMessage: 'A holiday with the same name and date already exists.' })
}

export async function listHolidays(event: any) {
  const session = requireSession(event)
  void session.sub
  const [items] = await pool.execute<any[]>(`SELECT HolidayID, HolidayName, HolidayDate, HolidayType, Recurring, Status, CreatedAt
    FROM holiday ORDER BY HolidayDate DESC, HolidayName`)
  return { items }
}

export async function createHoliday(event: any) {
  const session = requireSession(event)
  const body = await readBody<HolidayBody>(event) || {}
  const [name, date, type, isRecurring, currentStatus] = values(body)
  await ensureNoDuplicate(name, date)
  const [result] = await pool.execute<any>(
    'INSERT INTO holiday (HolidayName, HolidayDate, HolidayType, Recurring, Status, CreatedBy) VALUES (?, ?, ?, ?, ?, ?)',
    [name, date, type, isRecurring, currentStatus, session.sub]
  )
  return { id: result.insertId }
}

export async function updateHoliday(event: any) {
  const session = requireSession(event)
  void session.sub
  const body = await readBody<HolidayBody>(event) || {}
  const id = holidayId(body.id)
  const [name, date, type, isRecurring, currentStatus] = values(body)
  await ensureNoDuplicate(name, date, id)
  const [result] = await pool.execute<any>(
    'UPDATE holiday SET HolidayName = ?, HolidayDate = ?, HolidayType = ?, Recurring = ?, Status = ? WHERE HolidayID = ?',
    [name, date, type, isRecurring, currentStatus, id]
  )
  if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Holiday not found.' })
  return { success: true }
}

export async function deactivateHoliday(event: any) {
  const session = requireSession(event)
  void session.sub
  const body = await readBody<{ id?: unknown }>(event)
  const id = holidayId(body?.id)
  const [result] = await pool.execute<any>("UPDATE holiday SET Status = 'Inactive' WHERE HolidayID = ?", [id])
  if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Holiday not found.' })
  return { success: true }
}
