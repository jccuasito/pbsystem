import { createError, getQuery, getRouterParam, readBody } from 'h3'
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { alertMessages, DEPLOYMENT_ALREADY_EXISTS, EMPLOYEE_DUPLICATE, EMPLOYEE_SIMILAR } from '../../components/alertmessage/messages'

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
const employeeFields = [
  'AgencyPositionID', 'EmployeeNumber', 'FirstName', 'MiddleName', 'LastName', 'Nickname', 'Birthday', 'Gender', 'CivilStatus', 'Address', 'Email', 'ContactNumber', 'DateHired', 'Status',
  'PermanentUnitHouseNumber', 'PermanentProvince', 'PermanentStreet', 'PermanentCityMunicipality', 'PermanentSubdivision', 'PermanentBarangay', 'PermanentRegion', 'PermanentPostalCode',
  'PresentUnitHouseNumber', 'PresentProvince', 'PresentStreet', 'PresentCityMunicipality', 'PresentSubdivision', 'PresentBarangay', 'PresentRegion', 'PresentPostalCode',
  'BeneficiaryNotApplicable', 'Beneficiary1', 'Beneficiary1Relationship', 'Beneficiary2', 'Beneficiary2Relationship', 'Beneficiaries',
  'EmergencyName', 'EmergencyRelationship', 'EmergencyAddress', 'EmergencyContactNo'
]
const employeePhotoTypes: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const employeePhotoMaxBytes = 2 * 1024 * 1024
const employeeGenderOptions = ['Male', 'Female', 'Non-binary', 'Prefer not to say'] as const
const employeeCivilStatusOptions = ['Single', 'Married', 'Widowed', 'Separated', 'Divorced', 'Annulled'] as const

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
    [
      'SELECT e.EmployeeID, e.EmployeeNumber, CONCAT_WS(\' \', e.FirstName, e.MiddleName, e.LastName) AS EmployeeName,',
      '  e.AgencyPositionID, ap.AgencyID, a.AgencyName, ap.PositionID, p.PositionName',
      'FROM employee e',
      'INNER JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID',
      'INNER JOIN agency a ON a.AgencyID = ap.AgencyID',
      positionJoin,
      "WHERE e.Status = 'Active'",
      'ORDER BY e.LastName, e.FirstName, e.EmployeeNumber'
    ].join('\n')
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

function parseUppercaseText(value: unknown) {
  const parsed = parseText(value)
  return typeof parsed === 'string' ? parsed.toLocaleUpperCase() : parsed
}

