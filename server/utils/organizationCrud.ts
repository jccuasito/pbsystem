import { createError, getQuery, getRouterParam, readBody, setHeader } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

type Resource = 'agency' | 'position' | 'agency-position' | 'client' | 'client-policy' | 'site' | 'site-policy' | 'site-shift' | 'shift-code' | 'region'

type Config = { table: string; id: string; fields: string[]; listSql: string; lookups?: () => Promise<Record<string, unknown>> }

const policyFields = ['NDEnabled', 'NDStartTime', 'NDEndTime', 'AutoBreakEnabled', 'DefaultBreakMinutes', 'GraceMinutes', 'LateAfterMinutes', 'ComputeLate', 'ComputeUndertime', 'ComputeOT', 'ComputeHoliday', 'ComputeRestDay', 'Status']
const sitePolicyFields = ['NDEnabled', 'DayShiftNDEnabled', 'NDStartTime', 'NDEndTime', 'AutoBreakEnabled', 'DefaultBreakMinutes', 'GraceMinutes', 'LateAfterMinutes', 'ComputeLate', 'ComputeUndertime', 'ComputeOT', 'ComputeHoliday', 'ComputeRestDay', 'Status']
const booleanFields = new Set(['NDEnabled', 'DayShiftNDEnabled', 'AutoBreakEnabled', 'ComputeLate', 'ComputeUndertime', 'ComputeOT', 'ComputeHoliday', 'ComputeRestDay'])
const numberFields = new Set(['AgencyID', 'PositionID', 'RegionID', 'ClientID', 'SiteID', 'ShiftCodeID', 'DefaultBreakMinutes', 'GraceMinutes', 'LateAfterMinutes'])

const activeAgencies = async () => { const [rows] = await pool.execute<any[]>('SELECT AgencyID, AgencyName FROM agency WHERE Status = \'Active\' ORDER BY AgencyName'); return { agencies: rows } }
const activePositions = async () => { const [rows] = await pool.execute<any[]>('SELECT PositionID, PositionName FROM `position` WHERE Status = \'Active\' ORDER BY PositionName'); return { positions: rows } }
const activeRegions = async () => { const [rows] = await pool.execute<any[]>('SELECT RegionID, RegionCode, RegionName FROM region WHERE Status = \'Active\' ORDER BY RegionName'); return { regions: rows } }
const activeClients = async () => { const [rows] = await pool.execute<any[]>('SELECT ClientID, ClientName FROM client WHERE Status = \'Active\' ORDER BY ClientName'); return { clients: rows } }
const activeSites = async () => { const [rows] = await pool.execute<any[]>('SELECT SiteID, SiteName, ClientID FROM site WHERE Status = \'Active\' ORDER BY SiteName'); return { sites: rows } }
const activeShiftCodes = async () => { const [rows] = await pool.execute<any[]>('SELECT ShiftCodeID, AgencyID, ShiftCode, ShiftName FROM shift_code WHERE Status = \'Active\' ORDER BY ShiftCode, ShiftName'); return { shiftCodes: rows } }

