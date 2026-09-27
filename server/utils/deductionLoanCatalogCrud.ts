import { createError, getRouterParam, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

type Resource = 'classification' | 'loan-type' | 'deduction-type'

const validResources = new Set<Resource>(['classification', 'loan-type', 'deduction-type'])
const validStatuses = new Set(['Active', 'Inactive'])
const validAppliesTo = new Set(['Loan', 'Deduction'])
const validDeductionCategories = new Set(['Government', 'Loan', 'Company', 'Other'])
const validDeductionPeriods = new Set(['Monthly', 'Semi-Monthly', 'Weekly', 'One-Time'])

function resource(event: any): Resource {
  const value = getRouterParam(event, 'resource') as Resource
  if (!validResources.has(value)) throw createError({ statusCode: 404, statusMessage: 'Catalog resource not found.' })
  return value
}

function requiredText(value: unknown, label: string, max = 100) {
  const text = String(value ?? '').trim()
  if (!text) throw createError({ statusCode: 400, statusMessage: `${label} is required.` })
  if (text.length > max) throw createError({ statusCode: 400, statusMessage: `${label} must be ${max} characters or fewer.` })
  return text
}

function optionalText(value: unknown, label: string, max = 255) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (text.length > max) throw createError({ statusCode: 400, statusMessage: `${label} must be ${max} characters or fewer.` })
  return text
}

function enumValue(value: unknown, allowed: Set<string>, label: string, fallback?: string) {
  const normalized = String(value ?? fallback ?? '')
  if (!allowed.has(normalized)) throw createError({ statusCode: 400, statusMessage: `Select a valid ${label}.` })
  return normalized
}

function positiveId(value: unknown, label: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: `${label} is required.` })
  return id
}

async function classifications() {
  const [rows] = await pool.execute<any[]>(
    `SELECT ClassificationID, ClassificationName, AppliesTo, Description, Status
       FROM deduction_loan_classification
      ORDER BY ClassificationName`,
  )
  return rows
}

async function ensureClassification(classificationId: number, kind: 'Loan' | 'Deduction', requireActive = true) {
  const [rows] = await pool.execute<any[]>(
    `SELECT ClassificationID, AppliesTo, Status
       FROM deduction_loan_classification
      WHERE ClassificationID = ? LIMIT 1`,
    [classificationId],
  )
  const classification = rows[0]
  if (!classification) throw createError({ statusCode: 400, statusMessage: 'The selected classification no longer exists.' })
  if (requireActive && classification.Status !== 'Active') {
    throw createError({ statusCode: 409, statusMessage: 'Select an active parent classification for an active sub-classification.' })
  }
  if (classification.AppliesTo !== kind) {
    throw createError({ statusCode: 400, statusMessage: `The selected classification cannot be used for a ${kind.toLowerCase()}.` })
  }
}

