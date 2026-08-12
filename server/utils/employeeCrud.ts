import { createError, getQuery, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

type EmployeeSection = 'profile' | 'government' | 'education' | 'license' | 'training' | 'clearance' | 'bank' | 'insurance'

type SectionConfig = {
  table: string
  id: string
  fields: string[]
  label: string
  single?: boolean
}

const quotedPosition = "`position`"
const positionJoin = `INNER JOIN ${quotedPosition} p ON p.PositionID = ap.PositionID`
const employeeFields = ['AgencyPositionID', 'EmployeeNumber', 'FirstName', 'MiddleName', 'LastName', 'Nickname', 'Birthday', 'Gender', 'CivilStatus', 'Address', 'Email', 'ContactNumber', 'DateHired', 'Status']

const sectionConfigs: Record<EmployeeSection, SectionConfig> = {
  profile: { table: 'employee_profile', id: 'ProfileID', label: 'Profile', single: true, fields: ['EmployeeID', 'Height', 'Weight', 'PostalCode', 'PaymentMethod', 'EntryDate'] },
  government: { table: 'government', id: 'GovernmentID', label: 'Government', fields: ['EmployeeID', 'GovernmentType', 'GovernmentNumber'] },
  education: { table: 'education', id: 'EducationID', label: 'Education', fields: ['EmployeeID', 'EducationLevel', 'School', 'Course', 'YearGraduated', 'Attachment'] },
  license: { table: 'license', id: 'LicenseID', label: 'License', fields: ['EmployeeID', 'LicenseName', 'LicenseNumber', 'IssuedDate', 'ExpiryDate', 'Attachment'] },
  training: { table: 'training', id: 'TrainingID', label: 'Training', fields: ['EmployeeID', 'TrainingName', 'TrainingType', 'TrainingSchool', 'CompletedDate', 'Attachment'] },
  clearance: { table: 'clearance', id: 'ClearanceID', label: 'Clearance', fields: ['EmployeeID', 'ClearanceName', 'IssuedDate', 'ExpiryDate', 'Attachment'] },
  bank: { table: 'bank', id: 'BankID', label: 'Bank', fields: ['EmployeeID', 'BankName', 'AccountNumber', 'AccountType', 'Status'] },
  insurance: { table: 'insurance', id: 'InsuranceID', label: 'Insurance', fields: ['EmployeeID', 'Beneficiary', 'Relationship', 'ContactNumber'] }
}

const activeAgencies = async () => {
  const [rows] = await pool.execute<any[]>('SELECT AgencyID, AgencyName FROM agency WHERE Status = \'Active\' ORDER BY AgencyName')
  return rows
}

const activePositions = async () => {
  const [rows] = await pool.execute<any[]>('SELECT PositionID, PositionName FROM `position` WHERE Status = \'Active\' ORDER BY PositionName')
  return rows
}

const activeAgencyPositions = async () => {
  const [rows] = await pool.execute<any[]>(
    [
      'SELECT ap.AgencyPositionID, ap.AgencyID, a.AgencyName, ap.PositionID, p.PositionName',
      'FROM agency_position ap',
      'INNER JOIN agency a ON a.AgencyID = ap.AgencyID',
      positionJoin,
      "WHERE ap.Status = 'Active' AND a.Status = 'Active' AND p.Status = 'Active'",
      'ORDER BY a.AgencyName, p.PositionName'
    ].join('\n')
  )
  return rows
}

const activeEmployees = async () => {
  const [rows] = await pool.execute<any[]>(
    `SELECT e.EmployeeID, e.EmployeeNumber, CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) AS EmployeeName
     FROM employee e
     WHERE e.Status = 'Active'
     ORDER BY e.LastName, e.FirstName, e.EmployeeNumber`
  )
  return rows
}

function parseDate(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return null
  return value.slice(0, 10)
}

function parseNumber(value: unknown, field: string) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) throw createError({ statusCode: 400, statusMessage: `${field} must be numeric.` })
  return number
}

function parseInteger(value: unknown, field: string, optional = false) {
  if (value === null || value === undefined || value === '') {
    if (optional) return null
    throw createError({ statusCode: 400, statusMessage: `${field} is required.` })
  }
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw createError({ statusCode: 400, statusMessage: `${field} must be a valid ID.` })
  return number
}