const configs: Record<Resource, Config> = {
  agency: { table: 'agency', id: 'AgencyID', fields: ['AgencyName', 'AgencyAddress', 'AgencyEmail', 'AgencyContact', 'Status'], listSql: 'SELECT AgencyID, AgencyName, AgencyAddress, AgencyEmail, AgencyContact, Status, CreatedAt, CASE WHEN LogoData IS NULL THEN 0 ELSE 1 END AS HasLogo FROM agency ORDER BY AgencyName' },
  position: { table: '`position`', id: 'PositionID', fields: ['PositionName', 'Description', 'Status'], listSql: 'SELECT PositionID, PositionName, Description, Status FROM `position` ORDER BY PositionName' },
  'agency-position': { table: 'agency_position', id: 'AgencyPositionID', fields: ['AgencyID', 'PositionID', 'Status'], listSql: 'SELECT ap.AgencyPositionID, ap.AgencyID, a.AgencyName, ap.PositionID, p.PositionName, ap.Status FROM agency_position ap INNER JOIN agency a ON a.AgencyID = ap.AgencyID INNER JOIN `position` p ON p.PositionID = ap.PositionID ORDER BY a.AgencyName, p.PositionName', lookups: async () => ({ ...(await activeAgencies()), ...(await activePositions()) }) },
  region: { table: 'region', id: 'RegionID', fields: ['RegionCode', 'RegionName', 'Status'], listSql: 'SELECT RegionID, RegionCode, RegionName, Status FROM region ORDER BY RegionName' },
  client: { table: 'client', id: 'ClientID', fields: ['ClientName', 'RegionID', 'ClientAddress', 'ContractStart', 'ContractEnd', 'Status'], listSql: 'SELECT c.ClientID, c.ClientName, c.RegionID, r.RegionCode, r.RegionName, c.ClientAddress, c.ContractStart, c.ContractEnd, c.Status FROM client c LEFT JOIN region r ON r.RegionID = c.RegionID ORDER BY c.ClientName', lookups: activeRegions },
  'client-policy': { table: 'client_policy', id: 'ClientPolicyID', fields: ['ClientID', ...policyFields], listSql: 'SELECT cp.*, c.ClientName FROM client_policy cp INNER JOIN client c ON c.ClientID = cp.ClientID ORDER BY c.ClientName', lookups: activeClients },
  site: { table: 'site', id: 'SiteID', fields: ['ClientID', 'SiteName', 'SiteAddress', 'Status'], listSql: `SELECT s.SiteID, s.ClientID, c.ClientName, s.SiteName, s.SiteAddress, s.Status, CASE WHEN s.LogoData IS NULL THEN 0 ELSE 1 END AS HasLogo, v.PolicySource, v.NDEnabled, v.NDStartTime, v.NDEndTime FROM site s INNER JOIN client c ON c.ClientID = s.ClientID LEFT JOIN vw_effective_site_policy v ON v.SiteID = s.SiteID ORDER BY c.ClientName, s.SiteName`, lookups: activeClients },
  'site-policy': { table: 'site_policy', id: 'SitePolicyID', fields: ['SiteID', ...sitePolicyFields], listSql: 'SELECT sp.*, s.SiteName, c.ClientName FROM site_policy sp INNER JOIN site s ON s.SiteID = sp.SiteID INNER JOIN client c ON c.ClientID = s.ClientID ORDER BY c.ClientName, s.SiteName', lookups: activeSites },
  'site-shift': { table: 'site_shift', id: 'SiteShiftID', fields: ['SiteID', 'ShiftCodeID', 'NDPolicyOverride', 'Status'], listSql: `SELECT ss.SiteShiftID, ss.SiteID, s.SiteName, ss.ShiftCodeID, sc.ShiftCode, sc.ShiftName, ss.NDPolicyOverride, ss.Status, CASE ss.NDPolicyOverride WHEN 'Enabled' THEN 1 WHEN 'Disabled' THEN 0 ELSE COALESCE(v.NDEnabled, 0) END AS EffectiveNDEnabled, v.PolicySource FROM site_shift ss INNER JOIN site s ON s.SiteID = ss.SiteID INNER JOIN shift_code sc ON sc.ShiftCodeID = ss.ShiftCodeID LEFT JOIN vw_effective_site_policy v ON v.SiteID = ss.SiteID ORDER BY s.SiteName, sc.ShiftCode`, lookups: async () => ({ ...(await activeSites()), ...(await activeShiftCodes()) }) },
  'shift-code': { table: 'shift_code', id: 'ShiftCodeID', fields: ['AgencyID', 'ShiftCode', 'ShiftName', 'ShiftType', 'TimeIn', 'TimeOut', 'RegularHours', 'RegularOTCap', 'WorkdayCount', 'NDEnabled', 'NDStartTime', 'NDEndTime', 'Status'], listSql: 'SELECT sc.ShiftCodeID, sc.AgencyID, a.AgencyName, sc.ShiftCode, sc.ShiftName, sc.ShiftType, sc.TimeIn, sc.TimeOut, sc.RegularHours, sc.RegularOTCap, sc.WorkdayCount, sc.NDEnabled, sc.NDStartTime, sc.NDEndTime, sc.Status, sc.CreatedAt FROM shift_code sc INNER JOIN agency a ON a.AgencyID = sc.AgencyID ORDER BY a.AgencyName, sc.ShiftCode, sc.ShiftName', lookups: activeAgencies }
}

function resource(event: any): Resource {
  const value = getRouterParam(event, 'resource') as Resource
  if (!Object.hasOwn(configs, value)) throw createError({ statusCode: 404, statusMessage: 'Organization resource not found.' })
  return value
}

