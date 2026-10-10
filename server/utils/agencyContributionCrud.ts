import { createError, getQuery, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

function positiveId(value: unknown, label: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: `Select a valid ${label}.` })
  return id
}

function dateOnly(value: unknown, label: string, optional = false) {
  const valueText = String(value || '').trim()
  if (optional && !valueText) return null
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(valueText) ? new Date(`${valueText}T00:00:00Z`) : null
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== valueText) {
    throw createError({ statusCode: 400, statusMessage: `Enter a valid ${label}.` })
  }
  return valueText
}

function requireEditor(event: any) {
  const session = requireSession(event)
  if (!['Admin', 'Supervisor'].includes(String(session.userType))) {
    throw createError({ statusCode: 403, statusMessage: 'Only an Admin or Supervisor can change agency contributions.' })
  }
  return session
}

export async function listAgencyContributions(event: any) {
  const session = requireSession(event)
  void session.sub
  const [items] = await pool.execute<any[]>(`SELECT plan.AgencyContributionID, plan.AgencyID, agency.AgencyName,
    plan.SiteRateID, sr.SiteID, s.SiteName, p.PositionName, pr.RegularRate,
    plan.DeductionTypeID, dt.DeductionName, c.ClassificationName,
    plan.AmountPerCutoff, plan.DeductOn,
    DATE_FORMAT(plan.EffectiveStartDate, '%Y-%m-%d') AS EffectiveStartDate,
    DATE_FORMAT(plan.EffectiveEndDate, '%Y-%m-%d') AS EffectiveEndDate,
    plan.Status, DATE_FORMAT(plan.CreatedAt, '%Y-%m-%d %H:%i:%s') AS CreatedAt
    FROM agency_contribution_plan plan
    INNER JOIN agency ON agency.AgencyID = plan.AgencyID
    LEFT JOIN site_rate sr ON sr.SiteRateID = plan.SiteRateID
    LEFT JOIN site s ON s.SiteID = sr.SiteID
    LEFT JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
    LEFT JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
    LEFT JOIN \`position\` p ON p.PositionID = ap.PositionID
    INNER JOIN deduction_type dt ON dt.DeductionTypeID = plan.DeductionTypeID
    INNER JOIN deduction_loan_classification c ON c.ClassificationID = dt.ClassificationID
    ORDER BY agency.AgencyName, c.ClassificationName, dt.DeductionName, plan.EffectiveStartDate DESC`)
  const [agencies] = await pool.execute<any[]>("SELECT AgencyID, AgencyName FROM agency WHERE Status = 'Active' ORDER BY AgencyName")
  const [siteRates] = await pool.execute<any[]>(`SELECT sr.SiteRateID, sr.SiteID, s.SiteName,
    ap.AgencyID, p.PositionName, pr.RegularRate
    FROM site_rate sr
    INNER JOIN site s ON s.SiteID = sr.SiteID
    INNER JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
    INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
    INNER JOIN \`position\` p ON p.PositionID = ap.PositionID
    WHERE sr.Status = 'Active' AND s.Status = 'Active' AND pr.Status = 'Active'
      AND ap.Status = 'Active' AND p.Status = 'Active'
    ORDER BY s.SiteName, p.PositionName, pr.RegularRate`)
  const [catalogItems] = await pool.execute<any[]>(`SELECT dt.DeductionTypeID, dt.DeductionName, c.ClassificationName
    FROM deduction_type dt INNER JOIN deduction_loan_classification c ON c.ClassificationID = dt.ClassificationID
    WHERE dt.Status = 'Active' AND c.Status = 'Active' AND c.AppliesTo = 'Contribution'
    ORDER BY c.ClassificationName, dt.DeductionName`)
  return { items, agencies, siteRates, catalogItems }
}

