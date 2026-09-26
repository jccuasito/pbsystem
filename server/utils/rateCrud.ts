import { createError, getRouterParam, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { rateMoneyFields } from '../../shared/utils/rateFields'

type Resource = 'payroll-rate' | 'billing-rate' | 'site-rate'
const moneyFields = rateMoneyFields.map(({ key }) => key)
const rateFields = ['AgencyPositionID', 'RegionID', ...moneyFields, 'EffectiveDate', 'Status']

const rateListSql = (table: 'payroll_rate' | 'billing_rate', id: 'PayrollRateID' | 'BillingRateID') => `
  SELECT r.${id}, r.AgencyPositionID, a.AgencyName, p.PositionName, r.RegionID, rg.RegionCode, rg.RegionName,
    ${moneyFields.map(field => `r.${field}`).join(', ')}, r.EffectiveDate, r.Status
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
const sites = async () => { const [rows] = await pool.execute<any[]>(`SELECT s.SiteID, s.ClientID, c.ClientName, s.SiteName, s.RegionID, rg.RegionCode, rg.RegionName
  FROM site s INNER JOIN client c ON c.ClientID = s.ClientID LEFT JOIN region rg ON rg.RegionID = s.RegionID
  WHERE s.Status = 'Active' AND c.Status = 'Active' ORDER BY c.ClientName, s.SiteName`); return rows }

function resource(event: any): Resource {
  const value = getRouterParam(event, 'resource') as Resource
  if (value !== 'payroll-rate' && value !== 'billing-rate' && value !== 'site-rate') throw createError({ statusCode: 404, statusMessage: 'Rate resource not found.' })
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
  if (!['number', 'string'].includes(typeof value) || !Number.isFinite(number) || number < 0 || number > 99999999.99) throw createError({ statusCode: 400, statusMessage: `${field} must be an amount from 0 to 99,999,999.99.` })
  if (Math.abs(number * 100 - Math.round(number * 100)) > 0.000001) throw createError({ statusCode: 400, statusMessage: `${field} supports up to two decimal places.` })
  return number
}
function status(value: unknown) {
  if (value === undefined || value === null || value === '') return 'Active'
  if (value === 'Active' || value === 'Inactive') return value
  throw createError({ statusCode: 400, statusMessage: 'Status must be Active or Inactive.' })
}
function rateValues(body: Record<string, any>, preserveOmittedAmounts = false) {
  return [validId(body.AgencyPositionID, 'AgencyPositionID'), validId(body.RegionID, 'RegionID', true), ...moneyFields.map((field) => preserveOmittedAmounts && !Object.hasOwn(body, field) ? null : amount(body[field], field)), typeof body.EffectiveDate === 'string' && body.EffectiveDate ? body.EffectiveDate : null, status(body.Status)]
}
function rateTable(resource: Resource) { return resource === 'payroll-rate' ? { table: 'payroll_rate', id: 'PayrollRateID' } : { table: 'billing_rate', id: 'BillingRateID' } }
function isSiteRate(resource: Resource) { return resource === 'site-rate' }

async function siteDetails(connection: any, siteID: number) {
  const [[site]] = await connection.execute<any[]>(`SELECT s.SiteID, s.ClientID, s.RegionID, s.SiteName, c.ClientName
    FROM site s INNER JOIN client c ON c.ClientID = s.ClientID
    WHERE s.SiteID = ? AND s.Status = 'Active' AND c.Status = 'Active' LIMIT 1 FOR UPDATE`, [siteID])
  if (!site) throw createError({ statusCode: 400, statusMessage: 'Select an active site.' })
  if (!site.RegionID) throw createError({ statusCode: 400, statusMessage: 'Set the site region in Organization > Sites before linking rates.' })
  return site
}

async function assertRatePair(connection: any, payrollRateID: number, billingRateID: number, agencyPositionID: number, regionID: number) {
  const [[payrollRows], [billingRows]] = await Promise.all([
    connection.execute<any[]>('SELECT PayrollRateID, RegionID FROM payroll_rate WHERE PayrollRateID = ? AND AgencyPositionID = ? AND Status = \'Active\' LIMIT 1', [payrollRateID, agencyPositionID]),
    connection.execute<any[]>('SELECT BillingRateID, RegionID FROM billing_rate WHERE BillingRateID = ? AND AgencyPositionID = ? AND Status = \'Active\' LIMIT 1', [billingRateID, agencyPositionID])
  ])
  if (!payrollRows[0] || !billingRows[0]) throw createError({ statusCode: 400, statusMessage: 'Select active payroll and billing rates for the same agency position.' })
  if (Number(payrollRows[0].RegionID) !== regionID || Number(billingRows[0].RegionID) !== regionID) {
    throw createError({ statusCode: 400, statusMessage: 'Payroll and billing rates must match the selected site region.' })
  }
}

async function assertNoActiveSiteRate(connection: any, siteID: number, agencyPositionID: number, exceptID?: number) {
  const [rows] = await connection.execute<any[]>(`SELECT sr.SiteRateID FROM site_rate sr
    INNER JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
    WHERE sr.SiteID = ? AND pr.AgencyPositionID = ? AND sr.Status = 'Active'${exceptID ? ' AND sr.SiteRateID <> ?' : ''}
    LIMIT 1`, exceptID ? [siteID, agencyPositionID, exceptID] : [siteID, agencyPositionID])
  if (rows[0]) throw createError({ statusCode: 409, statusMessage: 'This site already has an active rate for the selected agency position.' })
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
  const [[items], siteRows, positions, regionRows, payrollRates, billingRates] = await Promise.all([
    pool.execute<any[]>(`SELECT sr.SiteRateID, s.ClientID, sr.SiteID, c.ClientName, s.SiteName, sr.PayrollRateID, sr.BillingRateID, sr.Status,
      pr.AgencyPositionID, a.AgencyName, p.PositionName, s.RegionID, rg.RegionCode, rg.RegionName,
      pr.RegionID AS PayrollRegionID, br.RegionID AS BillingRegionID,
      pr.RegularRate AS PayrollRegularRate, br.RegularRate AS BillingRegularRate
      FROM site_rate sr
      INNER JOIN site s ON s.SiteID = sr.SiteID
      INNER JOIN client c ON c.ClientID = s.ClientID
      INNER JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
      INNER JOIN billing_rate br ON br.BillingRateID = sr.BillingRateID
      INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
      INNER JOIN agency a ON a.AgencyID = ap.AgencyID INNER JOIN \`position\` p ON p.PositionID = ap.PositionID
      LEFT JOIN region rg ON rg.RegionID = s.RegionID
      ORDER BY c.ClientName, s.SiteName, a.AgencyName, p.PositionName`),
    sites(), agencyPositions(), regions(), pool.execute<any[]>(rateListSql('payroll_rate', 'PayrollRateID')).then(([rows]) => rows), pool.execute<any[]>(rateListSql('billing_rate', 'BillingRateID')).then(([rows]) => rows)
  ])
  return { items, sites: siteRows, agencyPositions: positions, regions: regionRows, payrollRates, billingRates }
}