function normalizeValue(field: string, value: unknown) {
  if (field === 'Status') {
    if (value === undefined || value === null || value === '') return 'Active'
    if (value === 'Active' || value === 'Inactive') return value
    throw createError({ statusCode: 400, statusMessage: 'Status must be Active or Inactive.' })
  }
  if (booleanFields.has(field)) return value === true || value === 1 || value === '1' ? 1 : 0
  if (field === 'WorkdayCount') {
    const count = Number(value === '' || value === undefined || value === null ? 1 : value)
    if (!Number.isInteger(count) || count < 1 || count > 31) throw createError({ statusCode: 400, statusMessage: 'Workday count must be a whole number from 1 to 31.' })
    return count
  }
  if (numberFields.has(field)) {
    const number = Number(value)
    if (!Number.isInteger(number) || number <= 0) throw createError({ statusCode: 400, statusMessage: `${field} must be a valid ID.` })
    return number
  }
  if (typeof value === 'string') return value.trim() || null
  return value ?? null
}

function valuesFor(config: Config, body: Record<string, unknown>) {
  return config.fields.map((field) => normalizeValue(field, body[field]))
}

type LogoValue = { data: Buffer; mimeType: string } | null | undefined

function logoValue(body: Record<string, unknown>) : LogoValue {
  if (!Object.hasOwn(body, 'LogoData') || body.LogoData === '') return undefined
  if (body.LogoData === null) return null
  if (typeof body.LogoData !== 'string') throw createError({ statusCode: 400, statusMessage: 'Logo must be an image file.' })

  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(body.LogoData)
  if (!match) throw createError({ statusCode: 400, statusMessage: 'Use a PNG, JPG, or WEBP image for the logo.' })

  const data = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (!data.length || data.length > 2 * 1024 * 1024) {
    throw createError({ statusCode: 400, statusMessage: 'Logo image must be no larger than 2 MB.' })
  }
  return { data, mimeType: match[1].toLowerCase() }
}

function supportsLogo(resourceName: Resource) {
  return resourceName === 'agency' || resourceName === 'site'
}

function validTime(value: unknown) {
  return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(value))
}

function validateShiftCodeValues(values: unknown[]) {
  const [, shiftCode, shiftName, shiftType, timeIn, timeOut, regularHours, regularOTCap, workdayCount, ndEnabled, ndStartTime, ndEndTime] = values
  if (typeof shiftCode !== 'string' || !shiftCode) throw createError({ statusCode: 400, statusMessage: 'Shift code is required.' })
  if (typeof shiftName !== 'string' || !shiftName) throw createError({ statusCode: 400, statusMessage: 'Shift name is required.' })
  if (!['DS', 'NS', 'MS', 'SS', 'Flexible'].includes(String(shiftType))) throw createError({ statusCode: 400, statusMessage: 'Select a valid shift type.' })
  const flexible = String(shiftType) === 'Flexible'
  if (!flexible && (!validTime(timeIn) || !validTime(timeOut))) {
    throw createError({ statusCode: 400, statusMessage: 'Time in and time out must be valid times.' })
  }
  if (flexible && ((timeIn && !validTime(timeIn)) || (timeOut && !validTime(timeOut)) || Boolean(timeIn) !== Boolean(timeOut))) {
    throw createError({ statusCode: 400, statusMessage: 'For a Flexible shift, leave both default times blank or enter both valid times.' })
  }
  for (const [label, value] of [['Regular hours', regularHours], ['Regular OT cap', regularOTCap]] as const) {
    const hours = Number(value)
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) throw createError({ statusCode: 400, statusMessage: `${label} must be between 0 and 24.` })
  }
  if (!Number.isInteger(Number(workdayCount)) || Number(workdayCount) < 1 || Number(workdayCount) > 31) throw createError({ statusCode: 400, statusMessage: 'Workday count must be a whole number from 1 to 31.' })
  if (Number(ndEnabled) && (!validTime(ndStartTime) || !validTime(ndEndTime))) {
    throw createError({ statusCode: 400, statusMessage: 'Set Night Differential start and end times when ND is enabled.' })
  }
  if (!Number(ndEnabled)) {
    values[10] = null
    values[11] = null
  }
}

async function ensureUniqueShiftCode(values: unknown[], id?: number) {
  const [agencyId, shiftCode] = values
  const sql = `SELECT ShiftCodeID FROM shift_code WHERE AgencyID = ? AND ShiftCode = ?${id ? ' AND ShiftCodeID <> ?' : ''} LIMIT 1`
  const [existing] = await pool.execute<any[]>(sql, id ? [agencyId, shiftCode, id] : [agencyId, shiftCode])
  if (existing[0]) throw createError({ statusCode: 409, statusMessage: 'This shift code is already registered under the selected agency.' })
}