export async function saveAgencyContribution(event: any) {
  const session = requireEditor(event)
  const body = await readBody<Record<string, unknown>>(event) || {}
  const id = body.AgencyContributionID ? positiveId(body.AgencyContributionID, 'contribution plan') : null
  const agencyId = positiveId(body.AgencyID, 'agency')
  const siteRateId = positiveId(body.SiteRateID, 'site position/rate')
  const typeId = positiveId(body.DeductionTypeID, 'contribution')
  const amount = Number(body.AmountPerCutoff)
  const deductOn = String(body.DeductOn || '')
  const start = dateOnly(body.EffectiveStartDate, 'effective start date')!
  const end = dateOnly(body.EffectiveEndDate, 'effective end date', true)
  const status = String(body.Status || 'Active')
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999.99 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 ||
      !['First', 'Second', 'Both'].includes(deductOn) || !['Active', 'Inactive'].includes(status) ||
      (end && end < start)) {
    throw createError({ statusCode: 400, statusMessage: 'Check the amount, cutoff, dates, and status.' })
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    // Lock the site rate to serialize overlapping plans for this exact assignment.
    const [[siteRate]] = await connection.execute<any[]>(`SELECT sr.SiteRateID FROM site_rate sr
      INNER JOIN site s ON s.SiteID = sr.SiteID
      INNER JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
      INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
      INNER JOIN \`position\` p ON p.PositionID = ap.PositionID
      INNER JOIN agency a ON a.AgencyID = ap.AgencyID
      WHERE sr.SiteRateID = ? AND ap.AgencyID = ? AND sr.Status = 'Active'
        AND s.Status = 'Active' AND pr.Status = 'Active' AND ap.Status = 'Active'
        AND p.Status = 'Active' AND a.Status = 'Active' FOR UPDATE`, [siteRateId, agencyId])
    const [[catalog]] = await connection.execute<any[]>(`SELECT dt.DeductionTypeID FROM deduction_type dt
      INNER JOIN deduction_loan_classification c ON c.ClassificationID = dt.ClassificationID
      WHERE dt.DeductionTypeID = ? AND dt.Status = 'Active' AND c.Status = 'Active' AND c.AppliesTo = 'Contribution'`, [typeId])
    if (!siteRate || !catalog) throw createError({ statusCode: 400, statusMessage: 'Select an active agency, site position/rate, and contribution.' })
    if (id) {
      const [[existing]] = await connection.execute<any[]>(
        'SELECT AgencyContributionID FROM agency_contribution_plan WHERE AgencyContributionID = ? FOR UPDATE', [id],
      )
      if (!existing) throw createError({ statusCode: 404, statusMessage: 'Contribution plan not found.' })
    }
    if (status === 'Active') {
      const [[overlap]] = await connection.execute<any[]>(`SELECT AgencyContributionID FROM agency_contribution_plan
        WHERE SiteRateID = ? AND DeductionTypeID = ? AND Status = 'Active' AND AgencyContributionID <> ?
          AND EffectiveStartDate <= COALESCE(?, '9999-12-31')
          AND (EffectiveEndDate IS NULL OR EffectiveEndDate >= ?)
          AND (DeductOn = 'Both' OR ? = 'Both' OR DeductOn = ?)
        LIMIT 1`, [siteRateId, typeId, id || 0, end, start, deductOn, deductOn])
      if (overlap) throw createError({ statusCode: 409, statusMessage: 'An active site position plan already covers this contribution, cutoff, and date range.' })
    }
    let savedId = id
    if (id) {
      await connection.execute(`UPDATE agency_contribution_plan SET AgencyID = ?, SiteRateID = ?, DeductionTypeID = ?,
        AmountPerCutoff = ?, DeductOn = ?, EffectiveStartDate = ?, EffectiveEndDate = ?, Status = ?, UpdatedBy = ?
        WHERE AgencyContributionID = ?`, [agencyId, siteRateId, typeId, amount, deductOn, start, end, status, session.sub, id])
    } else {
      const [result] = await connection.execute<any>(`INSERT INTO agency_contribution_plan
        (AgencyID, SiteRateID, DeductionTypeID, AmountPerCutoff, DeductOn, EffectiveStartDate, EffectiveEndDate, Status, CreatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [agencyId, siteRateId, typeId, amount, deductOn, start, end, status, session.sub])
      savedId = Number(result.insertId)
    }
    await connection.commit()
    return { success: true, id: savedId }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function deactivateAgencyContribution(event: any) {
  const session = requireEditor(event)
  const body = await readBody<Record<string, unknown>>(event) || {}
  const id = positiveId(body.AgencyContributionID, 'contribution plan')
  const [result] = await pool.execute<any>(`UPDATE agency_contribution_plan
    SET Status = 'Inactive', UpdatedBy = ? WHERE AgencyContributionID = ?`, [session.sub, id])
  if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Contribution plan not found.' })
  return { success: true }
}

export async function employeeContributionHistory(event: any) {
  const session = requireSession(event)
  void session.sub
  const employeeId = positiveId(getQuery(event).employeeId, 'employee')
  const [items] = await pool.execute<any[]>(`SELECT pd.PayrollDeductionID, pd.Amount, py.PayrollID,
    DATE_FORMAT(py.StartDate, '%Y-%m-%d') AS PeriodStart,
    DATE_FORMAT(py.EndDate, '%Y-%m-%d') AS PeriodEnd,
    py.Status AS PayrollStatus, dt.DeductionName, c.ClassificationName,
    COALESCE(agency.AgencyName, 'Individual plan') AS AgencyName, pd.ReferenceType AS SourceType
    FROM payroll_deduction pd
    INNER JOIN payroll py ON py.PayrollID = pd.PayrollID
    INNER JOIN deduction_type dt ON dt.DeductionTypeID = pd.DeductionTypeID
    INNER JOIN deduction_loan_classification c ON c.ClassificationID = dt.ClassificationID
    LEFT JOIN agency_contribution_plan plan ON plan.AgencyContributionID = pd.ReferenceID
      AND pd.ReferenceType = 'Agency Contribution'
    LEFT JOIN agency ON agency.AgencyID = plan.AgencyID
    WHERE py.EmployeeID = ? AND (pd.ReferenceType = 'Agency Contribution'
      OR (pd.ReferenceType = 'Recurring Deduction' AND c.AppliesTo = 'Contribution'))
      AND py.Status IN ('Approved', 'Released')
    ORDER BY py.EndDate DESC, pd.PayrollDeductionID DESC`, [employeeId])
  return { items, total: items.reduce((sum, item) => sum + Number(item.Amount || 0), 0) }
}