function parseEmployeeChoice(value: unknown, field: string, options: readonly string[]) {
  const parsed = parseText(value)
  if (parsed === null) return null
  const match = options.find(option => option.toLocaleLowerCase() === String(parsed).toLocaleLowerCase())
  if (!match) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be one of: ${options.join(', ')}.` })
  }
  return match
}

function parseEmail(value: unknown) {
  const parsed = parseText(value)
  if (parsed === null) return null
  if (typeof parsed !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed)) {
    throw createError({ statusCode: 400, statusMessage: 'Email must be a complete address such as name@gmail.com.' })
  }
  return parsed.toLocaleLowerCase()
}

function parseContactNumber(value: unknown) {
  const parsed = parseText(value)
  if (parsed === null) return null
  if (typeof parsed !== 'string' || !/^\d{11}$/.test(parsed)) {
    throw createError({ statusCode: 400, statusMessage: 'Contact number must contain exactly 11 digits.' })
  }
  return parsed
}

function parseEmergencyContactNumber(value: unknown) {
  const parsed = parseText(value)
  if (parsed === null) return null
  if (typeof parsed !== 'string' || !/^\d{7,15}$/.test(parsed)) {
    throw createError({ statusCode: 400, statusMessage: 'Emergency contact number must contain 7 to 15 digits.' })
  }
  return parsed
}

function parseBooleanFlag(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0
}

type EmployeeBeneficiary = { Name: string; Relationship: string }

function parseBeneficiaries(body: Record<string, unknown>) {
  if (parseBooleanFlag(body.BeneficiaryNotApplicable)) return [] as EmployeeBeneficiary[]
  let source: unknown = body.Beneficiaries
  if (typeof source === 'string') {
    try { source = JSON.parse(source) } catch { source = [] }
  }
  if (!Array.isArray(source)) {
    source = [
      { Name: body.Beneficiary1, Relationship: body.Beneficiary1Relationship },
      { Name: body.Beneficiary2, Relationship: body.Beneficiary2Relationship },
    ]
  }
  return source
    .map((entry: any) => ({
      Name: String(parseUppercaseText(entry?.Name) || ''),
      Relationship: String(parseText(entry?.Relationship) || ''),
    }))
    .filter(entry => entry.Name || entry.Relationship)
}

function validateEmployeeCompleteness(body: Record<string, unknown>) {
  const required: Array<[string, string]> = [
    ['AgencyPositionID', 'Agency position'], ['FirstName', 'First name'], ['LastName', 'Last name'],
    ['Birthday', 'Birthday'], ['DateHired', 'Date hired'], ['Gender', 'Gender'], ['CivilStatus', 'Civil status'],
    ['Email', 'Email'], ['ContactNumber', 'Contact number'],
  ]
  const missing = required.filter(([key]) => !String(body[key] ?? '').trim()).map(([, label]) => label)
  const beneficiaries = parseBeneficiaries(body)
  if (!parseBooleanFlag(body.BeneficiaryNotApplicable)) {
    beneficiaries.forEach((entry, index) => {
      if (!entry.Name) missing.push(`Beneficiary ${index + 1} name`)
      if (!entry.Relationship) missing.push(`Beneficiary ${index + 1} relationship`)
    })
  }
  if (missing.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `Complete the required employee details before saving: ${missing.join(', ')}.`,
      data: { code: 'EMPLOYEE_INCOMPLETE', fields: missing },
    })
  }
  return beneficiaries
}

function structuredAddress(body: Record<string, unknown>, prefix: 'Permanent' | 'Present') {
  return [
    body[`${prefix}UnitHouseNumber`],
    body[`${prefix}Street`],
    body[`${prefix}Subdivision`],
    body[`${prefix}Barangay`],
    body[`${prefix}CityMunicipality`],
    body[`${prefix}Province`],
    body[`${prefix}Region`],
    body[`${prefix}PostalCode`]
  ].map(parseText).filter(Boolean).join(', ')
}

function parseEmployeePhoto(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw createError({ statusCode: 400, statusMessage: 'Employee photo is invalid.' })
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/)
  if (!match) throw createError({ statusCode: 400, statusMessage: 'Employee photo must be a PNG, JPG, or WEBP image.' })
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > employeePhotoMaxBytes) {
    throw createError({ statusCode: 400, statusMessage: 'Employee photo must be 2MB or smaller.' })
  }
  return { buffer, extension: employeePhotoTypes[match[1]] }
}

function employeePhotoFile(photoPath: unknown) {
  const value = String(photoPath || '')
  if (!/^\/uploads\/employees\/[a-zA-Z0-9._-]+$/.test(value)) return null
  return path.join(process.cwd(), 'public', ...value.split('/').filter(Boolean))
}

async function removeEmployeePhoto(photoPath: unknown) {
  const file = employeePhotoFile(photoPath)
  if (!file) return
  await fs.unlink(file).catch((error: any) => {
    if (error?.code !== 'ENOENT') throw error
  })
}

async function saveEmployeePhoto(employeeId: number, photo: NonNullable<ReturnType<typeof parseEmployeePhoto>>) {
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'employees')
  await fs.mkdir(uploadDir, { recursive: true })
  const filename = `employee-${employeeId}-${crypto.randomBytes(6).toString('hex')}.${photo.extension}`
  const absolutePath = path.join(uploadDir, filename)
  const publicPath = `/uploads/employees/${filename}`
  await fs.writeFile(absolutePath, photo.buffer)
  try {
    await pool.execute('UPDATE employee SET PhotoPath = ? WHERE EmployeeID = ?', [publicPath, employeeId])
    return publicPath
  } catch (error) {
    await fs.unlink(absolutePath).catch(() => undefined)
    throw error
  }
}

function parseStatus(value: unknown, fallback = 'Active') {
  if (value === null || value === undefined || value === '') return fallback
  if (value === 'Active' || value === 'Inactive') return value
  throw createError({ statusCode: 400, statusMessage: 'Status must be Active or Inactive.' })
}

function employeeWriteError(error: any) {
  if (error?.code === 'ER_DUP_ENTRY') {
    const message = String(error?.message || '')
    const field = message.includes('uq_employee_email') ? 'Email address'
      : message.includes('uq_employee_contact_number') ? 'Contact number'
        : 'Employee number'
    return createError({ statusCode: 409, statusMessage: `${field} is already assigned to another employee.` })
  }

  if (error?.code === 'ER_BAD_NULL_ERROR' && String(error?.message || '').includes('EmployeeNumber')) {
    return createError({ statusCode: 400, statusMessage: 'Employee number is optional only after running the employee-number-null migration.' })
  }

  if (error?.code === 'ER_NO_REFERENCED_ROW_2') {
    return createError({ statusCode: 400, statusMessage: 'Selected agency position or user reference does not exist.' })
  }

  return error
}

function employeeValues(body: Record<string, unknown>, beneficiaries = parseBeneficiaries(body)) {
  const permanentAddress = structuredAddress(body, 'Permanent')
  const beneficiaryNotApplicable = parseBooleanFlag(body.BeneficiaryNotApplicable)
  return [
    parseInteger(body.AgencyPositionID, 'AgencyPositionID'),
    parseText(body.EmployeeNumber),
    parseUppercaseText(body.FirstName),
    parseUppercaseText(body.MiddleName),
    parseUppercaseText(body.LastName),
    parseUppercaseText(body.Nickname),
    parseDate(body.Birthday),
    parseEmployeeChoice(body.Gender, 'Gender', employeeGenderOptions),
    parseEmployeeChoice(body.CivilStatus, 'Civil status', employeeCivilStatusOptions),
    parseText(permanentAddress || body.Address),
    parseEmail(body.Email),
    parseContactNumber(body.ContactNumber),
    parseDate(body.DateHired),
    parseStatus(body.Status),
    parseText(body.PermanentUnitHouseNumber),
    parseText(body.PermanentProvince),
    parseText(body.PermanentStreet),
    parseText(body.PermanentCityMunicipality),
    parseText(body.PermanentSubdivision),
    parseText(body.PermanentBarangay),
    parseText(body.PermanentRegion),
    parseText(body.PermanentPostalCode),
    parseText(body.PresentUnitHouseNumber),
    parseText(body.PresentProvince),
    parseText(body.PresentStreet),
    parseText(body.PresentCityMunicipality),
    parseText(body.PresentSubdivision),
    parseText(body.PresentBarangay),
    parseText(body.PresentRegion),
    parseText(body.PresentPostalCode),
    beneficiaryNotApplicable,
    beneficiaryNotApplicable ? null : beneficiaries[0]?.Name || null,
    beneficiaryNotApplicable ? null : beneficiaries[0]?.Relationship || null,
    beneficiaryNotApplicable ? null : beneficiaries[1]?.Name || null,
    beneficiaryNotApplicable ? null : beneficiaries[1]?.Relationship || null,
    JSON.stringify(beneficiaries),
    parseUppercaseText(body.EmergencyName),
    parseText(body.EmergencyRelationship),
    parseText(body.EmergencyAddress),
    parseEmergencyContactNumber(body.EmergencyContactNo)
  ]
}

type EmployeeDuplicateMatch = {
  EmployeeID: number
  EmployeeCode: string
  EmployeeName: string
  AgencyName: string
  PositionName: string
  Status: string
  MatchReasons: string[]
}

function normalizedComparison(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase()
}

function editDistance(left: string, right: string) {
  if (left === right) return 0
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}

function namesLookSimilar(left: string, right: string) {
  if (!left || !right) return false
  const longest = Math.max(left.length, right.length)
  const allowedDistance = longest >= 8 ? 2 : 1
  return editDistance(left, right) <= allowedDistance
}

async function employeeDuplicateReview(body: Record<string, unknown>, excludeEmployeeId?: number | null) {
  const employeeNumber = normalizedComparison(parseText(body.EmployeeNumber))
  const email = normalizedComparison(parseEmail(body.Email))
  const contactNumber = normalizedComparison(parseContactNumber(body.ContactNumber))
  const firstName = normalizedComparison(parseUppercaseText(body.FirstName))
  const middleName = normalizedComparison(parseUppercaseText(body.MiddleName))
  const lastName = normalizedComparison(parseUppercaseText(body.LastName))
  const birthday = parseDate(body.Birthday)
  const clauses: string[] = []
  const values: unknown[] = []

  if (employeeNumber) {
    clauses.push('UPPER(TRIM(COALESCE(e.EmployeeNumber, \'\'))) = ?')
    values.push(employeeNumber)
  }
  if (email) {
    clauses.push('UPPER(TRIM(COALESCE(e.Email, \'\'))) = ?')
    values.push(email)
  }
  if (contactNumber) {
    clauses.push('TRIM(COALESCE(e.ContactNumber, \'\')) = ?')
    values.push(contactNumber)
  }
  if (firstName && lastName) {
    clauses.push('(UPPER(TRIM(COALESCE(e.FirstName, \'\'))) = ? AND UPPER(TRIM(COALESCE(e.LastName, \'\'))) = ?)')
    values.push(firstName, lastName)
    clauses.push('(SOUNDEX(e.FirstName) = SOUNDEX(?) AND SOUNDEX(e.LastName) = SOUNDEX(?))')
    values.push(firstName, lastName)
  }
  if (lastName) {
    clauses.push('UPPER(TRIM(COALESCE(e.LastName, \'\'))) = ?')
    values.push(lastName)
  }
  if (firstName) {
    clauses.push('UPPER(TRIM(COALESCE(e.FirstName, \'\'))) = ?')
    values.push(firstName)
  }
  if (!clauses.length) return { exactMatches: [] as EmployeeDuplicateMatch[], similarMatches: [] as EmployeeDuplicateMatch[] }

  const filters = [`(${clauses.join(' OR ')})`]
  if (excludeEmployeeId) {
    filters.push('e.EmployeeID <> ?')
    values.push(excludeEmployeeId)
  }
  const [rows] = await pool.execute<any[]>(
    [
      'SELECT e.EmployeeID, e.EmployeeNumber, e.FirstName, e.MiddleName, e.LastName,',
      "  DATE_FORMAT(e.Birthday, '%Y-%m-%d') AS Birthday, e.Email, e.ContactNumber, e.Status,",
      '  a.AgencyName, p.PositionName',
      'FROM employee e',
      'INNER JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID',
      'INNER JOIN agency a ON a.AgencyID = ap.AgencyID',
      positionJoin,
      `WHERE ${filters.join(' AND ')}`,
      'ORDER BY e.Status = \'Active\' DESC, e.LastName, e.FirstName, e.EmployeeID'
    ].join('\n'),
    values as any[]
  )

  const exactMatches: EmployeeDuplicateMatch[] = []
  const similarMatches: EmployeeDuplicateMatch[] = []
  for (const row of rows) {
    const rowEmployeeNumber = normalizedComparison(row.EmployeeNumber)
    const rowEmail = normalizedComparison(row.Email)
    const rowContactNumber = normalizedComparison(row.ContactNumber)
    const rowFirstName = normalizedComparison(row.FirstName)
    const rowMiddleName = normalizedComparison(row.MiddleName)
    const rowLastName = normalizedComparison(row.LastName)
    const reasons: string[] = []
    let exact = false

    if (employeeNumber && rowEmployeeNumber === employeeNumber) {
      reasons.push('Same employee number')
      exact = true
    }
    if (email && rowEmail === email) {
      reasons.push('Same email address')
      exact = true
    }
    if (contactNumber && rowContactNumber === contactNumber) {
      reasons.push('Same contact number')
      exact = true
    }
    const sameFullName = rowFirstName === firstName && rowMiddleName === middleName && rowLastName === lastName
    if (sameFullName && birthday && row.Birthday === birthday) {
      reasons.push('Same full name and birthday')
      exact = true
    } else if (rowFirstName === firstName && rowLastName === lastName) {
      reasons.push('Same first and last name')
    } else if (namesLookSimilar(rowFirstName, firstName) && namesLookSimilar(rowLastName, lastName)) {
      reasons.push('Very similar full name')
    } else {
      if (lastName && rowLastName === lastName) reasons.push('Same last name')
      if (firstName && rowFirstName === firstName) reasons.push('Same first name')
    }
    if (!reasons.length) continue

    const match: EmployeeDuplicateMatch = {
      EmployeeID: Number(row.EmployeeID),
      EmployeeCode: `EMP-${String(row.EmployeeID).padStart(4, '0')}`,
      EmployeeName: [row.FirstName, row.MiddleName, row.LastName].filter(Boolean).join(' ').toLocaleUpperCase(),
      AgencyName: String(row.AgencyName || ''),
      PositionName: String(row.PositionName || ''),
      Status: String(row.Status || ''),
      MatchReasons: reasons
    }
    if (exact) exactMatches.push(match)
    else similarMatches.push(match)
  }

  return { exactMatches: exactMatches.slice(0, 12), similarMatches: similarMatches.slice(0, 12) }
}

function assertEmployeeIsNotDuplicate(review: Awaited<ReturnType<typeof employeeDuplicateReview>>, confirmPossibleDuplicate: boolean) {
  if (review.exactMatches.length) {
    const alert = alertMessages.employeeDuplicate()
    throw createError({
      statusCode: 409,
      statusMessage: alert.message,
      data: { code: EMPLOYEE_DUPLICATE, matches: review.exactMatches }
    })
  }
  if (review.similarMatches.length && !confirmPossibleDuplicate) {
    const alert = alertMessages.employeeSimilar()
    throw createError({
      statusCode: 409,
      statusMessage: alert.message,
      data: { code: EMPLOYEE_SIMILAR, matches: review.similarMatches }
    })
  }
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
    '  e.Gender, e.CivilStatus, e.Address, e.Email, e.ContactNumber, e.DateHired, e.Status, e.PhotoPath AS PhotoUrl,',
    '  e.PermanentUnitHouseNumber, e.PermanentProvince, e.PermanentStreet, e.PermanentCityMunicipality, e.PermanentSubdivision, e.PermanentBarangay, e.PermanentRegion, e.PermanentPostalCode,',
    '  e.PresentUnitHouseNumber, e.PresentProvince, e.PresentStreet, e.PresentCityMunicipality, e.PresentSubdivision, e.PresentBarangay, e.PresentRegion, e.PresentPostalCode,',
    '  e.BeneficiaryNotApplicable, e.Beneficiary1, e.Beneficiary1Relationship, e.Beneficiary2, e.Beneficiary2Relationship, e.Beneficiaries,',
    '  e.EmergencyName, e.EmergencyRelationship, e.EmergencyAddress, e.EmergencyContactNo,',
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
      'SELECT cr.ClientRateID, cr.ClientID, c.ClientName, ap.AgencyID, ap.PositionID, pr.AgencyPositionID, a.AgencyName, p.PositionName, cr.Status, pr.RegionID, rg.RegionName',
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
  const [agencies, clientRates, employees, sites, shiftCodes, agencyShiftCodes] = await Promise.all([
    activeAgencies(),
    activeClientRates(),
    activeEmployees(),
    pool.execute<any[]>('SELECT s.SiteID, s.ClientID, c.ClientName, s.SiteName FROM site s INNER JOIN client c ON c.ClientID = s.ClientID WHERE s.Status = \'Active\' AND c.Status = \'Active\' ORDER BY c.ClientName, s.SiteName').then(([rows]) => rows),
    pool.execute<any[]>(
      `SELECT ss.SiteShiftID, ss.SiteID, sc.ShiftCodeID, sc.ShiftCode, sc.ShiftName
       FROM site_shift ss
       INNER JOIN shift_code sc ON sc.ShiftCodeID = ss.ShiftCodeID
       INNER JOIN site s ON s.SiteID = ss.SiteID
       WHERE ss.Status = 'Active' AND sc.Status = 'Active' AND s.Status = 'Active'
       ORDER BY s.SiteName, sc.ShiftCode, sc.ShiftName`
    ).then(([rows]) => rows),
    pool.execute<any[]>("SELECT ShiftCodeID, AgencyID, ShiftCode, ShiftName, TimeIn, TimeOut FROM shift_code WHERE Status = 'Active' ORDER BY ShiftCode, ShiftName").then(([rows]) => rows)
  ])
  return { agencies, clientRates, employees, sites, shiftCodes, agencyShiftCodes }
}

function deploymentSql(filters: string[]) {
  return [
    'SELECT',
    '  ed.DeploymentID, ed.EmployeeID, e.EmployeeNumber, current_ap.AgencyID AS CurrentEmployeeAgencyID,',
    "  CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) AS EmployeeName,",
    '  a.AgencyName, p.PositionName, c.ClientID, c.ClientName, s.SiteName,',
    '  sc.ShiftCode, sc.ShiftName,',
    '  ed.DeploymentType, ed.IsPermanentSite, ed.StartDate, ed.EndDate,',
    "  CASE WHEN ed.EndDate IS NULL OR ed.EndDate >= CURDATE() THEN 'Active' ELSE 'Ended' END AS Status,",
    '  ed.ClientRateID, ed.SiteID, ed.SiteShiftID, ed.Remarks, ed.CreatedAt,',
    '  ap.AgencyPositionID, ap.AgencyID, ap.PositionID',
    'FROM employee_deployment ed',
    'INNER JOIN employee e ON e.EmployeeID = ed.EmployeeID',
    'LEFT JOIN agency_position current_ap ON current_ap.AgencyPositionID = e.AgencyPositionID',
    'INNER JOIN client_rate cr ON cr.ClientRateID = ed.ClientRateID',
    'INNER JOIN payroll_rate pr ON pr.PayrollRateID = cr.PayrollRateID',
    'INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID',
    'INNER JOIN agency a ON a.AgencyID = ap.AgencyID',
    positionJoin,
    'INNER JOIN site s ON s.SiteID = ed.SiteID',
    'LEFT JOIN site_shift ss ON ss.SiteShiftID = ed.SiteShiftID',
    'LEFT JOIN shift_code sc ON sc.ShiftCodeID = ss.ShiftCodeID',
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

export async function findEmployeeDuplicates(event: any) {
  const session = requireSession(event)
  void session.sub
  const body = await readBody<Record<string, unknown>>(event) || {}
  const employeeId = body.id ? parseInteger(body.id, 'id') as number : null
  return employeeDuplicateReview(body, employeeId)
}

export async function createEmployee(event: any) {
  const session = requireSession(event)
  const body = await readBody<Record<string, unknown>>(event) || {}
  const beneficiaries = validateEmployeeCompleteness(body)
  const photo = parseEmployeePhoto(body.PhotoDataUrl)
  const values = employeeValues(body, beneficiaries)
  try {
    const duplicateReview = await employeeDuplicateReview(body)
    assertEmployeeIsNotDuplicate(duplicateReview, parseBooleanFlag(body.ConfirmPossibleDuplicate) === 1)
    const [result] = await pool.execute<any>(`INSERT INTO employee (${employeeFields.join(', ')}, CreatedBy) VALUES (${employeeFields.map(() => '?').join(', ')}, ?)`, [...values, session.sub] as any[])
    if (photo) {
      try {
        await saveEmployeePhoto(result.insertId, photo)
      } catch (error) {
        await pool.execute('DELETE FROM employee WHERE EmployeeID = ?', [result.insertId]).catch(() => undefined)
        throw error
      }
    }
    return { id: result.insertId }
  } catch (error) {
    throw employeeWriteError(error)
  }
}

export async function updateEmployee(event: any) {
  const session = requireSession(event)
  const body = await readBody<Record<string, unknown>>(event) || {}
  const employeeId = parseInteger(body.id, 'id') as number
  const beneficiaries = validateEmployeeCompleteness(body)
  const photo = parseEmployeePhoto(body.PhotoDataUrl)
  const removePhoto = parseBooleanFlag(body.RemovePhoto) === 1
  try {
    const [[existing]] = await pool.execute<any[]>('SELECT PhotoPath FROM employee WHERE EmployeeID = ? LIMIT 1', [employeeId])
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'Employee not found.' })
    const duplicateReview = await employeeDuplicateReview(body, employeeId)
    assertEmployeeIsNotDuplicate(duplicateReview, parseBooleanFlag(body.ConfirmPossibleDuplicate) === 1)
    const [result] = await pool.execute<any>(`UPDATE employee SET ${employeeFields.map((field) => `${field} = ?`).join(', ')}, UpdatedBy = ? WHERE EmployeeID = ?`, [...employeeValues(body, beneficiaries), session.sub, employeeId] as any[])
    if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Employee not found.' })
    if (photo) {
      await saveEmployeePhoto(employeeId, photo)
      await removeEmployeePhoto(existing.PhotoPath).catch(() => undefined)
    } else if (removePhoto && existing.PhotoPath) {
      await pool.execute('UPDATE employee SET PhotoPath = NULL WHERE EmployeeID = ?', [employeeId])
      await removeEmployeePhoto(existing.PhotoPath).catch(() => undefined)
    }
    return { success: true }
  } catch (error) {
    throw employeeWriteError(error)
  }
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

export async function permanentlyDeleteEmployee(event: any) {
  const session = requireSession(event)
  void session.sub
  const employeeId = parseInteger(getRouterParam(event, 'id'), 'Employee') as number
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()
    const [[employee]] = await connection.execute<any[]>(
      'SELECT EmployeeID, PhotoPath FROM employee WHERE EmployeeID = ? FOR UPDATE',
      [employeeId]
    )
    if (!employee) throw createError({ statusCode: 404, statusMessage: 'Employee not found.' })

    // All other employee-owned rows use ON DELETE CASCADE. BTR has two
    // employee references with RESTRICT, so remove both roles first.
    const [btrResult] = await connection.execute<any>(
      'DELETE FROM attendance_dtr_btr WHERE ReplacedEmployeeID = ? OR RelieverEmployeeID = ?',
      [employeeId, employeeId]
    )
    const [employeeResult] = await connection.execute<any>(
      'DELETE FROM employee WHERE EmployeeID = ?',
      [employeeId]
    )
    if (!employeeResult.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Employee not found.' })

    await connection.commit()
    await removeEmployeePhoto(employee.PhotoPath).catch(() => undefined)
    return { success: true, deletedEmployeeId: employeeId, deletedBtrRows: Number(btrResult.affectedRows || 0) }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
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

async function dtrDeploymentAssignments() {
  const [rows] = await pool.execute<any[]>(
    `SELECT d.BatchID, d.AgencyID, a.AgencyName, d.ClientID, c.ClientName, d.SiteID, s.SiteName,
      d.PeriodStart, d.PeriodEnd, d.Status AS DtrStatus,
      de.EmployeeID, e.EmployeeNumber, CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) AS EmployeeName,
      de.AttendanceType, ed.DeploymentID, de.IsPermanentSite, p.PositionName
    FROM attendance_dtr d
    INNER JOIN attendance_dtr_employee de ON de.BatchID = d.BatchID
    INNER JOIN employee e ON e.EmployeeID = de.EmployeeID
    INNER JOIN agency a ON a.AgencyID = d.AgencyID
    INNER JOIN client c ON c.ClientID = d.ClientID
    INNER JOIN site s ON s.SiteID = d.SiteID
    LEFT JOIN employee_deployment ed ON ed.DeploymentID = de.DeploymentID
    LEFT JOIN client_rate cr ON cr.ClientRateID = ed.ClientRateID
    LEFT JOIN payroll_rate pr ON pr.PayrollRateID = cr.PayrollRateID
    LEFT JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
    LEFT JOIN \`position\` p ON p.PositionID = ap.PositionID
    ORDER BY d.PeriodStart DESC, d.PeriodEnd DESC, c.ClientName, s.SiteName, e.LastName, e.FirstName`
  )
  return rows
}

