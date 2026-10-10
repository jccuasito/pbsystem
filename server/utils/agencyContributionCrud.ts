import { createError, getQuery, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { dateOnly as sqlDate, snapshotAtDate, todayInPhilippines } from './rateVersions'

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

function contributionAmount(value: unknown) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999.99 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    throw createError({ statusCode: 400, statusMessage: 'Enter a positive contribution amount with at most two decimal places.' })
  }
  return amount
}

function contributionCutoff(value: unknown) {
  const cutoff = String(value || '')
  if (!['First', 'Second', 'Both'].includes(cutoff)) {
    throw createError({ statusCode: 400, statusMessage: 'Choose the first, second, or both cutoffs.' })
  }
  return cutoff
}

function updateReason(value: unknown) {
  const reason = String(value || '').trim()
  if (reason.length > 500) throw createError({ statusCode: 400, statusMessage: 'Keep the update reason or reference within 500 characters.' })
  return reason
}

async function assertPlanSelection(connection: any, agencyId: number, siteRateId: number, typeId: number) {
  // Lock site rate so concurrent single and bulk writes serialize for this assignment.
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
    WHERE dt.DeductionTypeID = ? AND dt.Status = 'Active' AND c.Status = 'Active'
      AND c.AppliesTo = 'Contribution'`, [typeId])
  if (!siteRate || !catalog) {
    throw createError({ statusCode: 400, statusMessage: 'Select an active agency, site position/rate, and contribution.' })
  }
}

async function activePlanForKey(connection: any, siteRateId: number, typeId: number, start: string, exceptId = 0) {
  const [plans] = await connection.execute<any[]>(`SELECT * FROM agency_contribution_plan
    WHERE SiteRateID = ? AND DeductionTypeID = ? AND Status = 'Active'
      AND AgencyContributionID <> ? AND (EffectiveEndDate IS NULL OR EffectiveEndDate >= ?)
    ORDER BY EffectiveStartDate DESC FOR UPDATE`, [siteRateId, typeId, exceptId, start])
  return plans
}

async function planVersions(connection: any, planId: number) {
  const [versions] = await connection.execute<any[]>(`SELECT AgencyContributionVersionID, EffectiveDate,
    AmountPerCutoff, DeductOn FROM agency_contribution_plan_version
    WHERE AgencyContributionID = ? ORDER BY EffectiveDate, AgencyContributionVersionID`, [planId])
  return versions
}

async function applyDatedUpdate(connection: any, plan: any, effectiveDate: string,
  amount: number, deductOn: string, reason: string, userId: number, dryRun = false) {
  if (plan.Status !== 'Active') throw createError({ statusCode: 409, statusMessage: 'Only active contribution plans can be updated.' })
  const originalDate = sqlDate(plan.EffectiveStartDate)
  if (effectiveDate < originalDate || (plan.EffectiveEndDate && effectiveDate > sqlDate(plan.EffectiveEndDate))) {
    throw createError({ statusCode: 409, statusMessage: `Choose an effective date on or after ${originalDate} and within the plan dates.` })
  }
  const versions = await planVersions(connection, Number(plan.AgencyContributionID))
  const current = snapshotAtDate(plan, versions, effectiveDate)
  if (Number(current.AmountPerCutoff) === amount && current.DeductOn === deductOn) {
    return { action: 'unchanged', previousAmount: Number(current.AmountPerCutoff), previousCutoff: current.DeductOn }
  }
  if (effectiveDate === originalDate) {
    throw createError({ statusCode: 409, statusMessage: `Choose an update effective date after the original plan date (${originalDate}).` })
  }
  const latest = versions.at(-1)
  if (latest && effectiveDate <= sqlDate(latest.EffectiveDate)) {
    throw createError({ statusCode: 409, statusMessage: `Choose an effective date after the latest saved update (${sqlDate(latest.EffectiveDate)}).` })
  }
  const otherPlans = await activePlanForKey(connection, Number(plan.SiteRateID), Number(plan.DeductionTypeID), effectiveDate,
    Number(plan.AgencyContributionID))
  if (otherPlans.length) throw createError({ statusCode: 409, statusMessage: 'Another active plan covers this site position and contribution.' })
  if (!dryRun) await connection.execute(`INSERT INTO agency_contribution_plan_version
    (AgencyContributionID, EffectiveDate, AmountPerCutoff, DeductOn, Reason, CreatedBy)
    VALUES (?, ?, ?, ?, ?, ?)`, [plan.AgencyContributionID, effectiveDate, amount, deductOn, reason, userId])
  return { action: 'update', previousAmount: Number(current.AmountPerCutoff), previousCutoff: current.DeductOn }
}

async function correctOriginalPlan(id: number, body: Record<string, unknown>, userId: number) {
  const start = dateOnly(body.EffectiveStartDate, 'effective start date')!
  const end = dateOnly(body.EffectiveEndDate, 'effective end date', true)
  const amount = contributionAmount(body.AmountPerCutoff)
  const deductOn = contributionCutoff(body.DeductOn)
  const reason = updateReason(body.Reason)
  if (end && end < start) throw createError({ statusCode: 400, statusMessage: 'End date must be on or after the start date.' })
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[existing]] = await connection.execute<any[]>(`SELECT SiteRateID FROM agency_contribution_plan
      WHERE AgencyContributionID = ?`, [id])
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'Contribution plan not found.' })
    // Use the same site-rate lock order as single and bulk creation.
    await connection.execute(`SELECT SiteRateID FROM site_rate WHERE SiteRateID = ? FOR UPDATE`, [existing.SiteRateID])
    const [[plan]] = await connection.execute<any[]>(`SELECT * FROM agency_contribution_plan
      WHERE AgencyContributionID = ? FOR UPDATE`, [id])
    if (!plan || plan.Status !== 'Active') {
      throw createError({ statusCode: 409, statusMessage: 'Only an active contribution plan can have its original dates corrected.' })
    }
    const previousStart = sqlDate(plan.EffectiveStartDate)
    const previousEnd = plan.EffectiveEndDate ? sqlDate(plan.EffectiveEndDate) : null
    const previousAmount = Number(plan.AmountPerCutoff)
    const previousCutoff = plan.DeductOn
    if (start === previousStart && end === previousEnd && amount === previousAmount && deductOn === previousCutoff) {
      await connection.commit()
      return { success: true, id, action: 'unchanged' }
    }
    const [[versionCount]] = await connection.execute<any[]>(`SELECT COUNT(*) AS total FROM agency_contribution_plan_version
      WHERE AgencyContributionID = ?`, [id])
    const [[payrollCount]] = await connection.execute<any[]>(`SELECT COUNT(*) AS total FROM payroll_deduction
      WHERE ReferenceType = 'Agency Contribution' AND ReferenceID = ?`, [id])
    if (Number(versionCount.total) || Number(payrollCount.total)) {
      throw createError({ statusCode: 409, statusMessage: 'The original plan can be edited only before a dated update or payroll posting. Use Update for a new effective amount.' })
    }
    const [overlap] = await connection.execute<any[]>(`SELECT AgencyContributionID FROM agency_contribution_plan
      WHERE SiteRateID = ? AND DeductionTypeID = ? AND AgencyContributionID <> ? AND Status = 'Active'
        AND EffectiveStartDate <= COALESCE(?, '9999-12-31')
        AND (EffectiveEndDate IS NULL OR EffectiveEndDate >= ?)
      LIMIT 1 FOR UPDATE`, [plan.SiteRateID, plan.DeductionTypeID, id, end, start])
    if (overlap.length) throw createError({ statusCode: 409, statusMessage: 'The corrected dates overlap another active contribution plan for this site position.' })
    await connection.execute(`UPDATE agency_contribution_plan SET EffectiveStartDate = ?, EffectiveEndDate = ?,
      AmountPerCutoff = ?, DeductOn = ?, UpdatedBy = ? WHERE AgencyContributionID = ?`,
    [start, end, amount, deductOn, userId, id])
    await connection.execute(`INSERT INTO agency_contribution_plan_date_correction
      (AgencyContributionID, PreviousStartDate, PreviousEndDate, NewStartDate, NewEndDate,
       PreviousAmountPerCutoff, NewAmountPerCutoff, PreviousDeductOn, NewDeductOn, Reason, CreatedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, previousStart, previousEnd, start, end, previousAmount, amount, previousCutoff, deductOn, reason, userId])
    await connection.commit()
    return { success: true, id, action: 'original-corrected' }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function correctLatestVersion(id: number, body: Record<string, unknown>, userId: number) {
  const effectiveDate = dateOnly(body.EffectiveDate, 'effective date')!
  const amount = contributionAmount(body.AmountPerCutoff)
  const deductOn = contributionCutoff(body.DeductOn)
  const reason = updateReason(body.Reason)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[existing]] = await connection.execute<any[]>(`SELECT SiteRateID FROM agency_contribution_plan
      WHERE AgencyContributionID = ?`, [id])
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'Contribution plan not found.' })
    await connection.execute(`SELECT SiteRateID FROM site_rate WHERE SiteRateID = ? FOR UPDATE`, [existing.SiteRateID])
    const [[plan]] = await connection.execute<any[]>(`SELECT * FROM agency_contribution_plan
      WHERE AgencyContributionID = ? FOR UPDATE`, [id])
    if (!plan || plan.Status !== 'Active') {
      throw createError({ statusCode: 409, statusMessage: 'Only an active contribution plan can be corrected.' })
    }
    const versions = await planVersions(connection, id)
    const latest = versions.at(-1)
    if (!latest) throw createError({ statusCode: 409, statusMessage: 'This contribution has no dated update to correct.' })
    const [[payrollCount]] = await connection.execute<any[]>(`SELECT COUNT(*) AS total FROM payroll_deduction
      WHERE ReferenceType = 'Agency Contribution' AND ReferenceID = ?`, [id])
    if (Number(payrollCount.total)) {
      throw createError({ statusCode: 409, statusMessage: 'A payroll posting already uses this plan. Its dated update can no longer be corrected.' })
    }
    const previousDate = sqlDate(latest.EffectiveDate)
    const earliestDate = sqlDate(versions.at(-2)?.EffectiveDate || plan.EffectiveStartDate)
    if (effectiveDate <= earliestDate || (plan.EffectiveEndDate && effectiveDate > sqlDate(plan.EffectiveEndDate))) {
      throw createError({ statusCode: 409, statusMessage: `Choose a date after ${earliestDate} and within the plan dates.` })
    }
    const previousAmount = Number(latest.AmountPerCutoff)
    const previousCutoff = latest.DeductOn
    if (effectiveDate === previousDate && amount === previousAmount && deductOn === previousCutoff) {
      await connection.commit()
      return { success: true, id, action: 'unchanged' }
    }
    const otherPlans = await activePlanForKey(connection, Number(plan.SiteRateID), Number(plan.DeductionTypeID),
      effectiveDate, id)
    if (otherPlans.length) {
      throw createError({ statusCode: 409, statusMessage: 'Another active plan covers this site position and contribution.' })
    }
    await connection.execute(`UPDATE agency_contribution_plan_version SET EffectiveDate = ?, AmountPerCutoff = ?,
      DeductOn = ? WHERE AgencyContributionVersionID = ?`,
    [effectiveDate, amount, deductOn, latest.AgencyContributionVersionID])
    await connection.execute(`INSERT INTO agency_contribution_plan_date_correction
      (AgencyContributionID, AgencyContributionVersionID, CorrectionKind,
       PreviousStartDate, NewStartDate, PreviousAmountPerCutoff, NewAmountPerCutoff,
       PreviousDeductOn, NewDeductOn, Reason, CreatedBy)
      VALUES (?, ?, 'Version', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, latest.AgencyContributionVersionID, previousDate, effectiveDate, previousAmount, amount,
      previousCutoff, deductOn, reason, userId])
    await connection.commit()
    return { success: true, id, action: 'version-corrected' }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
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
    plan.Status, DATE_FORMAT(plan.CreatedAt, '%Y-%m-%d %H:%i:%s') AS CreatedAt,
    (SELECT COUNT(*) FROM payroll_deduction pd WHERE pd.ReferenceType = 'Agency Contribution'
      AND pd.ReferenceID = plan.AgencyContributionID) AS PayrollLinkCount,
    (SELECT COUNT(*) FROM payroll_deduction_override override_row
      WHERE override_row.EntryType = 'AgencyContribution'
        AND override_row.SourceRecordID = plan.AgencyContributionID) AS OverrideLinkCount,
    CONCAT_WS(' ', creator.FirstName, creator.LastName) AS CreatedByName
    FROM agency_contribution_plan plan
    INNER JOIN agency ON agency.AgencyID = plan.AgencyID
    LEFT JOIN site_rate sr ON sr.SiteRateID = plan.SiteRateID
    LEFT JOIN site s ON s.SiteID = sr.SiteID
    LEFT JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
    LEFT JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
    LEFT JOIN \`position\` p ON p.PositionID = ap.PositionID
    INNER JOIN deduction_type dt ON dt.DeductionTypeID = plan.DeductionTypeID
    INNER JOIN deduction_loan_classification c ON c.ClassificationID = dt.ClassificationID
    LEFT JOIN \`user\` creator ON creator.UserID = plan.CreatedBy
    ORDER BY agency.AgencyName, c.ClassificationName, dt.DeductionName, plan.EffectiveStartDate DESC`)
  const [versionRows] = await pool.execute<any[]>(`SELECT v.AgencyContributionVersionID, v.AgencyContributionID,
    DATE_FORMAT(v.EffectiveDate, '%Y-%m-%d') AS EffectiveDate, v.AmountPerCutoff, v.DeductOn,
    v.Reason, DATE_FORMAT(v.CreatedAt, '%Y-%m-%d %H:%i:%s') AS CreatedAt,
    CONCAT_WS(' ', updater.FirstName, updater.LastName) AS CreatedByName
    FROM agency_contribution_plan_version v
    LEFT JOIN \`user\` updater ON updater.UserID = v.CreatedBy
    ORDER BY v.AgencyContributionID, v.EffectiveDate, v.AgencyContributionVersionID`)
  const [correctionRows] = await pool.execute<any[]>(`SELECT correction.AgencyContributionDateCorrectionID,
    correction.AgencyContributionID, correction.AgencyContributionVersionID, correction.CorrectionKind,
    DATE_FORMAT(correction.PreviousStartDate, '%Y-%m-%d') AS PreviousStartDate,
    DATE_FORMAT(correction.PreviousEndDate, '%Y-%m-%d') AS PreviousEndDate,
    DATE_FORMAT(correction.NewStartDate, '%Y-%m-%d') AS NewStartDate,
    DATE_FORMAT(correction.NewEndDate, '%Y-%m-%d') AS NewEndDate,
    correction.PreviousAmountPerCutoff, correction.NewAmountPerCutoff,
    correction.PreviousDeductOn, correction.NewDeductOn,
    correction.Reason, DATE_FORMAT(correction.CreatedAt, '%Y-%m-%d %H:%i:%s') AS CreatedAt,
    CONCAT_WS(' ', editor.FirstName, editor.LastName) AS CreatedByName
    FROM agency_contribution_plan_date_correction correction
    LEFT JOIN \`user\` editor ON editor.UserID = correction.CreatedBy
    ORDER BY correction.AgencyContributionID, correction.AgencyContributionDateCorrectionID`)
  const versionsByPlan = new Map<number, any[]>()
  for (const version of versionRows) {
    const id = Number(version.AgencyContributionID)
    versionsByPlan.set(id, [...(versionsByPlan.get(id) || []), version])
  }
  const correctionsByPlan = new Map<number, any[]>()
  for (const correction of correctionRows) {
    const id = Number(correction.AgencyContributionID)
    correctionsByPlan.set(id, [...(correctionsByPlan.get(id) || []), correction])
  }
  const today = todayInPhilippines()
  const enriched = items.map(item => {
    const versions = versionsByPlan.get(Number(item.AgencyContributionID)) || []
    const current = snapshotAtDate(item, versions, today)
    return { ...item, Versions: versions, DateCorrections: correctionsByPlan.get(Number(item.AgencyContributionID)) || [],
      CurrentAmountPerCutoff: Number(current.AmountPerCutoff), CurrentDeductOn: current.DeductOn,
      NextEffectiveDate: versions.find(version => version.EffectiveDate > today)?.EffectiveDate || null }
  })
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
  return { items: enriched, agencies, siteRates, catalogItems }
}

