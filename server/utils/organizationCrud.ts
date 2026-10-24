import { createError, getQuery, getRouterParam, readBody, setHeader } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

type Resource = 'agency' | 'position' | 'agency-position' | 'client' | 'client-policy' | 'site' | 'site-account' | 'site-policy' | 'site-shift' | 'shift-code' | 'region'

type Config = { table: string; id: string; fields: string[]; listSql: string; lookups?: () => Promise<Record<string, unknown>> }

const policyFields = ['NDEnabled', 'NDStartTime', 'NDEndTime', 'AutoBreakEnabled', 'DefaultBreakMinutes', 'GraceMinutes', 'LateAfterMinutes', 'ComputeLate', 'ComputeUndertime', 'ComputeOT', 'ComputeHoliday', 'ComputeRestDay', 'Status']
const sitePolicyFields = ['NDEnabled', 'DayShiftNDEnabled', 'NDStartTime', 'NDEndTime', 'AutoBreakEnabled', 'DefaultBreakMinutes', 'RelieverPositionOverrideEnabled', 'AutoWDOEnabled', 'SundayWDOOTEnabled', 'GraceMinutes', 'LateAfterMinutes', 'ComputeLate', 'ComputeUndertime', 'ComputeOT', 'ComputeHoliday', 'ComputeRestDay', 'Status']
const booleanFields = new Set(['NDEnabled', 'DayShiftNDEnabled', 'AutoBreakEnabled', 'RelieverPositionOverrideEnabled', 'AutoWDOEnabled', 'SundayWDOOTEnabled', 'ComputeLate', 'ComputeUndertime', 'ComputeOT', 'ComputeHoliday', 'ComputeRestDay'])
const numberFields = new Set(['AgencyID', 'PositionID', 'RegionID', 'ClientID', 'SiteID', 'SiteAccountID', 'ShiftCodeID', 'DefaultBreakMinutes', 'GraceMinutes', 'LateAfterMinutes'])

const activeAgencies = async () => { const [rows] = await pool.execute<any[]>('SELECT AgencyID, AgencyName FROM agency WHERE Status = \'Active\' ORDER BY AgencyName'); return { agencies: rows } }
const activePositions = async () => { const [rows] = await pool.execute<any[]>('SELECT PositionID, PositionName FROM `position` WHERE Status = \'Active\' ORDER BY PositionName'); return { positions: rows } }
const activeRegions = async () => { const [rows] = await pool.execute<any[]>('SELECT RegionID, RegionCode, RegionName FROM region WHERE Status = \'Active\' ORDER BY RegionCode'); return { regions: rows } }
const activeClients = async () => { const [rows] = await pool.execute<any[]>('SELECT ClientID, ClientName FROM client WHERE Status = \'Active\' ORDER BY ClientName'); return { clients: rows } }
const siteAccountChoices = async () => { const [rows] = await pool.execute<any[]>('SELECT SiteAccountID,SiteAccountName,Status FROM site_account ORDER BY SiteAccountName'); return { siteAccounts: rows } }
const activeSites = async () => { const [rows] = await pool.execute<any[]>('SELECT s.SiteID, s.SiteName, s.ClientID, s.RegionID, r.RegionName FROM site s LEFT JOIN region r ON r.RegionID = s.RegionID WHERE s.Status = \'Active\' ORDER BY s.SiteName'); return { sites: rows } }
const activeShiftCodes = async () => { const [rows] = await pool.execute<any[]>('SELECT ShiftCodeID, AgencyID, ShiftCode, ShiftName FROM shift_code WHERE Status = \'Active\' ORDER BY ShiftCode, ShiftName'); return { shiftCodes: rows } }