function parseText(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function parseStatus(value: unknown, fallback = 'Active') {
  if (value === null || value === undefined || value === '') return fallback
  if (value === 'Active' || value === 'Inactive') return value
  throw createError({ statusCode: 400, statusMessage: 'Status must be Active or Inactive.' })
}

function employeeValues(body: Record<string, unknown>) {
  return [
    parseInteger(body.AgencyPositionID, 'AgencyPositionID'),
    parseText(body.EmployeeNumber),
    parseText(body.FirstName),
    parseText(body.MiddleName),
    parseText(body.LastName),
    parseText(body.Nickname),
    parseDate(body.Birthday),
    parseText(body.Gender),
    parseText(body.CivilStatus),
    parseText(body.Address),
    parseText(body.Email),
    parseText(body.ContactNumber),
    parseDate(body.DateHired),
    parseStatus(body.Status)
  ]
}

function sectionConfig(section: string) {
  const config = sectionConfigs[section as EmployeeSection]
  if (!config) throw createError({ statusCode: 404, statusMessage: 'Employee section not found.' })
  return config
}

function sectionValues(config: SectionConfig, body: Record<string, unknown>, employeeId: number) {
  return config.fields.map((field) => {
    if (field === 'EmployeeID') return employeeId
    if (field === 'Height' || field === 'Weight') return parseNumber(body[field], field)
    if (field === 'YearGraduated') return body[field] ? Number(body[field]) : null
    if (field === 'IssuedDate' || field === 'ExpiryDate' || field === 'CompletedDate' || field === 'EntryDate') return parseDate(body[field])
    if (field === 'Status') return parseStatus(body[field])
    return parseText(body[field])
  })
}

function latestDeploymentJoin() {
  return `
    LEFT JOIN (
      SELECT * FROM (
        SELECT ed.*, ROW_NUMBER() OVER (PARTITION BY ed.EmployeeID ORDER BY ed.StartDate DESC, ed.DeploymentID DESC) AS rn
        FROM employee_deployment ed
        WHERE ed.EndDate IS NULL OR ed.EndDate >= CURDATE()
      ) ranked
      WHERE ranked.rn = 1
    ) ld ON ld.EmployeeID = e.EmployeeID
  `
}

function employeeListSql(filters: string[]) {
  return [
    'SELECT',
    '  e.EmployeeID, e.AgencyPositionID, e.EmployeeNumber, e.FirstName, e.MiddleName, e.LastName, e.Nickname, e.Birthday,',
    '  e.Gender, e.CivilStatus, e.Address, e.Email, e.ContactNumber, e.DateHired, e.Status,',
    '  ap.AgencyID, a.AgencyName, ap.PositionID, p.PositionName,',
    '  ld.DeploymentID AS CurrentDeploymentID,',
    '  ld.DeploymentType AS CurrentDeploymentType,',
    '  ld.StartDate AS CurrentDeploymentStartDate,',
    '  ld.EndDate AS CurrentDeploymentEndDate,',
    "  CASE WHEN ld.DeploymentID IS NULL THEN 'Unassigned' WHEN ld.EndDate IS NULL OR ld.EndDate >= CURDATE() THEN 'Active' ELSE 'Inactive' END AS DeploymentStatus,",
    '  ld.ClientRateID,',
    '  c.ClientName,',
    '  s.SiteName,',
    '  sc.ShiftCode,',
    '  sc.ShiftName',
    'FROM employee e',
    'INNER JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID',
    'INNER JOIN agency a ON a.AgencyID = ap.AgencyID',
    positionJoin,
    latestDeploymentJoin(),
    'LEFT JOIN client_rate cr ON cr.ClientRateID = ld.ClientRateID',
    'LEFT JOIN client c ON c.ClientID = cr.ClientID',
    'LEFT JOIN site s ON s.SiteID = ld.SiteID',
    'LEFT JOIN site_shift ss ON ss.SiteShiftID = ld.SiteShiftID',
    'LEFT JOIN shift_code sc ON sc.ShiftCodeID = ss.ShiftCodeID',
    filters.length ? `WHERE ${filters.join(' AND ')}` : '',
    'ORDER BY e.LastName, e.FirstName, e.EmployeeNumber'
  ].filter(Boolean).join('\n')
}

async function employeeById(employeeId: number) {
  const [rows] = await pool.execute<any[]>(
    [
      'SELECT e.*, ap.AgencyID, a.AgencyName, ap.PositionID, p.PositionName',
      'FROM employee e',
      'INNER JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID',
      'INNER JOIN agency a ON a.AgencyID = ap.AgencyID',
      positionJoin,
      'WHERE e.EmployeeID = ? LIMIT 1'
    ].join('\n'),
    [employeeId] as any[]
  )
  return rows[0] || null
}

async function sectionRows(employeeId: number) {
  const entries = await Promise.all(
    Object.entries(sectionConfigs).map(async ([section, config]) => {
      const [rows] = await pool.execute<any[]>(`SELECT * FROM ${config.table} WHERE EmployeeID = ? ORDER BY ${config.id} DESC`, [employeeId])
      return [section, config.single ? (rows[0] || null) : rows] as const
    })
  )
  return Object.fromEntries(entries)
}

async function lookupBundles() {
  const [agencies, positions, agencyPositions, employees] = await Promise.all([activeAgencies(), activePositions(), activeAgencyPositions(), activeEmployees()])
  return { agencies, positions, agencyPositions, employees }
}

function employeeIdFromQuery(event: any) {
  const query = getQuery(event) as Record<string, string | undefined>
  const employeeId = query.employeeId ? Number(query.employeeId) : NaN
  if (!Number.isInteger(employeeId) || employeeId <= 0) throw createError({ statusCode: 400, statusMessage: 'Employee ID is required.' })
  return employeeId
}

async function activeClientRates() {
  const [rows] = await pool.execute<any[]>(
    [
      'SELECT cr.ClientRateID, cr.ClientID, c.ClientName, pr.AgencyPositionID, a.AgencyName, p.PositionName, cr.Status, pr.RegionID, rg.RegionName',
      'FROM client_rate cr',
      'INNER JOIN client c ON c.ClientID = cr.ClientID',
      'INNER JOIN payroll_rate pr ON pr.PayrollRateID = cr.PayrollRateID',
      'INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID',
      'INNER JOIN agency a ON a.AgencyID = ap.AgencyID',
      positionJoin,
      'LEFT JOIN region rg ON rg.RegionID = pr.RegionID',
      "WHERE cr.Status = 'Active' AND pr.Status = 'Active'",
      'ORDER BY c.ClientName, a.AgencyName, p.PositionName'
    ].join('\n')
  )
  return rows
}

async function deploymentLookups() {
  const [clientRates, employees, sites, shiftCodes] = await Promise.all([
    activeClientRates(),
    activeEmployees(),
    pool.execute<any[]>('SELECT s.SiteID, s.ClientID, c.ClientName, s.SiteName FROM site s INNER JOIN client c ON c.ClientID = s.ClientID WHERE s.Status = \'Active\' AND c.Status = \'Active\' ORDER BY c.ClientName, s.SiteName').then(([rows]) => rows),
    pool.execute<any[]>('SELECT ShiftCodeID, ShiftCode, ShiftName FROM shift_code WHERE Status = \'Active\' ORDER BY ShiftCode, ShiftName').then(([rows]) => rows)
  ])
  return { clientRates, employees, sites, shiftCodes }
}

function deploymentSql(filters: string[]) {
  return [
    'SELECT',
    '  ed.DeploymentID, ed.EmployeeID, e.EmployeeNumber,',
    "  CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) AS EmployeeName,",
    '  a.AgencyName, p.PositionName, c.ClientName, s.SiteName,',
    '  sc.ShiftCode, sc.ShiftName,',
    '  ed.DeploymentType, ed.StartDate, ed.EndDate,',
    "  CASE WHEN ed.EndDate IS NULL OR ed.EndDate >= CURDATE() THEN 'Active' ELSE 'Ended' END AS Status,",
    '  ed.ClientRateID, ed.SiteID, ed.SiteShiftID, ed.Remarks, ed.CreatedAt,',
    '  ap.AgencyPositionID, ap.AgencyID, ap.PositionID',
    'FROM employee_deployment ed',
    'INNER JOIN employee e ON e.EmployeeID = ed.EmployeeID',
    'INNER JOIN client_rate cr ON cr.ClientRateID = ed.ClientRateID',
    'INNER JOIN payroll_rate pr ON pr.PayrollRateID = cr.PayrollRateID',
    'INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID',
    'INNER JOIN agency a ON a.AgencyID = ap.AgencyID',
    positionJoin,
    'INNER JOIN site s ON s.SiteID = ed.SiteID',
    'INNER JOIN site_shift ss ON ss.SiteShiftID = ed.SiteShiftID',
    'INNER JOIN shift_code sc ON sc.ShiftCodeID = ss.ShiftCodeID',
    'INNER JOIN client c ON c.ClientID = cr.ClientID',
    filters.length ? `WHERE ${filters.join(' AND ')}` : '',
    'ORDER BY ed.StartDate DESC, ed.DeploymentID DESC'
  ].filter(Boolean).join('\n')
}

export async function listEmployees(event: any) {
  const session = requireSession(event)
  void session.sub
  const query = getQuery(event) as Record<string, string | undefined>
  const filters: string[] = []
  const values: any[] = []

  if (query.agencyId) {
    const agencyId = parseInteger(query.agencyId, 'agencyId')
    filters.push('ap.AgencyID = ?')
    values.push(agencyId)
  }

  if (query.positionId) {
    const positionId = parseInteger(query.positionId, 'positionId')
    filters.push('ap.PositionID = ?')
    values.push(positionId)
  }

  const [items, lookups] = await Promise.all([pool.execute<any[]>(employeeListSql(filters), values), lookupBundles()])
  return { items: items[0], ...lookups }
}

export async function createEmployee(event: any) {
  const session = requireSession(event)
  const body = await readBody<Record<string, unknown>>(event) || {}
  const values = employeeValues(body)
  if (!values[0] || !values[1] || !values[2] || !values[4]) throw createError({ statusCode: 400, statusMessage: 'Agency position, employee number, first name, and last name are required.' })
  const [result] = await pool.execute<any>(`INSERT INTO employee (${employeeFields.join(', ')}, CreatedBy) VALUES (${employeeFields.map(() => '?').join(', ')}, ?)`, [...values, session.sub] as any[])
  return { id: result.insertId }
}

export async function updateEmployee(event: any) {
  const session = requireSession(event)
  const body = await readBody<Record<string, unknown>>(event) || {}
  const employeeId = parseInteger(body.id, 'id') as number
  const [result] = await pool.execute<any>(`UPDATE employee SET ${employeeFields.map((field) => `${field} = ?`).join(', ')}, UpdatedBy = ? WHERE EmployeeID = ?`, [...employeeValues(body), session.sub, employeeId] as any[])
  if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Employee not found.' })
  return { success: true }
}

export async function deleteEmployee(event: any) {
  const session = requireSession(event)
  void session.sub
  const body = await readBody<{ id?: unknown }>(event)
  const employeeId = parseInteger(body?.id, 'id')
  const [result] = await pool.execute<any>('UPDATE employee SET Status = \'Inactive\' WHERE EmployeeID = ?', [employeeId])
  if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Employee not found.' })
  return { success: true }
}

export async function getEmployeeDocuments(event: any) {
  const session = requireSession(event)
  void session.sub
  const employees = await activeEmployees()
  const query = getQuery(event) as Record<string, string | undefined>
  const employeeId = query.employeeId ? Number(query.employeeId) : Number(employees[0]?.EmployeeID || 0)
  if (!employeeId) return { employees, employee: null, profile: null, government: [], education: [], license: [], training: [], clearance: [], bank: [], insurance: [] }
  const [employee, sections, lookups] = await Promise.all([employeeById(employeeId), sectionRows(employeeId), lookupBundles()])
  if (!employee) throw createError({ statusCode: 404, statusMessage: 'Employee not found.' })
  return { employee, employees, ...sections, ...lookups }
}

export async function saveEmployeeSection(event: any, mode: 'create' | 'update' | 'delete') {
  const session = requireSession(event)
  void session.sub
  const body = await readBody<Record<string, unknown>>(event) || {}
  const config = sectionConfig(String(body.section || ''))
  const employeeId = parseInteger(body.employeeId ?? body.EmployeeID, 'employeeId')

  if (mode === 'delete') {
    const id = parseInteger(body.id, 'id') as number
    const [result] = await pool.execute<any>(`DELETE FROM ${config.table} WHERE ${config.id} = ? AND EmployeeID = ?`, [id, employeeId] as any[])
    if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: `${config.label} record not found.` })
    return { success: true }
  }

  if (mode === 'create' && config.single) {
    const [existing] = await pool.execute<any[]>(`SELECT ${config.id} FROM ${config.table} WHERE EmployeeID = ? LIMIT 1`, [employeeId] as any[])
    if (existing[0]) {
      const values = sectionValues(config, body, employeeId as number).slice(1)
      const updateFields = config.fields.filter((field) => field !== 'EmployeeID')
      await pool.execute(`UPDATE ${config.table} SET ${updateFields.map((field) => `${field} = ?`).join(', ')} WHERE ${config.id} = ?`, [...values, existing[0][config.id]] as any[])
      return { success: true, id: existing[0][config.id] }
    }
  }

  if (mode === 'update') {
    const id = parseInteger(body.id, 'id') as number
    const values = sectionValues(config, body, employeeId as number).slice(1)
    const updateFields = config.fields.filter((field) => field !== 'EmployeeID')
    const [result] = await pool.execute<any>(`UPDATE ${config.table} SET ${updateFields.map((field) => `${field} = ?`).join(', ')} WHERE ${config.id} = ? AND EmployeeID = ?`, [...values, id, employeeId] as any[])
    if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: `${config.label} record not found.` })
    return { success: true }
  }

  const values = sectionValues(config, body, employeeId as number)
  const [result] = await pool.execute<any>(`INSERT INTO ${config.table} (${config.fields.join(', ')}) VALUES (${config.fields.map(() => '?').join(', ')})`, values as any[])
  return { success: true, id: result.insertId }
}

