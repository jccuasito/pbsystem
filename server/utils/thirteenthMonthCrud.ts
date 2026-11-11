import crypto from 'node:crypto'
import { createError, getQuery, readBody, setHeader } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { annualBasic, annualCents, annualDate, annualOverlap, annualSummary, type AnnualSource } from '../../shared/utils/thirteenthMonth'

const fail = (message: string, statusCode = 400): never => { throw createError({ statusCode, statusMessage: message }) }
const parse = (value: any) => { try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null } }
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const id = (value: unknown) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) fail('Select a valid employee and agency.'); return n }
const yearValue = (value: unknown) => { const n = Number(value); if (!Number.isInteger(n) || n < 2000 || n > Number(today().slice(0, 4)) + 1) fail('Choose a valid pay year.'); return n }
const text = (value: unknown, min = 5, max = 1000) => { if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(`Enter a reference or review note of ${min}-${max} characters.`); return String(value).trim() }
const amount = (value: unknown, positive = false) => { if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') fail('Enter a valid monetary amount.'); const n = Number(value); if (!Number.isFinite(n) || Math.abs(n) > 999999999 || Math.abs(n * 100 - Math.round(n * 100)) > 0.00001 || (positive && n <= 0)) fail('Use a valid amount with at most two decimal places.'); return n }

export async function thirteenthMonthData(year: number, agencyId = 0, connection: any = pool) {
  const start = `${year}-01-01`, end = `${year}-12-31`
  const [agencies] = await connection.execute('SELECT AgencyID,AgencyName FROM agency ORDER BY AgencyName')
  const [employees] = await connection.execute(`SELECT e.EmployeeID,e.EmployeeNumber,CONCAT_WS(' ',e.FirstName,e.MiddleName,e.LastName) AS EmployeeName,
    e.Status,DATE_FORMAT(e.DateHired,'%Y-%m-%d') AS DateHired,ap.AgencyID,p.PositionName
    FROM employee e LEFT JOIN agency_position ap ON ap.AgencyPositionID=e.AgencyPositionID
    LEFT JOIN \`position\` p ON p.PositionID=ap.PositionID ORDER BY e.LastName,e.FirstName,e.EmployeeID`)
  const [payrolls] = await connection.execute(`SELECT py.PayrollID,py.EmployeeID,d.AgencyID,d.BatchID,s.SiteName,
    DATE_FORMAT(py.StartDate,'%Y-%m-%d') AS PeriodStart,DATE_FORMAT(py.EndDate,'%Y-%m-%d') AS PeriodEnd,r.SnapshotJson
    FROM payroll_processing_posting pp INNER JOIN payroll py ON py.PayrollID=pp.PayrollID
    INNER JOIN attendance_dtr d ON d.BatchID=pp.BatchID INNER JOIN site s ON s.SiteID=d.SiteID
    LEFT JOIN payroll_processing_review r ON r.BatchID=d.BatchID
    WHERE pp.Status='Active' AND py.Status IN ('Approved','Released') AND py.PayrollType='Regular'
      AND py.StartDate<=? AND py.EndDate>=? AND (?=0 OR d.AgencyID=?) ORDER BY py.PayrollID`, [end, start, agencyId, agencyId])
  const [imports] = await connection.execute(`SELECT *,DATE_FORMAT(PeriodStart,'%Y-%m-%d') AS PeriodStart,
    DATE_FORMAT(PeriodEnd,'%Y-%m-%d') AS PeriodEnd FROM thirteenth_month_earning WHERE PayYear=? AND (?=0 OR AgencyID=?) ORDER BY EarningID`, [year, agencyId, agencyId])
  const [headers] = await connection.execute(`SELECT *,DATE_FORMAT(CoverageStart,'%Y-%m-%d') AS CoverageStart,
    DATE_FORMAT(CoverageEnd,'%Y-%m-%d') AS CoverageEnd FROM thirteenth_month_pay WHERE PayYear=? AND (?=0 OR AgencyID=?) ORDER BY ThirteenthMonthID`, [year, agencyId, agencyId])
  const [releases] = await connection.execute(`SELECT r.*,DATE_FORMAT(r.PaymentDate,'%Y-%m-%d') AS PaymentDate,
    CONCAT_WS(' ',u.FirstName,u.LastName) AS ActorName FROM thirteenth_month_release r
    INNER JOIN thirteenth_month_pay h ON h.ThirteenthMonthID=r.ThirteenthMonthID
    LEFT JOIN \`user\` u ON u.UserID=r.CreatedBy WHERE h.PayYear=? AND (?=0 OR h.AgencyID=?) ORDER BY r.ReleaseID DESC`, [year, agencyId, agencyId])
  const [events] = await connection.execute(`SELECT ev.EventID,ev.ThirteenthMonthID,ev.Action,ev.Reason,ev.CreatedAt,
    CONCAT_WS(' ',u.FirstName,u.LastName) AS ActorName FROM thirteenth_month_event ev
    INNER JOIN thirteenth_month_pay h ON h.ThirteenthMonthID=ev.ThirteenthMonthID LEFT JOIN \`user\` u ON u.UserID=ev.ActorID
    WHERE h.PayYear=? AND (?=0 OR h.AgencyID=?) ORDER BY ev.EventID DESC`, [year, agencyId, agencyId])
  const [adjustments] = await connection.execute(`SELECT pal.AdjustmentLineID,pal.ComponentCode,pal.Description,pal.Direction,pal.Amount,
    pa.EmployeeID,py.PayrollID,d.AgencyID,r.SnapshotJson,cr.IncludedInBasic,cr.Reason AS ClassificationReason,
    DATE_FORMAT(COALESCE(cr.EarnedDate,pal.SourceDate,py.StartDate),'%Y-%m-%d') AS EarnedDate
    FROM payroll_adjustment pa INNER JOIN payroll_adjustment_line pal ON pal.AdjustmentID=pa.AdjustmentID
    INNER JOIN payroll py ON py.PayrollID=pa.TargetPayrollID
    INNER JOIN payroll_processing_posting pp ON pp.PayrollID=py.PayrollID AND pp.Status='Active'
    INNER JOIN attendance_dtr d ON d.BatchID=pp.BatchID LEFT JOIN payroll_processing_review r ON r.BatchID=d.BatchID
    LEFT JOIN thirteenth_month_review cr ON cr.AdjustmentLineID=pal.AdjustmentLineID
    WHERE pa.Status='Applied' AND py.Status IN ('Approved','Released')
      AND COALESCE(cr.EarnedDate,pal.SourceDate,py.StartDate) BETWEEN ? AND ? AND (?=0 OR d.AgencyID=?)
    ORDER BY pal.AdjustmentLineID`, [start, end, agencyId, agencyId])

  const pairs = new Map<string, any>()
  const add = (employeeId: number, ag: number) => {
    if (!ag || (agencyId && Number(ag) !== agencyId)) return
    const employee = employees.find((row: any) => Number(row.EmployeeID) === Number(employeeId))
    if (!employee) return
    const key = `${employeeId}:${ag}`
    if (!pairs.has(key)) pairs.set(key, { ...employee, AgencyID: Number(ag), AgencyName: agencies.find((row: any) => Number(row.AgencyID) === Number(ag))?.AgencyName || '', sources: [] as AnnualSource[] })
  }
  employees.forEach((row: any) => { if (!row.DateHired || row.DateHired <= end) add(row.EmployeeID, row.AgencyID) })
  ;[...payrolls, ...imports, ...headers, ...adjustments].forEach((row: any) => add(row.EmployeeID, row.AgencyID))
  for (const row of payrolls) {
    const person = pairs.get(`${row.EmployeeID}:${row.AgencyID}`)
    if (!person) continue
    const frozen = parse(row.SnapshotJson)?.employees?.find((item: any) => Number(item.EmployeeID) === Number(row.EmployeeID))
    const values = annualBasic(Array.isArray(frozen?.components) ? frozen.components : [])
    if (!frozen || !Array.isArray(frozen.components)) values.issues.push('Finalized earnings snapshot is missing. Do not substitute gross or net pay.')
    values.excluded += Number(frozen?.allowance || 0)
    person.sources.push({ id: `payroll:${row.PayrollID}`, payrollId: row.PayrollID, start: row.PeriodStart, end: row.PeriodEnd, reference: `Payroll #${row.PayrollID} / DTR #${row.BatchID}`, site: row.SiteName, kind: 'Finalized payroll', ...values })
  }
  for (const row of imports.filter((item: any) => item.Status === 'Active')) {
    const person = pairs.get(`${row.EmployeeID}:${row.AgencyID}`)
    if (!person) continue
    const value = Number(row.BasicEarned)
    const issues: string[] = []
    if (row.EntryKind === 'Previous earnings' && person.sources.some((source: any) => source.kind !== 'Basic adjustment' && annualOverlap(source, { start: row.PeriodStart, end: row.PeriodEnd }))) issues.push('Imported coverage overlaps another earnings source. Remove the duplicate import before approval.')
    person.sources.push({ id: `import:${row.EarningID}`, earningId: row.EarningID, start: row.PeriodStart, end: row.PeriodEnd, reference: row.Reference, site: 'Verified manual record', kind: row.EntryKind,
      basic: row.EntryKind === 'Previous earnings' ? value : 0, adjustments: row.EntryKind === 'Basic adjustment' ? value : 0, timeDeductions: 0, excluded: 0, issues })
  }
  for (const row of adjustments) {
    const person = pairs.get(`${row.EmployeeID}:${row.AgencyID}`)
    if (!person) continue
    const frozen = parse(row.SnapshotJson)?.employees?.find((item: any) => Number(item.EmployeeID) === Number(row.EmployeeID))?.adjustments?.find((item: any) => Number(item.lineId) === Number(row.AdjustmentLineID))
    const values = annualBasic([], [{ code: row.ComponentCode, lineId: row.AdjustmentLineID, description: row.Description,
      amount: frozen?.amount ?? row.Amount, direction: frozen?.direction ?? row.Direction, included: row.IncludedInBasic == null ? null : Boolean(row.IncludedInBasic) }])
    if (!frozen) values.issues.push('Applied adjustment is missing from the finalized snapshot.')
    if (row.ComponentCode === 'ManualAmount' && row.IncludedInBasic == null) values.issues.push('Confirm the earned date and basic-pay classification of this manual adjustment.')
    person.sources.push({ id: `adjustment:${row.AdjustmentLineID}`, start: row.EarnedDate, end: row.EarnedDate, reference: `Adjustment #${row.AdjustmentLineID} / Payroll #${row.PayrollID}`, site: row.Description, kind: 'Basic adjustment', ...values })
  }
  const items = [...pairs.values()].map(person => {
    const header = headers.find((row: any) => Number(row.EmployeeID) === Number(person.EmployeeID) && Number(row.AgencyID) === Number(person.AgencyID)) || null
    const saved = parse(header?.SnapshotJson)
    const coverageStart = header?.CoverageStart || (person.DateHired && person.DateHired > start ? person.DateHired : start)
    const coverageEnd = header?.CoverageEnd || end
    const payments = releases.filter((row: any) => row.ThirteenthMonthID === header?.ThirteenthMonthID)
    person.sources.sort((a: AnnualSource, b: AnnualSource) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
    const sourceHash = crypto.createHash('sha256').update(JSON.stringify(person.sources)).digest('hex')
    const { SnapshotJson, ...safeHeader } = header || {}
    return { ...person, header: header ? safeHeader : null, saved, sourceHash, sourceChanged: Boolean(header?.SourceHash && header.SourceHash !== sourceHash), coverageStart, coverageEnd,
      summary: annualSummary(person.sources, coverageStart, coverageEnd, payments), releases: payments,
      imports: imports.filter((row: any) => Number(row.EmployeeID) === Number(person.EmployeeID) && Number(row.AgencyID) === Number(person.AgencyID)),
      adjustmentReviews: adjustments.filter((row: any) => Number(row.EmployeeID) === Number(person.EmployeeID) && Number(row.AgencyID) === Number(person.AgencyID)).map(({ SnapshotJson, ...row }: any) => row),
      events: events.filter((row: any) => row.ThirteenthMonthID === header?.ThirteenthMonthID) }
  })
  return { year, agencies, items }
}

export async function listThirteenthMonth(event: any) {
  const session = requireSession(event)
  setHeader(event, 'Cache-Control', 'no-store')
  const query = getQuery(event)
  const year = yearValue(query.year || today().slice(0, 4))
  const agencyId = query.agencyId ? id(query.agencyId) : 0
  const data = await thirteenthMonthData(year, agencyId)
  return { ...data, permissions: { canEdit: session.userType !== 'Viewer' && event.context?.moduleCanEdit !== false,
    canApprove: ['Admin', 'Supervisor'].includes(session.userType) && event.context?.moduleCanEdit !== false } }
}

export async function updateThirteenthMonth(event: any) {
  const session = requireSession(event)
  if (session.userType === 'Viewer' || event.context?.moduleCanEdit === false) fail('Payroll edit access is required.', 403)
  const body = await readBody(event) || {}
  const year = yearValue(body.year), employeeId = id(body.employeeId), agencyId = id(body.agencyId)
  const action = String(body.action || '')
  if (!['save', 'approve', 'reopen', 'import', 'remove-import', 'classify', 'release', 'previous-payment', 'void-payment'].includes(action)) fail('Choose a supported 13th-month action.')
  const canApprove = ['Admin', 'Supervisor'].includes(session.userType)
  if (['approve', 'reopen', 'release', 'previous-payment', 'void-payment'].includes(action) && !canApprove) fail('Only an Admin or Supervisor can approve or record payments.', 403)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    // Match payroll's DTR-before-employee lock order. Reversing it can deadlock
    // against a simultaneous payroll insert's employee foreign-key check.
    await connection.execute(`SELECT d.BatchID FROM attendance_dtr d WHERE d.AgencyID=? AND
      (d.PeriodStart<=? AND d.PeriodEnd>=? OR d.BatchID IN (SELECT pp.BatchID FROM payroll_processing_posting pp
        INNER JOIN payroll py ON py.PayrollID=pp.PayrollID
        INNER JOIN payroll_adjustment a ON a.TargetPayrollID=pp.PayrollID INNER JOIN payroll_adjustment_line l ON l.AdjustmentID=a.AdjustmentID
        LEFT JOIN thirteenth_month_review cr ON cr.AdjustmentLineID=l.AdjustmentLineID
        WHERE COALESCE(cr.EarnedDate,l.SourceDate,py.StartDate) BETWEEN ? AND ?)) ORDER BY d.BatchID FOR UPDATE`, [agencyId, `${year}-12-31`, `${year}-01-01`, `${year}-01-01`, `${year}-12-31`])
    const [[employee]] = await connection.execute<any[]>('SELECT EmployeeID FROM employee WHERE EmployeeID=? FOR UPDATE', [employeeId])
    if (!employee) fail('Employee not found.', 404)
    let data = await thirteenthMonthData(year, agencyId, connection)
    let person = data.items.find(row => Number(row.EmployeeID) === employeeId)
    // HR may import historical earnings under a former employer without a current deployment.
    if (!person && action !== 'import') fail('No employee record exists under this agency for the selected year.', 404)
    if (!person) {
      const [[agency]] = await connection.execute<any[]>('SELECT AgencyID FROM agency WHERE AgencyID=?', [agencyId])
      if (!agency) fail('Agency not found.', 404)
    }
    if (body.expectedHash !== person?.sourceHash && person) fail('Earnings changed. Refresh and review the latest amounts.', 409)
    const header = person?.header
    if (header && Number(body.revision) !== Number(header.Revision)) fail('This annual record changed. Refresh before continuing.', 409)
    if (['import', 'remove-import', 'classify', 'save'].includes(action) && header && header.Status !== 'Draft') fail('Reopen the annual computation before changing its basis.', 409)
    const reason = text(body.reason)
    let recordId = Number(header?.ThirteenthMonthID || 0)
    async function ensureHeader() {
      if (recordId) return recordId
      const [insert] = await connection.execute<any>(`INSERT INTO thirteenth_month_pay(EmployeeID,AgencyID,PayYear,ComputedDate,Status,CreatedBy)
        VALUES(?,?,?,?,'Draft',?)`, [employeeId, agencyId, year, today(), session.sub])
      recordId = insert.insertId
      return recordId
    }
    let auditAction = action
    if (action === 'import') {
      const rows = body.rows
      if (!Array.isArray(rows) || !rows.length || rows.length > 100) fail('Import between 1 and 100 verified rows for this employee.')
      const previous = (person?.sources || []).filter((row: AnnualSource) => row.kind !== 'Basic adjustment')
      const references = new Set((person?.imports || []).filter((row: any) => row.Status === 'Active').map((row: any) => row.Reference.toLowerCase()))
      for (const row of rows) {
        const start = annualDate(row.start), end = annualDate(row.end)
        if (!start || !end || start > end || start.slice(0, 4) !== String(year) || end.slice(0, 4) !== String(year) || start.slice(0, 7) !== end.slice(0, 7)) fail('Each import row must cover valid dates within one month of the selected year.')
        if (end > today()) fail('Import actual, verified earnings only. Future earnings cannot be imported.')
        const basic = amount(row.basic)
        const kind = row.kind === 'Basic adjustment' ? 'Basic adjustment' : row.kind === 'Previous earnings' ? 'Previous earnings' : fail('Choose previous earnings or a basic adjustment.')
        if (kind === 'Previous earnings' && basic < 0) fail('Previous basic earnings cannot be negative.')
        const reference = text(row.reference, 3, 150)
        if (references.has(reference.toLowerCase())) fail('An imported reference is duplicated. Review the existing records.', 409)
        references.add(reference.toLowerCase())
        if (kind === 'Previous earnings') {
          if (previous.some((source: any) => annualOverlap(source, { start, end }))) fail('Previous earnings overlap existing payroll or imported coverage.', 409)
          previous.push({ start, end })
        }
        await connection.execute(`INSERT INTO thirteenth_month_earning(EmployeeID,AgencyID,PayYear,PeriodStart,PeriodEnd,BasicEarned,Reference,Reason,EntryKind,CreatedBy)
          VALUES(?,?,?,?,?,?,?,?,?,?)`, [employeeId, agencyId, year, start, end, basic, reference, reason, kind, session.sub])
      }
      await ensureHeader()
    } else if (action === 'remove-import') {
      const [result] = await connection.execute<any>(`UPDATE thirteenth_month_earning SET Status='Inactive',RemovedBy=?,RemovedAt=NOW(),RemovalReason=?
        WHERE EarningID=? AND EmployeeID=? AND AgencyID=? AND PayYear=? AND Status='Active'`, [session.sub, reason, id(body.earningId), employeeId, agencyId, year])
      if (!result.affectedRows) fail('Active import not found.', 404)
      await ensureHeader()
    } else if (action === 'classify') {
      const line = person.adjustmentReviews.find((row: any) => Number(row.AdjustmentLineID) === id(body.lineId))
      const earnedDate = annualDate(body.earnedDate)
      if (!line || typeof body.included !== 'boolean' || !earnedDate || earnedDate > today()) fail('Choose an applied adjustment, its earned date, and basic-pay classification.')
      yearValue(earnedDate.slice(0, 4))
      yearValue(earnedDate.slice(0, 4))
      await connection.execute(`INSERT INTO thirteenth_month_review(AdjustmentLineID,IncludedInBasic,EarnedDate,Reason,ReviewedBy) VALUES(?,?,?,?,?)
        ON DUPLICATE KEY UPDATE IncludedInBasic=VALUES(IncludedInBasic),EarnedDate=VALUES(EarnedDate),Reason=VALUES(Reason),ReviewedBy=VALUES(ReviewedBy),ReviewedAt=NOW()`,
      [line.AdjustmentLineID, body.included ? 1 : 0, earnedDate, reason, session.sub])
      await ensureHeader()
    } else if (action === 'save' || action === 'approve') {
      const start = annualDate(body.coverageStart), end = annualDate(body.coverageEnd)
      if (!start || !end || start > end || start.slice(0, 4) !== String(year) || end.slice(0, 4) !== String(year)) fail('Select reviewed employment coverage within the selected year.')
      const summary = annualSummary(person.sources, start, end, person.releases)
      if (action === 'approve') {
        if (header?.Status !== 'Draft') fail('Save a draft before approving.', 409)
        if (body.eligibilityConfirmed !== true) fail('Confirm rank-and-file eligibility and at least one month of service.')
        if (summary.gaps.length || summary.issues.length) fail('Resolve missing coverage and source review notes before approval.', 409)
        if (!person.sources.length || summary.entitlement <= 0) fail('There are no positive basic earnings to approve.')
        if (end > today()) fail('Review actual coverage through the latest completed period. Future coverage cannot be approved.')
      }
      await ensureHeader()
      const status = action === 'approve' ? (summary.balance <= 0 ? 'Released' : 'Approved') : 'Draft'
      const releaseDate = status === 'Released' ? person.releases.filter((row: any) => row.Status === 'Active').map((row: any) => row.PaymentDate).sort().at(-1) || null : null
      const snapshot = { year, employeeId, agencyId, employeeName: person.EmployeeName, agencyName: person.AgencyName, coverageStart: start, coverageEnd: end, sources: person.sources, summary }
      await connection.execute(`UPDATE thirteenth_month_pay SET TotalBasicEarned=?,ThirteenthMonthAmount=?,CoverageStart=?,CoverageEnd=?,
        SourceHash=?,SnapshotJson=?,ComputedDate=?,ReviewNote=?,EligibilityConfirmed=?,Status=?,ApprovedBy=?,ApprovedAt=IF(?='Draft',NULL,NOW()),ReleasedDate=?,Revision=Revision+1
        WHERE ThirteenthMonthID=?`, [summary.basicEarned, summary.entitlement, start, end, person.sourceHash, JSON.stringify(snapshot), today(), reason, body.eligibilityConfirmed === true ? 1 : 0,
        status, action === 'approve' ? session.sub : null, status, releaseDate, recordId])
    } else if (action === 'reopen') {
      if (!header || header.Status === 'Draft') fail('Choose an approved or released computation to reopen.', 409)
      await connection.execute("UPDATE thirteenth_month_pay SET Status='Draft',ApprovedBy=NULL,ApprovedAt=NULL,ReleasedDate=NULL,Revision=Revision+1 WHERE ThirteenthMonthID=?", [recordId])
    } else if (action === 'release' || action === 'previous-payment') {
      const gross = amount(body.amount, true), withholding = amount(body.withholding ?? 0)
      if (withholding < 0 || withholding > gross) fail('Withholding must be between zero and the gross release amount.')
      const date = annualDate(body.paymentDate), reference = text(body.reference, 3, 150)
      if (!date || date < `${year}-01-01` || date > today()) fail('Choose an actual payment date on or after the start of the pay year, not in the future.')
      if (action === 'release') {
        if (!header || header.Status !== 'Approved' || person.sourceChanged) fail('Approve the current earnings basis before recording a release.', 409)
        if (annualCents(gross) > annualCents(header.ThirteenthMonthAmount) - annualCents(person.summary.paid)) fail('The release exceeds the remaining approved entitlement.', 409)
      }
      if (body.paymentConfirmed !== true) fail('Confirm that this payment was actually made. This action does not transfer money.')
      await ensureHeader()
      const [[duplicate]] = await connection.execute<any[]>('SELECT ReleaseID FROM thirteenth_month_release WHERE ThirteenthMonthID=? AND Reference=?', [recordId, reference])
      if (duplicate) fail('This payment reference is already recorded.', 409)
      await connection.execute(`INSERT INTO thirteenth_month_release(ThirteenthMonthID,Amount,Withholding,NetAmount,PaymentDate,Reference,Reason,EntryKind,CreatedBy)
        VALUES(?,?,?,?,?,?,?,?,?)`, [recordId, gross, withholding, (annualCents(gross) - annualCents(withholding)) / 100, date, reference, reason, action === 'release' ? 'Release' : 'Previous payment', session.sub])
      if (header?.Status === 'Approved' && annualCents(person.summary.paid) + annualCents(gross) >= annualCents(header.ThirteenthMonthAmount)) {
        await connection.execute("UPDATE thirteenth_month_pay SET Status='Released',ReleasedDate=? WHERE ThirteenthMonthID=?", [date, recordId])
      }
    } else if (action === 'void-payment') {
      if (!header) fail('Annual record not found.', 404)
      const [result] = await connection.execute<any>(`UPDATE thirteenth_month_release SET Status='Voided',VoidedBy=?,VoidedAt=NOW(),VoidReason=?
        WHERE ReleaseID=? AND ThirteenthMonthID=? AND Status='Active'`, [session.sub, reason, id(body.releaseId), recordId])
      if (!result.affectedRows) fail('Active payment not found.', 404)
      await connection.execute("UPDATE thirteenth_month_pay SET Status=IF(Status='Draft','Draft','Approved'),ReleasedDate=NULL WHERE ThirteenthMonthID=?", [recordId])
    }
    if (!['save', 'approve', 'reopen'].includes(action)) await connection.execute('UPDATE thirteenth_month_pay SET Revision=Revision+1 WHERE ThirteenthMonthID=?', [recordId])
    await connection.execute('INSERT INTO thirteenth_month_event(ThirteenthMonthID,Action,ActorID,Reason,SnapshotJson) VALUES(?,?,?,?,?)',
      [recordId, auditAction, session.sub, reason, JSON.stringify({ sourceHash: person?.sourceHash, summaryBefore: person?.summary, sourcesBefore: person?.sources,
        details: { coverageStart: body.coverageStart, coverageEnd: body.coverageEnd, eligibilityConfirmed: body.eligibilityConfirmed,
          rows: action === 'import' ? body.rows : undefined, earningId: body.earningId, lineId: body.lineId, included: body.included, earnedDate: body.earnedDate,
          releaseId: body.releaseId, amount: body.amount, withholding: body.withholding, paymentDate: body.paymentDate, reference: body.reference } })])
    await connection.commit()
    return { success: true, recordId }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}