export async function listDeployments(event: any) {
  const session = requireSession(event)
  void session.sub
  const [items, lookups, dtrAssignments] = await Promise.all([pool.execute<any[]>(deploymentSql([])), deploymentLookups(), dtrDeploymentAssignments()])
  return { items: items[0], dtrAssignments, ...lookups }
}

export async function createDeployment(event: any) {
  const session = requireSession(event)
  const body = await readBody<Record<string, unknown>>(event) || {}
  const employeeId = parseInteger(body.EmployeeID, 'EmployeeID')
  const clientRateID = parseInteger(body.ClientRateID, 'ClientRateID')
  const siteID = parseInteger(body.SiteID, 'SiteID')
  const shiftCodeID = parseInteger(body.ShiftCodeID, 'ShiftCodeID', true)
  let siteShiftID = parseInteger(body.SiteShiftID, 'SiteShiftID', true)
  if (!shiftCodeID && !siteShiftID) throw createError({ statusCode: 400, statusMessage: 'Select a shift for this deployment.' })
  const deploymentType = parseText(body.DeploymentType) || 'Regular'
  if (deploymentType !== 'Regular' && deploymentType !== 'Reliever') {
    throw createError({ statusCode: 400, statusMessage: 'Deployment type must be Regular or Reliever.' })
  }
  const startDate = parseDate(body.StartDate)
  if (!startDate) throw createError({ statusCode: 400, statusMessage: 'StartDate is required.' })
  const endDate = parseDate(body.EndDate)
  if (endDate && endDate < startDate) throw createError({ statusCode: 400, statusMessage: 'End date must be on or after start date.' })
  const remarks = parseText(body.Remarks)

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[employee]] = await connection.execute<any[]>(
      `SELECT e.AgencyPositionID, ap.AgencyID
       FROM employee e
       INNER JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
       WHERE e.EmployeeID = ? AND e.Status = 'Active'
       FOR UPDATE`,
      [employeeId]
    )
    if (!employee) throw createError({ statusCode: 404, statusMessage: 'Active employee not found.' })

    // The employee lock serializes repeated/concurrent submissions. Check before
    // changing any site link or deployment; transfers have a separate endpoint.
    const [[conflict]] = await connection.execute<any[]>(
      `SELECT DeploymentID, ClientRateID, SiteID, StartDate, EndDate
       FROM employee_deployment
       WHERE EmployeeID = ? AND IsPermanentSite = 1
         AND StartDate <= ? AND (EndDate IS NULL OR EndDate >= ?)
       LIMIT 1 FOR UPDATE`,
      [employeeId, endDate || '9999-12-31', startDate]
    )
    if (conflict) throw createError({
      statusCode: 409,
      statusMessage: alertMessages.deploymentAlreadyExists().message,
      data: {
        code: DEPLOYMENT_ALREADY_EXISTS,
        deploymentId: conflict.DeploymentID,
        existingDeployment: conflict,
      },
    })

    const [[clientRate]] = await connection.execute<any[]>(
      `SELECT cr.ClientID, pr.AgencyPositionID, ap.AgencyID
       FROM client_rate cr
       INNER JOIN payroll_rate pr ON pr.PayrollRateID = cr.PayrollRateID
       INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
       WHERE cr.ClientRateID = ? AND cr.Status = 'Active' AND pr.Status = 'Active'
       LIMIT 1`,
      [clientRateID]
    )
    if (!clientRate || Number(clientRate.AgencyID) !== Number(employee.AgencyID)) {
      throw createError({ statusCode: 400, statusMessage: 'Select a client rate registered under the employee\'s current agency.' })
    }
    if (Number(clientRate.AgencyPositionID) !== Number(employee.AgencyPositionID)) {
      throw createError({ statusCode: 400, statusMessage: alertMessages.deploymentPositionMismatch().message })
    }

    const [[site]] = await connection.execute<any[]>(
      'SELECT SiteID FROM site WHERE SiteID = ? AND ClientID = ? AND Status = \'Active\' LIMIT 1 FOR UPDATE',
      [siteID, clientRate.ClientID]
    )
    if (!site) throw createError({ statusCode: 400, statusMessage: 'Select a site that belongs to the selected client rate.' })

    if (shiftCodeID) {
      const [[shift]] = await connection.execute<any[]>("SELECT ShiftCodeID FROM shift_code WHERE ShiftCodeID = ? AND AgencyID = ? AND Status = 'Active' FOR UPDATE", [shiftCodeID, employee.AgencyID])
      if (!shift) throw createError({ statusCode: 400, statusMessage: 'Select an active shift code from the employee\'s agency.' })
      const [[linked]] = await connection.execute<any[]>('SELECT SiteShiftID, Status FROM site_shift WHERE SiteID = ? AND ShiftCodeID = ? LIMIT 1 FOR UPDATE', [siteID, shiftCodeID])
      if (linked) {
        siteShiftID = linked.SiteShiftID
        if (linked.Status !== 'Active') await connection.execute("UPDATE site_shift SET Status = 'Active' WHERE SiteShiftID = ?", [siteShiftID])
      } else {
        const [link] = await connection.execute<any>("INSERT INTO site_shift (SiteID, ShiftCodeID, NDPolicyOverride, Status) VALUES (?, ?, 'Inherit', 'Active')", [siteID, shiftCodeID])
        siteShiftID = link.insertId
      }
    } else {
      const [[shift]] = await connection.execute<any[]>(`SELECT ss.SiteShiftID FROM site_shift ss INNER JOIN shift_code sc ON sc.ShiftCodeID = ss.ShiftCodeID
        WHERE ss.SiteShiftID = ? AND ss.SiteID = ? AND ss.Status = 'Active' AND sc.Status = 'Active' AND sc.AgencyID = ? LIMIT 1`, [siteShiftID, siteID, employee.AgencyID])
      if (!shift) throw createError({ statusCode: 400, statusMessage: 'Select an active shift for this site and employee agency.' })
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

export async function transferEmployee(event: any) {
  const session = requireSession(event)
  const employeeId = parseInteger(getRouterParam(event, 'id'), 'employeeId') as number
  const body = await readBody<Record<string, unknown>>(event) || {}
  const clientRateId = parseInteger(body.ClientRateID, 'ClientRateID') as number
  const siteId = parseInteger(body.SiteID, 'SiteID') as number
  const siteShiftId = parseInteger(body.SiteShiftID, 'SiteShiftID', true) as number | null
  const startDate = parseDate(body.StartDate)
  const remarks = parseText(body.Remarks)

  if (!startDate) throw createError({ statusCode: 400, statusMessage: 'Transfer effective date is required.' })

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[dateRow]] = await connection.execute<any[]>("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS CurrentDate")
    const today = String(dateRow.CurrentDate)
    if (startDate > today) throw createError({ statusCode: 400, statusMessage: 'Future-dated transfers are not supported yet.' })
    const [[employee]] = await connection.execute<any[]>('SELECT EmployeeID FROM employee WHERE EmployeeID = ? AND Status = \'Active\' FOR UPDATE', [employeeId])
    if (!employee) throw createError({ statusCode: 404, statusMessage: 'Active employee not found.' })

    const [[target]] = await connection.execute<any[]>(
      `SELECT pr.AgencyPositionID, cr.ClientID
       FROM client_rate cr
       INNER JOIN payroll_rate pr ON pr.PayrollRateID = cr.PayrollRateID
       WHERE cr.ClientRateID = ? AND cr.Status = 'Active' AND pr.Status = 'Active'
       LIMIT 1`,
      [clientRateId]
    )
    if (!target) throw createError({ statusCode: 400, statusMessage: 'Select an active client rate.' })

    const [[site]] = await connection.execute<any[]>('SELECT SiteID FROM site WHERE SiteID = ? AND ClientID = ? AND Status = \'Active\' LIMIT 1', [siteId, target.ClientID])
    if (!site) throw createError({ statusCode: 400, statusMessage: 'Select a site that belongs to the selected client rate.' })
    if (siteShiftId) {
      const [[shift]] = await connection.execute<any[]>('SELECT SiteShiftID FROM site_shift WHERE SiteShiftID = ? AND SiteID = ? AND Status = \'Active\' LIMIT 1', [siteShiftId, siteId])
      if (!shift) throw createError({ statusCode: 400, statusMessage: 'Select an active shift for the selected site.' })
    }

    const [[current]] = await connection.execute<any[]>(
      `SELECT DeploymentID, StartDate
       FROM employee_deployment
       WHERE EmployeeID = ? AND StartDate <= ? AND (EndDate IS NULL OR EndDate >= ?)
       ORDER BY StartDate DESC, DeploymentID DESC LIMIT 1 FOR UPDATE`,
      [employeeId, startDate, startDate]
    )
    if (!current) throw createError({ statusCode: 400, statusMessage: 'This employee has no active deployment to transfer. Create a deployment first.' })
    if (current.StartDate >= startDate) throw createError({ statusCode: 400, statusMessage: 'Transfer date must be after the current deployment start date.' })

    const [[attendanceAfterStart]] = await connection.execute<any[]>('SELECT AttendanceID FROM attendance WHERE DeploymentID = ? AND AttendanceDate >= ? LIMIT 1', [current.DeploymentID, startDate])
    if (attendanceAfterStart) throw createError({ statusCode: 400, statusMessage: 'Cannot transfer: attendance already exists for the current deployment on or after the transfer date.' })
    const [[payrollAfterStart]] = await connection.execute<any[]>('SELECT PayrollID FROM payroll WHERE DeploymentID = ? AND EndDate >= ? LIMIT 1', [current.DeploymentID, startDate])
    if (payrollAfterStart) throw createError({ statusCode: 400, statusMessage: 'Cannot transfer: payroll already covers the current deployment on or after the transfer date.' })

    await connection.execute('UPDATE employee_deployment SET EndDate = DATE_SUB(?, INTERVAL 1 DAY) WHERE DeploymentID = ?', [startDate, current.DeploymentID])
    const [result] = await connection.execute<any>(
      `INSERT INTO employee_deployment (EmployeeID, ClientRateID, SiteID, SiteShiftID, DeploymentType, StartDate, Remarks, CreatedBy)
       VALUES (?, ?, ?, ?, 'Regular', ?, ?, ?)`,
      [employeeId, clientRateId, siteId, siteShiftId, startDate, remarks, session.sub] as any[]
    )
    await connection.execute('UPDATE employee SET AgencyPositionID = ?, UpdatedBy = ? WHERE EmployeeID = ?', [target.AgencyPositionID, session.sub, employeeId])
    await connection.commit()
    return { success: true, id: result.insertId }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

function validTime(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) throw createError({ statusCode: 400, statusMessage: `${field} must be a valid time.` })
  return value
}