export async function listOrganizationResource(event: any) {
  const session = requireSession(event)
  void session.sub
  const config = configs[resource(event)]
  const [items] = await pool.execute<any[]>(config.listSql)
  return { items, ...(config.lookups ? await config.lookups() : {}) }
}

export async function createOrganizationResource(event: any) {
  const session = requireSession(event)
  void session.sub
  const resourceName = resource(event)
  const config = configs[resourceName]
  const body = await readBody<Record<string, unknown>>(event)
  const values = valuesFor(config, body || {})
  if (resourceName === 'shift-code') {
    validateShiftCodeValues(values)
    await ensureUniqueShiftCode(values)
  }
  const logo = supportsLogo(resourceName) ? logoValue(body || {}) : undefined
  const fields = logo && logo !== null ? [...config.fields, 'LogoData', 'LogoMimeType'] : config.fields
  const insertValues = logo && logo !== null ? [...values, logo.data, logo.mimeType] : values
  const [result] = await pool.execute<any>(`INSERT INTO ${config.table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, insertValues)
  return { id: result.insertId }
}

export async function updateOrganizationResource(event: any) {
  const session = requireSession(event)
  void session.sub
  const resourceName = resource(event)
  const config = configs[resourceName]
  const body = await readBody<Record<string, unknown>>(event)
  const id = Number(body?.id)
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'A valid record ID is required.' })
  const values = valuesFor(config, body)
  if (resourceName === 'shift-code') {
    validateShiftCodeValues(values)
    await ensureUniqueShiftCode(values, id)
  }
  const logo = supportsLogo(resourceName) ? logoValue(body) : undefined
  const assignments = config.fields.map((field) => `${field} = ?`)
  const updateValues: unknown[] = [...values]
  if (logo === null) {
    assignments.push('LogoData = NULL', 'LogoMimeType = NULL')
  } else if (logo) {
    assignments.push('LogoData = ?', 'LogoMimeType = ?')
    updateValues.push(logo.data, logo.mimeType)
  }
  const result = await pool.execute<any>(`UPDATE ${config.table} SET ${assignments.join(', ')} WHERE ${config.id} = ?`, [...updateValues, id])
  if (result[0].affectedRows === 0) throw createError({ statusCode: 404, statusMessage: 'Record not found.' })
  return { success: true }
}

export async function getOrganizationLogo(event: any) {
  const session = requireSession(event)
  void session.sub
  const query = getQuery(event)
  const resourceName = String(query.resource || '') as Resource
  if (!supportsLogo(resourceName)) throw createError({ statusCode: 404, statusMessage: 'Logo resource not found.' })

  const id = Number(query.id)
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'A valid record ID is required.' })

  const config = configs[resourceName]
  const [rows] = await pool.execute<any[]>(`SELECT LogoData, LogoMimeType FROM ${config.table} WHERE ${config.id} = ? LIMIT 1`, [id])
  const row = rows[0]
  if (!row?.LogoData) throw createError({ statusCode: 404, statusMessage: 'Logo not found.' })

  setHeader(event, 'Content-Type', row.LogoMimeType || 'application/octet-stream')
  setHeader(event, 'Cache-Control', 'private, no-store')
  return row.LogoData
}

export async function deleteOrganizationResource(event: any) {
  const session = requireSession(event)
  void session.sub
  const resourceName = resource(event)
  const config = configs[resourceName]
  const body = await readBody<{ id?: unknown; permanent?: unknown }>(event)
  const id = Number(body?.id)
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'A valid record ID is required.' })

  if (resourceName === 'shift-code' && body?.permanent === true) {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const [[usage]] = await connection.execute<any[]>('SELECT COUNT(*) AS SiteShiftCount FROM site_shift WHERE ShiftCodeID = ?', [id])
      if (Number(usage.SiteShiftCount) > 0) {
        throw createError({ statusCode: 409, statusMessage: 'This shift code is already linked to a site. Deactivate it instead to preserve deployment history.' })
      }
      const [result] = await connection.execute<any>('DELETE FROM shift_code WHERE ShiftCodeID = ?', [id])
      if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Shift code not found.' })
      await connection.commit()
      return { success: true, deleted: true }
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  const [result] = await pool.execute<any>(`UPDATE ${config.table} SET Status = 'Inactive' WHERE ${config.id} = ?`, [id])
  if (result.affectedRows === 0) throw createError({ statusCode: 404, statusMessage: 'Record not found.' })
  return { success: true }
}