async function ensureUnique(table: 'loan_type' | 'deduction_type' | 'deduction_loan_classification', nameColumn: string, name: string, idColumn: string, id?: number) {
  const [rows] = await pool.execute<any[]>(
    `SELECT \`${idColumn}\` AS id FROM \`${table}\` WHERE LOWER(\`${nameColumn}\`) = LOWER(?)${id ? ` AND \`${idColumn}\` <> ?` : ''} LIMIT 1`,
    id ? [name, id] : [name],
  )
  if (rows[0]) throw createError({ statusCode: 409, statusMessage: 'A catalog record with this name already exists.' })
}

async function ensureClassificationCanChange(id: number, appliesTo: string, status: string) {
  const [usageRows] = await pool.execute<any[]>(
    `SELECT
       (SELECT COUNT(*) FROM loan_type WHERE ClassificationID = ? AND Status = 'Active') AS ActiveLoans,
       (SELECT COUNT(*) FROM deduction_type WHERE ClassificationID = ? AND Status = 'Active') AS ActiveDeductions`,
    [id, id],
  )
  const usage = usageRows[0]
  if (status === 'Inactive' && (Number(usage.ActiveLoans) || Number(usage.ActiveDeductions))) {
    throw createError({ statusCode: 409, statusMessage: 'Deactivate the sub-classifications under this classification first.' })
  }
  if (appliesTo === 'Loan' && Number(usage.ActiveDeductions)) {
    throw createError({ statusCode: 409, statusMessage: 'This classification still has active deduction sub-classifications.' })
  }
  if (appliesTo === 'Deduction' && Number(usage.ActiveLoans)) {
    throw createError({ statusCode: 409, statusMessage: 'This classification still has active loan sub-classifications.' })
  }
}

export async function listDeductionLoanCatalog(event: any) {
  const session = requireSession(event)
  void session.sub
  const resourceName = resource(event)
  const availableClassifications = await classifications()

  if (resourceName === 'classification') {
    const [items] = await pool.execute<any[]>(
      `SELECT c.ClassificationID, c.ClassificationName, c.AppliesTo, c.Description, c.Status,
              COUNT(DISTINCT lt.LoanTypeID) AS LoanTypeCount,
              COUNT(DISTINCT dt.DeductionTypeID) AS DeductionTypeCount
         FROM deduction_loan_classification c
         LEFT JOIN loan_type lt ON lt.ClassificationID = c.ClassificationID
         LEFT JOIN deduction_type dt ON dt.ClassificationID = c.ClassificationID
        GROUP BY c.ClassificationID, c.ClassificationName, c.AppliesTo, c.Description, c.Status
        ORDER BY c.ClassificationName`,
    )
    return { items }
  }

  if (resourceName === 'loan-type') {
    const [items] = await pool.execute<any[]>(
      `SELECT lt.LoanTypeID, lt.LoanName, lt.ClassificationID, c.ClassificationName,
              lt.GovernmentAgency, lt.Description, lt.Status
         FROM loan_type lt
         LEFT JOIN deduction_loan_classification c ON c.ClassificationID = lt.ClassificationID
        ORDER BY lt.LoanName`,
    )
    return { items, classifications: availableClassifications }
  }

  const [items] = await pool.execute<any[]>(
    `SELECT dt.DeductionTypeID, dt.DeductionName, dt.ClassificationID, c.ClassificationName,
            dt.DeductionCategory, dt.DeductionPeriod, dt.Description, dt.Status
       FROM deduction_type dt
       LEFT JOIN deduction_loan_classification c ON c.ClassificationID = dt.ClassificationID
      ORDER BY dt.DeductionName`,
  )
  return { items, classifications: availableClassifications }
}

export async function createDeductionLoanCatalog(event: any) {
  const session = requireSession(event)
  void session.sub
  const resourceName = resource(event)
  const body = await readBody<Record<string, unknown>>(event)
  const status = enumValue(body?.Status, validStatuses, 'status', 'Active')

  if (resourceName === 'classification') {
    const name = requiredText(body?.ClassificationName, 'Classification name')
    const appliesTo = enumValue(body?.AppliesTo, validAppliesTo, 'classification scope', 'Loan')
    const description = optionalText(body?.Description, 'Description')
    await ensureUnique('deduction_loan_classification', 'ClassificationName', name, 'ClassificationID')
    const [result] = await pool.execute<any>(
      'INSERT INTO deduction_loan_classification (ClassificationName, AppliesTo, Description, Status) VALUES (?, ?, ?, ?)',
      [name, appliesTo, description, status],
    )
    return { id: result.insertId }
  }

  const classificationId = positiveId(body?.ClassificationID, 'Classification')
  const description = optionalText(body?.Description, 'Description')
  if (resourceName === 'loan-type') {
    const name = requiredText(body?.LoanName, 'Loan name')
    const governmentAgency = optionalText(body?.GovernmentAgency, 'Provider or agency', 100)
    await ensureClassification(classificationId, 'Loan')
    await ensureUnique('loan_type', 'LoanName', name, 'LoanTypeID')
    const [result] = await pool.execute<any>(
      'INSERT INTO loan_type (LoanName, ClassificationID, GovernmentAgency, Description, Status) VALUES (?, ?, ?, ?, ?)',
      [name, classificationId, governmentAgency, description, status],
    )
    return { id: result.insertId }
  }

  const name = requiredText(body?.DeductionName, 'Deduction name')
  const category = enumValue(body?.DeductionCategory, validDeductionCategories, 'deduction category', 'Other')
  const period = enumValue(body?.DeductionPeriod, validDeductionPeriods, 'deduction frequency', 'Monthly')
  await ensureClassification(classificationId, 'Deduction')
  await ensureUnique('deduction_type', 'DeductionName', name, 'DeductionTypeID')
  const [result] = await pool.execute<any>(
    'INSERT INTO deduction_type (DeductionName, ClassificationID, DeductionCategory, DeductionPeriod, Description, Status) VALUES (?, ?, ?, ?, ?, ?)',
    [name, classificationId, category, period, description, status],
  )
  return { id: result.insertId }
}

export async function updateDeductionLoanCatalog(event: any) {
  const session = requireSession(event)
  void session.sub
  const resourceName = resource(event)
  const body = await readBody<Record<string, unknown>>(event)
  const id = positiveId(body?.id, 'Record ID')
  const status = enumValue(body?.Status, validStatuses, 'status', 'Active')

  if (resourceName === 'classification') {
    const name = requiredText(body?.ClassificationName, 'Classification name')
    const appliesTo = enumValue(body?.AppliesTo, validAppliesTo, 'classification scope', 'Loan')
    const description = optionalText(body?.Description, 'Description')
    await ensureUnique('deduction_loan_classification', 'ClassificationName', name, 'ClassificationID', id)
    await ensureClassificationCanChange(id, appliesTo, status)
    const [result] = await pool.execute<any>(
      'UPDATE deduction_loan_classification SET ClassificationName = ?, AppliesTo = ?, Description = ?, Status = ? WHERE ClassificationID = ?',
      [name, appliesTo, description, status, id],
    )
    if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Classification not found.' })
    return { success: true }
  }

  const classificationId = positiveId(body?.ClassificationID, 'Classification')
  const description = optionalText(body?.Description, 'Description')
  if (resourceName === 'loan-type') {
    const name = requiredText(body?.LoanName, 'Loan name')
    const governmentAgency = optionalText(body?.GovernmentAgency, 'Provider or agency', 100)
    await ensureClassification(classificationId, 'Loan', status === 'Active')
    await ensureUnique('loan_type', 'LoanName', name, 'LoanTypeID', id)
    const [result] = await pool.execute<any>(
      'UPDATE loan_type SET LoanName = ?, ClassificationID = ?, GovernmentAgency = ?, Description = ?, Status = ? WHERE LoanTypeID = ?',
      [name, classificationId, governmentAgency, description, status, id],
    )
    if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Loan type not found.' })
    return { success: true }
  }

  const name = requiredText(body?.DeductionName, 'Deduction name')
  const category = enumValue(body?.DeductionCategory, validDeductionCategories, 'deduction category', 'Other')
  const period = enumValue(body?.DeductionPeriod, validDeductionPeriods, 'deduction frequency', 'Monthly')
  await ensureClassification(classificationId, 'Deduction', status === 'Active')
  await ensureUnique('deduction_type', 'DeductionName', name, 'DeductionTypeID', id)
  const [result] = await pool.execute<any>(
    'UPDATE deduction_type SET DeductionName = ?, ClassificationID = ?, DeductionCategory = ?, DeductionPeriod = ?, Description = ?, Status = ? WHERE DeductionTypeID = ?',
    [name, classificationId, category, period, description, status, id],
  )
  if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Deduction type not found.' })
  return { success: true }
}

export async function deleteDeductionLoanCatalog(event: any) {
  const session = requireSession(event)
  void session.sub
  const resourceName = resource(event)
  const body = await readBody<Record<string, unknown>>(event)
  const id = positiveId(body?.id, 'Record ID')

  if (resourceName === 'classification') {
    await ensureClassificationCanChange(id, 'Loan', 'Inactive')
    const [result] = await pool.execute<any>(
      "UPDATE deduction_loan_classification SET Status = 'Inactive' WHERE ClassificationID = ?",
      [id],
    )
    if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Classification not found.' })
    return { success: true }
  }

  const table = resourceName === 'loan-type' ? 'loan_type' : 'deduction_type'
  const idColumn = resourceName === 'loan-type' ? 'LoanTypeID' : 'DeductionTypeID'
  const [result] = await pool.execute<any>(`UPDATE \`${table}\` SET Status = 'Inactive' WHERE \`${idColumn}\` = ?`, [id])
  if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Catalog sub-classification not found.' })
  return { success: true }
}