export async function createRateResource(event: any) {
  const session = requireSession(event); void session.sub
  const selected = resource(event); const body = await readBody<Record<string, any>>(event) || {}
  if (!isSiteRate(selected)) return { id: await insertRate(pool, rateTable(selected).table as any, body) }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const agencyPositionID = validId(body.AgencyPositionID, 'AgencyPositionID')
    const site = await siteDetails(connection, validId(body.SiteID, 'SiteID'))
    let payrollRateID = validId(body.PayrollRateID, 'PayrollRateID', true)
    let billingRateID = validId(body.BillingRateID, 'BillingRateID', true)
    if (body.inlinePayrollRate) payrollRateID = await insertRate(connection, 'payroll_rate', { ...body.inlinePayrollRate, AgencyPositionID: agencyPositionID, RegionID: site.RegionID })
    if (body.inlineBillingRate) billingRateID = await insertRate(connection, 'billing_rate', { ...body.inlineBillingRate, AgencyPositionID: agencyPositionID, RegionID: site.RegionID })
    if (!payrollRateID || !billingRateID) throw createError({ statusCode: 400, statusMessage: 'Choose or create both a payroll and billing rate.' })
    await assertRatePair(connection, payrollRateID, billingRateID, agencyPositionID, Number(site.RegionID))
    if (status(body.Status) === 'Active') await assertNoActiveSiteRate(connection, Number(site.SiteID), agencyPositionID)
    const [result] = await connection.execute<any>('INSERT INTO site_rate (SiteID, PayrollRateID, BillingRateID, Status) VALUES (?, ?, ?, ?)', [site.SiteID, payrollRateID, billingRateID, status(body.Status)])
    await connection.commit()
    return { id: result.insertId }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function updateRateResource(event: any) {
  const session = requireSession(event); void session.sub
  const selected = resource(event); const body = await readBody<Record<string, any>>(event) || {}; const id = validId(body.id, 'id')
  if (!isSiteRate(selected)) {
    const definition = rateTable(selected)
    const [result] = await pool.execute<any>(`UPDATE ${definition.table} SET AgencyPositionID = ?, RegionID = ?, ${moneyFields.map((field) => `${field} = COALESCE(?, ${field})`).join(', ')}, EffectiveDate = ?, Status = ? WHERE ${definition.id} = ?`, [...rateValues(body, true), id])
    if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Rate not found.' })
    return { success: true }
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const payrollRateID = validId(body.PayrollRateID, 'PayrollRateID'); const billingRateID = validId(body.BillingRateID, 'BillingRateID'); const agencyPositionID = validId(body.AgencyPositionID, 'AgencyPositionID')
    const site = await siteDetails(connection, validId(body.SiteID, 'SiteID'))
    await assertRatePair(connection, payrollRateID, billingRateID, agencyPositionID, Number(site.RegionID))
    if (status(body.Status) === 'Active') await assertNoActiveSiteRate(connection, Number(site.SiteID), agencyPositionID, id)
    const [result] = await connection.execute<any>('UPDATE site_rate SET SiteID = ?, PayrollRateID = ?, BillingRateID = ?, Status = ? WHERE SiteRateID = ?', [site.SiteID, payrollRateID, billingRateID, status(body.Status), id])
    if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Site rate not found.' })
    await connection.commit()
    return { success: true }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function deleteRateResource(event: any) {
  const session = requireSession(event); void session.sub
  const selected = resource(event); const body = await readBody<{ id?: unknown }>(event); const id = validId(body?.id, 'id')
  const definition = isSiteRate(selected) ? { table: 'site_rate', id: 'SiteRateID' } : rateTable(selected)
  const [result] = await pool.execute<any>(`UPDATE ${definition.table} SET Status = 'Inactive' WHERE ${definition.id} = ?`, [id])
  if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Rate not found.' })
  return { success: true }
}