function validHours(value: unknown, field: string) {
  const hours = Number(value)
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) throw createError({ statusCode: 400, statusMessage: `${field} must be between 0 and 24.` })
  return hours
}

export async function createTransferSiteShift(event: any) {
  const session = requireSession(event)
  const body = await readBody<Record<string, any>>(event) || {}
  const clientRateId = parseInteger(body.ClientRateID, 'ClientRateID') as number
  const siteId = parseInteger(body.SiteID, 'SiteID') as number
  const requestedShiftCodeId = parseInteger(body.ShiftCodeID, 'ShiftCodeID', true) as number | null
  const newShift = body.newShift && typeof body.newShift === 'object' ? body.newShift as Record<string, unknown> : null
  if (!requestedShiftCodeId && !newShift) throw createError({ statusCode: 400, statusMessage: 'Choose an existing shift code or enter a new one.' })

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[target]] = await connection.execute<any[]>(
      `SELECT ap.AgencyID, cr.ClientID
       FROM client_rate cr
       INNER JOIN payroll_rate pr ON pr.PayrollRateID = cr.PayrollRateID
       INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
       WHERE cr.ClientRateID = ? AND cr.Status = 'Active' AND pr.Status = 'Active'
       LIMIT 1`,
      [clientRateId]
    )
    if (!target) throw createError({ statusCode: 400, statusMessage: 'Select an active client rate.' })
    const [[site]] = await connection.execute<any[]>('SELECT SiteID FROM site WHERE SiteID = ? AND ClientID = ? AND Status = \'Active\' LIMIT 1', [siteId, target.ClientID])
    if (!site) throw createError({ statusCode: 400, statusMessage: 'Select a site that belongs to the selected client rate.' })

    let shiftCodeId = requestedShiftCodeId
    if (shiftCodeId) {
      const [[shift]] = await connection.execute<any[]>('SELECT ShiftCodeID FROM shift_code WHERE ShiftCodeID = ? AND AgencyID = ? AND Status = \'Active\' LIMIT 1', [shiftCodeId, target.AgencyID])
      if (!shift) throw createError({ statusCode: 400, statusMessage: 'Select an active shift code from the selected agency.' })
    } else {
      const shiftCode = parseText(newShift?.ShiftCode)
      const shiftName = parseText(newShift?.ShiftName)
      const shiftType = newShift?.ShiftType
      if (!shiftCode || !shiftName) throw createError({ statusCode: 400, statusMessage: 'Shift code and shift name are required.' })
      if (!['Day', 'Night', 'Split', 'Flexible'].includes(String(shiftType))) throw createError({ statusCode: 400, statusMessage: 'Select a valid shift type.' })
      const [result] = await connection.execute<any>(
        `INSERT INTO shift_code (AgencyID, ShiftCode, ShiftName, ShiftType, TimeIn, TimeOut, RegularHours, RegularOTCap, Status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
        [target.AgencyID, shiftCode, shiftName, shiftType, validTime(newShift?.TimeIn, 'Time in'), validTime(newShift?.TimeOut, 'Time out'), validHours(newShift?.RegularHours, 'Regular hours'), validHours(newShift?.RegularOTCap, 'Regular OT cap')]
      )
      shiftCodeId = result.insertId
    }

    const [[existing]] = await connection.execute<any[]>('SELECT SiteShiftID, Status FROM site_shift WHERE SiteID = ? AND ShiftCodeID = ? LIMIT 1 FOR UPDATE', [siteId, shiftCodeId])
    let siteShiftId: number
    if (existing?.SiteShiftID) {
      await connection.execute("UPDATE site_shift SET Status = 'Active', NDPolicyOverride = 'Inherit' WHERE SiteShiftID = ?", [existing.SiteShiftID])
      siteShiftId = existing.SiteShiftID
    } else {
      const [result] = await connection.execute<any>('INSERT INTO site_shift (SiteID, ShiftCodeID, NDPolicyOverride, Status) VALUES (?, ?, \'Inherit\', \'Active\')', [siteId, shiftCodeId])
      siteShiftId = result.insertId
    }
    await connection.commit()
    return { id: siteShiftId, shiftCodeId }
  } catch (error: any) {
    await connection.rollback()
    if (error?.code === 'ER_DUP_ENTRY') throw createError({ statusCode: 409, statusMessage: 'That shift code already exists for this agency.' })
    throw error
  } finally {
    connection.release()
  }
}
