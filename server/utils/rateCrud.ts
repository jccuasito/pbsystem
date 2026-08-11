import { createError, getRouterParam, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

type Resource = 'payroll-rate' | 'billing-rate' | 'client-rate'
const moneyFields = ['RegularRate', 'OTRate', 'NightDiffRate', 'RestDayRate', 'SpecialHolidayRate', 'LegalHolidayRate', 'SpecialHolidayOTRate', 'LegalHolidayOTRate', 'BreakDeduction', 'Allowance']
const rateFields = ['AgencyPositionID', 'RegionID', ...moneyFields, 'EffectiveDate', 'Status']

const rateListSql = (table: 'payroll_rate' | 'billing_rate', id: 'PayrollRateID' | 'BillingRateID') => `
  SELECT r.${id}, r.AgencyPositionID, a.AgencyName, p.PositionName, r.RegionID, rg.RegionCode, rg.RegionName,
    r.RegularRate, r.OTRate, r.NightDiffRate, r.RestDayRate, r.SpecialHolidayRate, r.LegalHolidayRate,
    r.SpecialHolidayOTRate, r.LegalHolidayOTRate, r.BreakDeduction, r.Allowance, r.EffectiveDate, r.Status
  FROM ${table} r
  INNER JOIN agency_position ap ON ap.AgencyPositionID = r.AgencyPositionID
  INNER JOIN agency a ON a.AgencyID = ap.AgencyID
  INNER JOIN \`position\` p ON p.PositionID = ap.PositionID
  LEFT JOIN region rg ON rg.RegionID = r.RegionID
  ORDER BY a.AgencyName, p.PositionName, r.EffectiveDate DESC, r.${id} DESC`

const agencyPositions = async () => {
  const [rows] = await pool.execute<any[]>(`SELECT ap.AgencyPositionID, a.AgencyName, p.PositionName FROM agency_position ap INNER JOIN agency a ON a.AgencyID = ap.AgencyID INNER JOIN \`position\` p ON p.PositionID = ap.PositionID WHERE ap.Status = 'Active' AND a.Status = 'Active' AND p.Status = 'Active' ORDER BY a.AgencyName, p.PositionName`)
  return rows
}
const regions = async () => { const [rows] = await pool.execute<any[]>("SELECT RegionID, RegionCode, RegionName FROM region WHERE Status = 'Active' ORDER BY RegionName"); return rows }
const clients = async () => { const [rows] = await pool.execute<any[]>("SELECT ClientID, ClientName FROM client WHERE Status = 'Active' ORDER BY ClientName"); return rows }

function resource(event: any): Resource {
  const value = getRouterParam(event, 'resource') as Resource
  if (value !== 'payroll-rate' && value !== 'billing-rate' && value !== 'client-rate') throw createError({ statusCode: 404, statusMessage: 'Rate resource not found.' })
  return value
}
function validId(value: unknown, field: string, optional = false) {
  if (optional && (value === null || value === undefined || value === '')) return null
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw createError({ statusCode: 400, statusMessage: `${field} must be a valid ID.` })
  return number
}
function amount(value: unknown, field: string) {
  if (value === null || value === undefined || value === '') return 0
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw createError({ statusCode: 400, statusMessage: `${field} must be a non-negative amount.` })
  return number
}
function status(value: unknown) {
  if (value === undefined || value === null || value === '') return 'Active'
  if (value === 'Active' || value === 'Inactive') return value
  throw createError({ statusCode: 400, statusMessage: 'Status must be Active or Inactive.' })
}
function rateValues(body: Record<string, any>) {
  return [validId(body.AgencyPositionID, 'AgencyPositionID'), validId(body.RegionID, 'RegionID', true), ...moneyFields.map((field) => amount(body[field], field)), typeof body.EffectiveDate === 'string' && body.EffectiveDate ? body.EffectiveDate : null, status(body.Status)]
}
function rateTable(resource: Resource) { return resource === 'payroll-rate' ? { table: 'payroll_rate', id: 'PayrollRateID' } : { table: 'billing_rate', id: 'BillingRateID' } }

async function assertRatePair(connection: any, payrollRateID: number, billingRateID: number, agencyPositionID: number) {
  const [[payrollRows], [billingRows]] = await Promise.all([
    connection.execute<any[]>('SELECT PayrollRateID FROM payroll_rate WHERE PayrollRateID = ? AND AgencyPositionID = ? AND Status = \'Active\' LIMIT 1', [payrollRateID, agencyPositionID]),
    connection.execute<any[]>('SELECT BillingRateID FROM billing_rate WHERE BillingRateID = ? AND AgencyPositionID = ? AND Status = \'Active\' LIMIT 1', [billingRateID, agencyPositionID])
  ])
  if (!payrollRows[0] || !billingRows[0]) throw createError({ statusCode: 400, statusMessage: 'Select active payroll and billing rates for the same agency position.' })
}
async function insertRate(connection: any, table: 'payroll_rate' | 'billing_rate', body: Record<string, any>) {
  const [result] = await connection.execute<any>(`INSERT INTO ${table} (${rateFields.join(', ')}) VALUES (${rateFields.map(() => '?').join(', ')})`, rateValues(body))
  return result.insertId as number
}

export async function listRateResource(event: any) {
  const session = requireSession(event); void session.sub
  const selected = resource(event)
  if (selected === 'payroll-rate' || selected === 'billing-rate') {
    const definition = rateTable(selected)
    const [[items], positions, regionRows] = await Promise.all([pool.execute<any[]>(rateListSql(definition.table as any, definition.id as any)), agencyPositions(), regions()])
    return { items, agencyPositions: positions, regions: regionRows }
  }
  const [[items], clientRows, positions, regionRows, payrollRates, billingRates] = await Promise.all([
    pool.execute<any[]>(`SELECT cr.ClientRateID, cr.ClientID, c.ClientName, cr.PayrollRateID, cr.BillingRateID, cr.Status, pr.AgencyPositionID, a.AgencyName, p.PositionName, pr.RegionID, rg.RegionName, pr.RegularRate AS PayrollRegularRate, br.RegularRate AS BillingRegularRate FROM client_rate cr INNER JOIN client c ON c.ClientID = cr.ClientID INNER JOIN payroll_rate pr ON pr.PayrollRateID = cr.PayrollRateID INNER JOIN billing_rate br ON br.BillingRateID = cr.BillingRateID INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID INNER JOIN agency a ON a.AgencyID = ap.AgencyID INNER JOIN \`position\` p ON p.PositionID = ap.PositionID LEFT JOIN region rg ON rg.RegionID = pr.RegionID ORDER BY c.ClientName, a.AgencyName, p.PositionName`),
    clients(), agencyPositions(), regions(), pool.execute<any[]>(rateListSql('payroll_rate', 'PayrollRateID')).then(([rows]) => rows), pool.execute<any[]>(rateListSql('billing_rate', 'BillingRateID')).then(([rows]) => rows)
  ])
  return { items, clients: clientRows, agencyPositions: positions, regions: regionRows, payrollRates, billingRates }
}

export async function createRateResource(event: any) {
  const session = requireSession(event); void session.sub
  const selected = resource(event); const body = await readBody<Record<string, any>>(event) || {}
  if (selected !== 'client-rate') return { id: await insertRate(pool, rateTable(selected).table as any, body) }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const agencyPositionID = validId(body.AgencyPositionID, 'AgencyPositionID')
    let payrollRateID = validId(body.PayrollRateID, 'PayrollRateID', true)
    let billingRateID = validId(body.BillingRateID, 'BillingRateID', true)
    if (body.inlinePayrollRate) payrollRateID = await insertRate(connection, 'payroll_rate', { ...body.inlinePayrollRate, AgencyPositionID: agencyPositionID })
    if (body.inlineBillingRate) billingRateID = await insertRate(connection, 'billing_rate', { ...body.inlineBillingRate, AgencyPositionID: agencyPositionID })
    if (!payrollRateID || !billingRateID) throw createError({ statusCode: 400, statusMessage: 'Choose or create both a payroll and billing rate.' })
    await assertRatePair(connection, payrollRateID, billingRateID, agencyPositionID)
    const [result] = await connection.execute<any>('INSERT INTO client_rate (ClientID, PayrollRateID, BillingRateID, Status) VALUES (?, ?, ?, ?)', [validId(body.ClientID, 'ClientID'), payrollRateID, billingRateID, status(body.Status)])
    await connection.commit()
    return { id: result.insertId }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function updateRateResource(event: any) {
  const session = requireSession(event); void session.sub
  const selected = resource(event); const body = await readBody<Record<string, any>>(event) || {}; const id = validId(body.id, 'id')
  if (selected !== 'client-rate') {
    const definition = rateTable(selected)
    const [result] = await pool.execute<any>(`UPDATE ${definition.table} SET AgencyPositionID = ?, RegionID = ?, ${moneyFields.map((field) => `${field} = ?`).join(', ')}, EffectiveDate = ?, Status = ? WHERE ${definition.id} = ?`, [...rateValues(body), id])
    if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Rate not found.' })
    return { success: true }
  }
  const payrollRateID = validId(body.PayrollRateID, 'PayrollRateID'); const billingRateID = validId(body.BillingRateID, 'BillingRateID'); const agencyPositionID = validId(body.AgencyPositionID, 'AgencyPositionID')
  await assertRatePair(pool, payrollRateID, billingRateID, agencyPositionID)
  const [result] = await pool.execute<any>('UPDATE client_rate SET ClientID = ?, PayrollRateID = ?, BillingRateID = ?, Status = ? WHERE ClientRateID = ?', [validId(body.ClientID, 'ClientID'), payrollRateID, billingRateID, status(body.Status), id])
  if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Client rate not found.' })
  return { success: true }
}

export async function deleteRateResource(event: any) {
  const session = requireSession(event); void session.sub
  const selected = resource(event); const body = await readBody<{ id?: unknown }>(event); const id = validId(body?.id, 'id')
  const definition = selected === 'client-rate' ? { table: 'client_rate', id: 'ClientRateID' } : rateTable(selected)
  const [result] = await pool.execute<any>(`UPDATE ${definition.table} SET Status = 'Inactive' WHERE ${definition.id} = ?`, [id])
  if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Rate not found.' })
  return { success: true }
}