const configs: Record<Resource, Config> = {
  agency: { table: 'agency', id: 'AgencyID', fields: ['AgencyName', 'AgencyAddress', 'AgencyEmail', 'AgencyContact', 'Status'], listSql: 'SELECT AgencyID, AgencyName, AgencyAddress, AgencyEmail, AgencyContact, Status, CreatedAt, CASE WHEN LogoData IS NULL THEN 0 ELSE 1 END AS HasLogo FROM agency ORDER BY AgencyName' },
  position: { table: '`position`', id: 'PositionID', fields: ['PositionName', 'Description', 'Status'], listSql: 'SELECT PositionID, PositionName, Description, Status FROM `position` ORDER BY PositionName' },
  'agency-position': { table: 'agency_position', id: 'AgencyPositionID', fields: ['AgencyID', 'PositionID', 'Status'], listSql: 'SELECT ap.AgencyPositionID, ap.AgencyID, a.AgencyName, ap.PositionID, p.PositionName, ap.Status FROM agency_position ap INNER JOIN agency a ON a.AgencyID = ap.AgencyID INNER JOIN `position` p ON p.PositionID = ap.PositionID ORDER BY a.AgencyName, p.PositionName', lookups: async () => ({ ...(await activeAgencies()), ...(await activePositions()) }) },
  region: { table: 'region', id: 'RegionID', fields: ['RegionCode', 'RegionName', 'Status'], listSql: 'SELECT RegionID, RegionCode, RegionName, Status FROM region ORDER BY RegionCode' },
  client: { table: 'client', id: 'ClientID', fields: ['ClientName', 'ClientAddress', 'ContractStart', 'ContractEnd', 'Status'], listSql: 'SELECT ClientID, ClientName, ClientAddress, ContractStart, ContractEnd, Status FROM client ORDER BY ClientName' },
  'client-policy': { table: 'client_policy', id: 'ClientPolicyID', fields: ['ClientID', ...policyFields], listSql: 'SELECT cp.*, c.ClientName FROM client_policy cp INNER JOIN client c ON c.ClientID = cp.ClientID ORDER BY c.ClientName', lookups: activeClients },
  'site-account': { table: 'site_account', id: 'SiteAccountID', fields: ['SiteAccountName','Status'], listSql: "SELECT sa.SiteAccountID,sa.SiteAccountName,sa.Status,(SELECT COUNT(DISTINCT link.SiteID) FROM site_agency link WHERE link.SiteAccountID=sa.SiteAccountID AND link.Status='Active') AS SiteCount FROM site_account sa ORDER BY sa.SiteAccountName" },
  site: { table: 'site', id: 'SiteID', fields: ['ClientID', 'RegionID', 'SiteName', 'SiteAddress', 'Status'], listSql: `SELECT s.SiteID, s.ClientID, c.ClientName, s.RegionID, r.RegionCode, r.RegionName, s.SiteName, s.SiteAddress, s.Status, CASE WHEN s.LogoData IS NULL THEN 0 ELSE 1 END AS HasLogo, v.PolicySource, v.NDEnabled, v.NDStartTime, v.NDEndTime FROM site s INNER JOIN client c ON c.ClientID = s.ClientID LEFT JOIN region r ON r.RegionID = s.RegionID LEFT JOIN vw_effective_site_policy v ON v.SiteID = s.SiteID ORDER BY c.ClientName, s.SiteName`, lookups: async () => ({ ...(await activeClients()), ...(await activeRegions()), ...(await activeAgencies()), ...(await siteAccountChoices()) }) },
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
  if (field === 'SiteAccountID' && (value === '' || value == null)) return null
  if (field === 'SiteAccountName') {
    if (typeof value !== 'string') throw createError({ statusCode: 400, statusMessage: 'Site Account name is required.' })
    const name = value.trim().replace(/\s+/g,' ')
    if (!name || name.length > 150) throw createError({ statusCode: 400, statusMessage: 'Enter a Site Account name of 1–150 characters.' })
    return name
  }
  if (field === 'RegionCode') {
    const code = String(value ?? '').trim()
    if (!/^\d{2}$/.test(code)) throw createError({ statusCode: 400, statusMessage: 'Region code must be the two-digit PSGC prefix (for example, 01 or 13).' })
    return code
  }
  if (field === 'RegionName') {
    const name = String(value ?? '').trim().toUpperCase()
    if (!name) throw createError({ statusCode: 400, statusMessage: 'Region name is required.' })
    return name
  }
  if (field === 'Status') {
    if (value === undefined || value === null || value === '') return 'Active'
    if (value === 'Active' || value === 'Inactive') return value
    throw createError({ statusCode: 400, statusMessage: 'Status must be Active or Inactive.' })
  }
  if (field === 'AutoWDOEnabled' && value === undefined) return 1
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

function siteAgencyIds(body: Record<string, unknown>) {
  if (!Array.isArray(body.AgencyIDs) || body.AgencyIDs.length !== 1) {
    throw createError({ statusCode: 400, statusMessage: 'Select exactly one agency. Create a separate site record for another agency.' })
  }
  const ids = body.AgencyIDs.map(value => Number(value))
  if (ids.some(id => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw createError({ statusCode: 400, statusMessage: 'Select valid agencies without duplicates.' })
  }
  return ids
}

async function validateSiteAgencies(connection: any, ids: number[]) {
  const [rows] = await connection.execute<any[]>(`SELECT AgencyID FROM agency WHERE AgencyID IN (${ids.map(() => '?').join(', ')}) AND Status = 'Active'`, ids)
  if (rows.length !== ids.length) throw createError({ statusCode: 400, statusMessage: 'Select active agencies for the site.' })
}

async function validateSiteAccount(connection: any, accountId: unknown, currentId?: unknown) {
  if (!accountId) throw createError({ statusCode: 400, statusMessage: 'Select a Site Account. Add it under Organization > Site Accounts first.' })
  const [[account]] = await connection.execute('SELECT SiteAccountID,Status FROM site_account WHERE SiteAccountID=? FOR UPDATE',[accountId])
  if (!account || (account.Status !== 'Active' && Number(accountId) !== Number(currentId))) throw createError({ statusCode: 400, statusMessage: 'Select an active Site Account.' })
}

async function siteAgencyAccounts(connection: any, body: Record<string, any>, ids: number[], siteID?: number) {
  const [existing] = siteID ? await connection.execute<any[]>(
    'SELECT AgencyID,SiteAccountID FROM site_agency WHERE SiteID=? FOR UPDATE', [siteID]
  ) : [[]]
  const current = new Map<number, any>(existing.map((row: any) => [Number(row.AgencyID), row.SiteAccountID]))
  if (!Object.hasOwn(body, 'AgencyAccounts') && !Object.hasOwn(body, 'SiteAccountID') && siteID) {
    // Older coverage-only clients preserve existing mappings, including unassigned links.
    if (ids.some(id => !current.has(id))) throw createError({ statusCode: 400, statusMessage: 'Choose a Site Account for each new agency.' })
    return ids.map(AgencyID => ({ AgencyID, SiteAccountID: current.get(AgencyID) }))
  }
  let accounts = body.AgencyAccounts
  if (!Object.hasOwn(body, 'AgencyAccounts')) {
    if (ids.length !== 1) throw createError({ statusCode: 400, statusMessage: 'Choose a separate Site Account for each assigned agency.' })
    accounts = [{ AgencyID: ids[0], SiteAccountID: body.SiteAccountID }]
  }
  if (!Array.isArray(accounts) || accounts.length !== ids.length) throw createError({ statusCode: 400, statusMessage: 'Choose a Site Account for every assigned agency.' })
  const mapped = accounts.map(row => ({ AgencyID: Number(row?.AgencyID), SiteAccountID: Number(row?.SiteAccountID) }))
  if (new Set(mapped.map(row => row.AgencyID)).size !== ids.length || mapped.some(row => !ids.includes(row.AgencyID) || !Number.isInteger(row.SiteAccountID) || row.SiteAccountID <= 0)) {
    throw createError({ statusCode: 400, statusMessage: 'Choose valid agencies and Site Accounts without duplicates.' })
  }
  for (const row of [...mapped].sort((a,b) => a.SiteAccountID-b.SiteAccountID)) await validateSiteAccount(connection, row.SiteAccountID, current.get(row.AgencyID))
  return mapped
}

function organizationWriteError(error: any, resourceName: Resource) {
  return resourceName === 'site-account' && error?.code === 'ER_DUP_ENTRY'
    ? createError({ statusCode: 409, statusMessage: 'This Site Account name already exists. Edit or reactivate its existing record.' }) : error
}

async function syncSiteAgencies(connection: any, siteID: number, accounts: { AgencyID: number; SiteAccountID: number | null }[]) {
  await connection.execute("UPDATE site_agency SET Status = 'Inactive' WHERE SiteID = ?", [siteID])
  for (const account of accounts) {
    await connection.execute("INSERT INTO site_agency (SiteID, AgencyID, SiteAccountID, Status) VALUES (?, ?, ?, 'Active') ON DUPLICATE KEY UPDATE SiteAccountID=VALUES(SiteAccountID), Status = 'Active'", [siteID, account.AgencyID, account.SiteAccountID])
  }
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
  const resourceName = resource(event)
  const config = configs[resourceName]
  const [items] = await pool.execute<any[]>(config.listSql)
  if (resourceName === 'site') {
    const [links] = await pool.execute<any[]>(`SELECT sa.SiteID, sa.AgencyID, a.AgencyName, sa.SiteAccountID, account.SiteAccountName FROM site_agency sa
      INNER JOIN agency a ON a.AgencyID = sa.AgencyID LEFT JOIN site_account account ON account.SiteAccountID=sa.SiteAccountID WHERE sa.Status = 'Active' ORDER BY a.AgencyName`)
    const bySite = new Map<number, { ids: number[]; names: string[]; accounts: any[] }>()
    for (const link of links) {
      const record = bySite.get(Number(link.SiteID)) || { ids: [], names: [], accounts: [] }
      record.ids.push(Number(link.AgencyID))
      record.names.push(String(link.AgencyName))
      record.accounts.push({ AgencyID: Number(link.AgencyID), AgencyName: link.AgencyName, SiteAccountID: link.SiteAccountID, SiteAccountName: link.SiteAccountName })
      bySite.set(Number(link.SiteID), record)
    }
    for (const item of items) {
      const agencies = bySite.get(Number(item.SiteID))
      item.AgencyIDs = agencies?.ids || []
      item.AgencyNames = agencies?.names.join(', ') || ''
      item.AgencyAccounts = agencies?.accounts || []
    }
  }
  return { items, canEdit: session.userType !== 'Viewer' && event.context?.moduleCanEdit !== false, ...(config.lookups ? await config.lookups() : {}) }
}

export async function createOrganizationResource(event: any) {
  const session = requireSession(event)
  if (session.userType === 'Viewer' || event.context?.moduleCanEdit === false) throw createError({ statusCode: 403, statusMessage: 'Organization edit access is required.' })
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
  if (resourceName === 'site') {
    const ids = siteAgencyIds(body || {})
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      await validateSiteAgencies(connection, ids)
      const accounts = await siteAgencyAccounts(connection, body, ids)
      const [result] = await connection.execute<any>(`INSERT INTO site (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, insertValues)
      await syncSiteAgencies(connection, Number(result.insertId), accounts)
      await connection.commit()
      return { id: result.insertId }
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  }
  const [result] = await pool.execute<any>(`INSERT INTO ${config.table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, insertValues).catch(error => { throw organizationWriteError(error,resourceName) })
  return { id: result.insertId }
}

export async function updateOrganizationResource(event: any) {
  const session = requireSession(event)
  if (session.userType === 'Viewer' || event.context?.moduleCanEdit === false) throw createError({ statusCode: 403, statusMessage: 'Organization edit access is required.' })
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
  if (resourceName === 'site') {
    const ids = siteAgencyIds(body)
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      await validateSiteAgencies(connection, ids)
      const [siteRows] = await connection.execute<any[]>('SELECT SiteID FROM site WHERE SiteID = ? LIMIT 1 FOR UPDATE', [id])
      if (!siteRows[0]) throw createError({ statusCode: 404, statusMessage: 'Site not found.' })
      const [owners] = await connection.execute<any[]>('SELECT AgencyID FROM site_agency WHERE SiteID=? FOR UPDATE', [id])
      if (owners.length > 1 || (owners.length === 1 && Number(owners[0].AgencyID) !== ids[0])) throw createError({ statusCode: 409, statusMessage: 'This site belongs to its saved agency. Create a separate site for another agency.' })
      const accounts = await siteAgencyAccounts(connection, body, ids, id)
      const [linkedRates] = await connection.execute<any[]>(`SELECT DISTINCT ap.AgencyID, a.AgencyName FROM site_rate sr
        INNER JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
        INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
        INNER JOIN agency a ON a.AgencyID = ap.AgencyID
        WHERE sr.SiteID = ? AND sr.Status = 'Active'`, [id])
      const removedLinkedAgency = linkedRates.find(link => !ids.includes(Number(link.AgencyID)))
      if (removedLinkedAgency) throw createError({ statusCode: 409, statusMessage: `${removedLinkedAgency.AgencyName} still has an active site rate. Deactivate that link before removing this agency.` })
      const [result] = await connection.execute<any>(`UPDATE site SET ${assignments.join(', ')} WHERE SiteID = ?`, [...updateValues, id])
      if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Site not found.' })
      await syncSiteAgencies(connection, id, accounts)
      await connection.commit()
      return { success: true }
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  }
  const result = await pool.execute<any>(`UPDATE ${config.table} SET ${assignments.join(', ')} WHERE ${config.id} = ?`, [...updateValues, id]).catch(error => { throw organizationWriteError(error,resourceName) })
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
  if (session.userType === 'Viewer' || event.context?.moduleCanEdit === false) throw createError({ statusCode: 403, statusMessage: 'Organization edit access is required.' })
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