export async function saveAgencyContribution(event: any) {
  const session = requireEditor(event)
  const body = await readBody<Record<string, unknown>>(event) || {}
  const id = body.AgencyContributionID ? positiveId(body.AgencyContributionID, 'contribution plan') : null
  if (id) {
    if (body.mode === 'original') return correctOriginalPlan(id, body, Number(session.sub))
    if (body.mode === 'version-correction') return correctLatestVersion(id, body, Number(session.sub))
    if (body.mode !== 'version') throw createError({ statusCode: 400, statusMessage: 'Use a dated update to change an existing contribution.' })
    const amount = contributionAmount(body.AmountPerCutoff)
    const deductOn = contributionCutoff(body.DeductOn)
    const effectiveDate = dateOnly(body.EffectiveDate, 'update effective date')!
    const reason = updateReason(body.Reason)
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const [[plan]] = await connection.execute<any[]>(`SELECT * FROM agency_contribution_plan
        WHERE AgencyContributionID = ? FOR UPDATE`, [id])
      if (!plan) throw createError({ statusCode: 404, statusMessage: 'Contribution plan not found.' })
      const result = await applyDatedUpdate(connection, plan, effectiveDate, amount, deductOn, reason, Number(session.sub))
      await connection.commit()
      return { success: true, id, ...result }
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  const agencyId = positiveId(body.AgencyID, 'agency')
  const siteRateId = positiveId(body.SiteRateID, 'site position/rate')
  const typeId = positiveId(body.DeductionTypeID, 'contribution')
  const amount = contributionAmount(body.AmountPerCutoff)
  const deductOn = contributionCutoff(body.DeductOn)
  const start = dateOnly(body.EffectiveStartDate, 'effective start date')!
  const end = dateOnly(body.EffectiveEndDate, 'effective end date', true)
  const status = String(body.Status || 'Active')
  if (!['Active', 'Inactive'].includes(status) || (end && end < start)) {
    throw createError({ statusCode: 400, statusMessage: 'Check the dates and status.' })
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await assertPlanSelection(connection, agencyId, siteRateId, typeId)
    if (status === 'Active') {
      const [overlap] = await connection.execute<any[]>(`SELECT AgencyContributionID FROM agency_contribution_plan
        WHERE SiteRateID = ? AND DeductionTypeID = ? AND Status = 'Active'
          AND EffectiveStartDate <= COALESCE(?, '9999-12-31')
          AND (EffectiveEndDate IS NULL OR EffectiveEndDate >= ?)
        LIMIT 1`, [siteRateId, typeId, end, start])
      if (overlap.length) throw createError({ statusCode: 409, statusMessage: 'An active site-position plan already covers this contribution and date range. Add a dated update instead.' })
    }
    const [result] = await connection.execute<any>(`INSERT INTO agency_contribution_plan
      (AgencyID, SiteRateID, DeductionTypeID, AmountPerCutoff, DeductOn, EffectiveStartDate, EffectiveEndDate, Status, CreatedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [agencyId, siteRateId, typeId, amount, deductOn, start, end, status, session.sub])
    await connection.commit()
    return { success: true, id: Number(result.insertId), action: 'create' }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function bulkSaveAgencyContributions(event: any) {
  const session = requireEditor(event)
  const body = await readBody<Record<string, unknown>>(event) || {}
  const agencyId = positiveId(body.AgencyID, 'agency')
  const effectiveDate = dateOnly(body.EffectiveDate, 'effective date')!
  const dryRun = body.DryRun === true
  if (!Array.isArray(body.Rows) || !body.Rows.length || body.Rows.length > 1000) {
    throw createError({ statusCode: 400, statusMessage: 'Select 1 to 1,000 site-position contributions.' })
  }
  const rows = body.Rows.map((row: any) => ({
    SiteRateID: positiveId(row?.SiteRateID, 'site position/rate'),
    DeductionTypeID: positiveId(row?.DeductionTypeID, 'contribution'),
    AmountPerCutoff: contributionAmount(row?.AmountPerCutoff),
    DeductOn: contributionCutoff(row?.DeductOn),
  })).sort((left, right) => left.SiteRateID - right.SiteRateID || left.DeductionTypeID - right.DeductionTypeID)
  const keys = rows.map(row => `${row.SiteRateID}:${row.DeductionTypeID}`)
  if (new Set(keys).size !== keys.length) {
    throw createError({ statusCode: 400, statusMessage: 'A site position and contribution appears more than once.' })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const results: any[] = []
    for (const row of rows) {
      await assertPlanSelection(connection, agencyId, row.SiteRateID, row.DeductionTypeID)
      const matches = await activePlanForKey(connection, row.SiteRateID, row.DeductionTypeID, effectiveDate)
      if (matches.length) {
        results.push({ ...row, AgencyContributionID: Number(matches[0].AgencyContributionID), action: 'duplicate' })
      } else {
        if (!dryRun) {
          const [insert] = await connection.execute<any>(`INSERT INTO agency_contribution_plan
            (AgencyID, SiteRateID, DeductionTypeID, AmountPerCutoff, DeductOn, EffectiveStartDate, Status, CreatedBy)
            VALUES (?, ?, ?, ?, ?, ?, 'Active', ?)`,
          [agencyId, row.SiteRateID, row.DeductionTypeID, row.AmountPerCutoff, row.DeductOn, effectiveDate, session.sub])
          results.push({ ...row, AgencyContributionID: Number(insert.insertId), action: 'create' })
        } else results.push({ ...row, action: 'create' })
      }
    }
    const counts = { create: results.filter(row => row.action === 'create').length,
      duplicate: results.filter(row => row.action === 'duplicate').length }
    if (!dryRun && counts.duplicate) {
      throw createError({ statusCode: 409, statusMessage: `${counts.duplicate} selected contribution plan(s) already exist. Remove those rows from the bulk setup; no plans were saved.` })
    }
    if (dryRun) await connection.rollback()
    else await connection.commit()
    return { success: true, dryRun, counts, results }
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
  if (body.action === 'delete') {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const [[plan]] = await connection.execute<any[]>(`SELECT AgencyContributionID, Status
        FROM agency_contribution_plan WHERE AgencyContributionID = ? FOR UPDATE`, [id])
      if (!plan) throw createError({ statusCode: 404, statusMessage: 'Contribution plan not found.' })
      if (plan.Status !== 'Inactive') {
        throw createError({ statusCode: 409, statusMessage: 'Deactivate this contribution plan before deleting it.' })
      }
      const [[payroll]] = await connection.execute<any[]>(`SELECT PayrollDeductionID FROM payroll_deduction
        WHERE ReferenceType = 'Agency Contribution' AND ReferenceID = ? LIMIT 1 FOR UPDATE`, [id])
      const [[override]] = await connection.execute<any[]>(`SELECT OverrideID FROM payroll_deduction_override
        WHERE EntryType = 'AgencyContribution' AND SourceRecordID = ? LIMIT 1 FOR UPDATE`, [id])
      if (payroll || override) {
        throw createError({ statusCode: 409, statusMessage: 'This plan has payroll or deduction review history and cannot be permanently deleted.' })
      }
      await connection.execute(`DELETE FROM agency_contribution_plan WHERE AgencyContributionID = ?`, [id])
      await connection.commit()
      return { success: true, action: 'deleted' }
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }
  if (body.action && body.action !== 'deactivate') {
    throw createError({ statusCode: 400, statusMessage: 'Choose deactivate or delete.' })
  }
  const [result] = await pool.execute<any>(`UPDATE agency_contribution_plan
    SET Status = 'Inactive', UpdatedBy = ? WHERE AgencyContributionID = ?`, [session.sub, id])
  if (!result.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Contribution plan not found.' })
  return { success: true, action: 'deactivated' }
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