export async function listDeployments(event: any) {
  const session = requireSession(event)
  void session.sub
  const [items, lookups] = await Promise.all([pool.execute<any[]>(deploymentSql([])), deploymentLookups()])
  return { items: items[0], ...lookups }
}

export async function createDeployment(event: any) {
  const session = requireSession(event)
  const body = await readBody<Record<string, unknown>>(event) || {}
  const employeeId = parseInteger(body.EmployeeID, 'EmployeeID')
  const clientRateID = parseInteger(body.ClientRateID, 'ClientRateID')
  const siteID = parseInteger(body.SiteID, 'SiteID')
  const siteShiftID = parseInteger(body.SiteShiftID, 'SiteShiftID')
  const deploymentType = parseText(body.DeploymentType) || 'Regular'
  const startDate = parseDate(body.StartDate)
  if (!startDate) throw createError({ statusCode: 400, statusMessage: 'StartDate is required.' })
  const endDate = parseDate(body.EndDate)
  const remarks = parseText(body.Remarks)

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[activeRow]] = await connection.execute<any[]>(
      `SELECT DeploymentID, StartDate FROM employee_deployment WHERE EmployeeID = ? AND (EndDate IS NULL OR EndDate >= CURDATE()) ORDER BY StartDate DESC, DeploymentID DESC LIMIT 1 FOR UPDATE`,
      [employeeId]
    )
    if (activeRow?.DeploymentID) {
      await connection.execute('UPDATE employee_deployment SET EndDate = DATE_SUB(?, INTERVAL 1 DAY) WHERE DeploymentID = ?', [startDate, activeRow.DeploymentID])
    }

    const [result] = await connection.execute<any>(
      `INSERT INTO employee_deployment (EmployeeID, ClientRateID, SiteID, SiteShiftID, DeploymentType, StartDate, EndDate, Remarks, CreatedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [employeeId, clientRateID, siteID, siteShiftID, deploymentType, startDate, endDate, remarks, session.sub] as any[]
    )
    await connection.commit()
    return { success: true, id: result.insertId }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
