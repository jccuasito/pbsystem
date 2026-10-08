import { createError, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { dateOnly, rateAmountKeys, versionDefinitions, type VersionKind } from './rateVersions'

function positiveId(value: unknown) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'Select a valid rate to update.' })
  return id
}

function effectiveDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw createError({ statusCode: 400, statusMessage: 'Choose a valid effective date.' })
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw createError({ statusCode: 400, statusMessage: 'Choose a valid effective date.' })
  return value
}

function amount(value: unknown, field: string) {
  const number = Number(value)
  if ((typeof value !== 'number' && typeof value !== 'string') || !Number.isFinite(number) || number < 0 || number > 99999999.99 || Math.abs(number * 100 - Math.round(number * 100)) > 0.000001) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a non-negative amount with up to two decimal places.` })
  }
  return number
}

export async function createRateVersion(event: any) {
  const session = requireSession(event); void session.sub
  const body = await readBody<Record<string, any>>(event) || {}
  const kind = body.resource as VersionKind
  if (kind !== 'payroll-rate' && kind !== 'billing-rate') throw createError({ statusCode: 400, statusMessage: 'Choose payroll or billing rates.' })
  const { table, versionTable, id } = versionDefinitions[kind]
  const rateId = positiveId(body.id)
  const date = effectiveDate(body.EffectiveDate)
  const reason = String(body.Reason || '').trim()
  if (reason.length > 500) throw createError({ statusCode: 400, statusMessage: 'Reason must be 500 characters or fewer.' })
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[base]] = await connection.execute<any[]>(`SELECT * FROM ${table} WHERE ${id} = ? FOR UPDATE`, [rateId])
    if (!base) throw createError({ statusCode: 404, statusMessage: 'Rate not found.' })
    if (base.Status !== 'Active') throw createError({ statusCode: 409, statusMessage: 'Only active rates can be updated.' })
    const [[latest]] = await connection.execute<any[]>(`SELECT * FROM ${versionTable} WHERE ${id} = ? ORDER BY EffectiveDate DESC LIMIT 1`, [rateId])
    const previousDate = dateOnly(latest?.EffectiveDate || base.EffectiveDate)
    if (previousDate && date <= previousDate) throw createError({ statusCode: 409, statusMessage: `Choose an effective date after ${previousDate}. Existing versions cannot be overwritten.` })
    const previous = latest || base
    const amounts = rateAmountKeys.map(field => amount(body[field] === undefined ? previous[field] ?? 0 : body[field], field))
    const [result] = await connection.execute<any>(`INSERT INTO ${versionTable} (${id}, EffectiveDate, ${rateAmountKeys.join(', ')}, Reason) VALUES (${[id, 'EffectiveDate', ...rateAmountKeys, 'Reason'].map(() => '?').join(', ')})`, [rateId, date, ...amounts, reason])
    const [[usage]] = await connection.execute<any[]>(`SELECT COUNT(DISTINCT SiteID) AS LinkedSites FROM site_rate WHERE ${id} = ? AND Status = 'Active'`, [rateId])
    await connection.commit()
    return { id: result.insertId, effectiveDate: date, linkedSites: Number(usage.LinkedSites || 0) }
  } catch (error: any) {
    await connection.rollback()
    if (error?.code === 'ER_DUP_ENTRY') throw createError({ statusCode: 409, statusMessage: 'A version already exists on this effective date.' })
    throw error
  } finally { connection.release() }
}
