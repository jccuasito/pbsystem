import mysql from 'mysql2/promise'

const db = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
})

try {
  const [columns] = await db.execute(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agency_contribution_plan' AND COLUMN_NAME = 'AgencyPositionID'`)
  const positionColumn = columns.length ? 'plan.AgencyPositionID' : 'NULL'
  const [plans] = await db.execute(`SELECT plan.AgencyContributionID, plan.AgencyID, plan.SiteRateID,
      plan.DeductionTypeID, plan.AmountPerCutoff, plan.DeductOn,
      DATE_FORMAT(plan.EffectiveStartDate, '%Y-%m-%d') AS EffectiveStartDate,
      DATE_FORMAT(plan.EffectiveEndDate, '%Y-%m-%d') AS EffectiveEndDate,
      plan.Status, COALESCE(${positionColumn}, ap.AgencyPositionID) AS AgencyPositionID,
      COALESCE(savedPosition.AgencyID, ap.AgencyID) AS PositionAgencyID,
      (SELECT COUNT(*) FROM payroll_deduction pd WHERE pd.ReferenceType = 'Agency Contribution'
        AND pd.ReferenceID = plan.AgencyContributionID) AS PayrollLinks,
      (SELECT COUNT(*) FROM payroll_deduction_override o WHERE o.EntryType = 'AgencyContribution'
        AND o.SourceRecordID = plan.AgencyContributionID) AS OverrideLinks,
      (SELECT COUNT(*) FROM agency_contribution_plan_version v
        WHERE v.AgencyContributionID = plan.AgencyContributionID) AS VersionCount,
      (SELECT COUNT(*) FROM agency_contribution_plan_date_correction c
        WHERE c.AgencyContributionID = plan.AgencyContributionID) AS CorrectionCount
    FROM agency_contribution_plan plan
    LEFT JOIN site_rate sr ON sr.SiteRateID = plan.SiteRateID
    LEFT JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
    LEFT JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
    LEFT JOIN agency_position savedPosition ON savedPosition.AgencyPositionID = ${positionColumn}
    ORDER BY plan.AgencyContributionID`)
  if (plans.some(plan => !plan.AgencyPositionID || Number(plan.AgencyID) !== Number(plan.PositionAgencyID))) {
    throw new Error('A legacy contribution has no valid agency position. Resolve it before migration.')
  }
  const byKey = new Map()
  const deactivateIds = []
  for (const plan of plans.filter(row => row.Status === 'Active')) {
    const key = `${plan.AgencyPositionID}:${plan.DeductionTypeID}`
    const previous = byKey.get(key) || []
    const prior = previous.find(other =>
      other.EffectiveStartDate <= (plan.EffectiveEndDate || '9999-12-31') &&
      plan.EffectiveStartDate <= (other.EffectiveEndDate || '9999-12-31'))
    if (!prior) { byKey.set(key, [...previous, plan]); continue }
    if (prior.EffectiveStartDate !== plan.EffectiveStartDate || prior.EffectiveEndDate !== plan.EffectiveEndDate ||
        Number(prior.AmountPerCutoff) !== Number(plan.AmountPerCutoff) || prior.DeductOn !== plan.DeductOn) {
      throw new Error(`Conflicting contribution schedules for agency position ${plan.AgencyPositionID}, type ${plan.DeductionTypeID}. Resolve before migration.`)
    }
    const priorLinks = Number(prior.PayrollLinks) + Number(prior.OverrideLinks) + Number(prior.VersionCount) + Number(prior.CorrectionCount)
    const planLinks = Number(plan.PayrollLinks) + Number(plan.OverrideLinks) + Number(plan.VersionCount) + Number(plan.CorrectionCount)
    if (priorLinks && planLinks) throw new Error(`Both duplicate plans ${prior.AgencyContributionID} and ${plan.AgencyContributionID} have history.`)
    if (priorLinks) deactivateIds.push(Number(plan.AgencyContributionID))
    else {
      deactivateIds.push(Number(prior.AgencyContributionID))
      byKey.set(key, [...previous.filter(other => other !== prior), plan])
    }
  }
  if (!columns.length) await db.query(`ALTER TABLE agency_contribution_plan
    ADD COLUMN AgencyPositionID INT NULL AFTER AgencyID,
    ADD KEY idx_contribution_agency_position (AgencyPositionID, DeductionTypeID, Status, EffectiveStartDate),
    ADD CONSTRAINT fk_contribution_agency_position
      FOREIGN KEY (AgencyPositionID) REFERENCES agency_position(AgencyPositionID)`)
  await db.beginTransaction()
  await db.execute(`UPDATE agency_contribution_plan plan
    INNER JOIN site_rate sr ON sr.SiteRateID = plan.SiteRateID
    INNER JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
    SET plan.AgencyPositionID = pr.AgencyPositionID
    WHERE plan.AgencyPositionID IS NULL`)
  for (const id of deactivateIds) await db.execute(`UPDATE agency_contribution_plan SET Status = 'Inactive'
    WHERE AgencyContributionID = ? AND Status = 'Active'`, [id])
  await db.commit()
  const [[positionRequirement]] = await db.execute(`SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agency_contribution_plan' AND COLUMN_NAME = 'AgencyPositionID'`)
  if (positionRequirement?.IS_NULLABLE === 'YES') {
    await db.query('ALTER TABLE agency_contribution_plan MODIFY AgencyPositionID INT NOT NULL')
  }
  console.log(`Agency-position contributions ready; deactivated ${deactivateIds.length} redundant plans without deleting history.`)
} catch (error) {
  await db.rollback().catch(() => {})
  throw error
} finally {
  await db.end()
}
