import { createError, getQuery, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

type Body = Record<string, unknown>
type Status = 'Draft' | 'For Approval' | 'Approved' | 'Applied' | 'Rejected' | 'Cancelled'

const earningComponents = [
  ['RegularHours', 'RegularRate', 'Regular hours'],
  ['OTHours', 'OTRate', 'Regular OT'],
  ['OTExtHours', 'OTExtRate', 'OT extension'],
  ['NightDiffHours', 'NightDiffRate', 'Night differential'],
  ['RestDayHours', 'RestDayRate', 'Rest day hours'],
  ['RestDayOTHours', 'RestDayOTRate', 'Rest day OT'],
  ['LegalHolidayHours', 'LegalHolidayRate', 'Legal holiday hours'],
  ['LegalHolidayOTHours', 'LegalHolidayOTRate', 'Legal holiday OT'],
  ['RestDayLegalHolidayHours', 'LegalHolidayRate', 'Rest day legal holiday'],
  ['RestDayLegalHolidayOTHours', 'LegalHolidayOTRate', 'Rest day legal holiday OT'],
  ['SpecialHolidayHours', 'SpecialHolidayRate', 'Special holiday hours'],
  ['SpecialHolidayOTHours', 'SpecialHolidayOTRate', 'Special holiday OT'],
  ['RestDaySpecialHolidayHours', 'SpecialHolidayRate', 'Rest day special holiday'],
  ['RestDaySpecialHolidayOTHours', 'SpecialHolidayOTRate', 'Rest day special holiday OT'],
] as const

const deductionComponents = [
  ['LateHours', 'LateDeduction', 'Late deduction'],
  ['UndertimeHours', 'UndertimeDeduction', 'Undertime deduction'],
  ['BreakHours', 'BreakDeduction', 'Break deduction'],
] as const

function positiveId(value: unknown, label: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: `${label} is required.` })
  return id
}

function dateOnly(value: unknown) {
  if (value instanceof Date) return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0')
  return String(value || '').slice(0, 10)
}

function assertCanWrite(userType: unknown) {
  if (String(userType) === 'Viewer') throw createError({ statusCode: 403, statusMessage: 'Viewer accounts cannot change payroll adjustments.' })
}

function assertCanApprove(userType: unknown) {
  if (!['Admin', 'Supervisor'].includes(String(userType))) throw createError({ statusCode: 403, statusMessage: 'Only an Admin or Supervisor can approve or reject payroll adjustments.' })
}

function permissions(userType: unknown) {
  return { canCreate: String(userType) !== 'Viewer', canApprove: ['Admin', 'Supervisor'].includes(String(userType)) }
}

function cleanReason(value: unknown) {
  const reason = String(value || '').trim()
  if (reason.length < 5) throw createError({ statusCode: 400, statusMessage: 'Enter a clear reason with at least 5 characters.' })
  if (reason.length > 500) throw createError({ statusCode: 400, statusMessage: 'Reason must not exceed 500 characters.' })
  return reason
}

function selectedDates(value: unknown) {
  if (!Array.isArray(value)) return []
  const dates = [...new Set(value.map(item => String(item || '').trim()))]
  if (dates.length > 31 || dates.some(item => !/^\d{4}-\d{2}-\d{2}$/.test(item))) throw createError({ statusCode: 400, statusMessage: 'Select valid original attendance dates.' })
  return dates.sort()
}

async function assertReady(connection: any) {
  const [rows] = await connection.execute<any[]>(`SELECT COUNT(*) AS TableCount FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN ('payroll_adjustment', 'payroll_adjustment_line')`)
  if (Number(rows[0]?.TableCount || 0) !== 2) throw createError({ statusCode: 503, statusMessage: 'Payroll adjustments are not installed. Apply database/payroll-adjustments.sql first.' })
}

function listFilters(query: Record<string, string | undefined>) {
  const filters: string[] = []
  const values: any[] = []
  if (query.sourceBatchId) { filters.push('pa.SourceBatchID = ?'); values.push(positiveId(query.sourceBatchId, 'Source DTR')) }
  if (query.targetBatchId) { filters.push('pa.TargetBatchID = ?'); values.push(positiveId(query.targetBatchId, 'Target DTR')) }
  if (query.employeeId) { filters.push('pa.EmployeeID = ?'); values.push(positiveId(query.employeeId, 'Employee')) }
  if (query.status) {
    const allowed: Status[] = ['Draft', 'For Approval', 'Approved', 'Applied', 'Rejected', 'Cancelled']
    if (!allowed.includes(query.status as Status)) throw createError({ statusCode: 400, statusMessage: 'Invalid adjustment status.' })
    filters.push('pa.Status = ?'); values.push(query.status)
  }
  if (query.search?.trim()) {
    const search = `%${query.search.trim()}%`
    filters.push(`(e.EmployeeNumber LIKE ? OR e.FirstName LIKE ? OR e.LastName LIKE ? OR pa.Reason LIKE ? OR CAST(pa.AdjustmentID AS CHAR) LIKE ?)`)
    values.push(search, search, search, search, search)
  }
  return { filters, values }
}

export async function listPayrollAdjustments(event: any) {
  const session = requireSession(event)
  const query = getQuery(event) as Record<string, string | undefined>
  const connection = await pool.getConnection()
  try {
    await assertReady(connection)
    const { filters, values } = listFilters(query)
    const [items] = await connection.execute<any[]>(`SELECT pa.AdjustmentID, pa.EmployeeID, pa.SourceBatchID, pa.TargetBatchID, pa.AdjustmentType,
      pa.Reason, pa.VerificationReference, pa.Status, pa.TotalAmount, pa.TargetPayrollID, pa.Revision, pa.CreatedAt, pa.SubmittedAt, pa.ApprovedAt,
      e.EmployeeNumber, CONCAT_WS(', ', e.LastName, CONCAT_WS(' ', e.FirstName, e.MiddleName)) AS EmployeeName,
      source.PeriodStart AS SourcePeriodStart, source.PeriodEnd AS SourcePeriodEnd, source.Status AS SourceDtrStatus,
      sourceAgency.AgencyName, sourceClient.ClientName, sourceSite.SiteName,
      target.PeriodStart AS TargetPeriodStart, target.PeriodEnd AS TargetPeriodEnd, target.Status AS TargetDtrStatus,
      CONCAT_WS(' ', creator.FirstName, creator.LastName) AS CreatedByName,
      CONCAT_WS(' ', approver.FirstName, approver.LastName) AS ApprovedByName
      FROM payroll_adjustment pa
      INNER JOIN employee e ON e.EmployeeID = pa.EmployeeID
      INNER JOIN attendance_dtr source ON source.BatchID = pa.SourceBatchID
      INNER JOIN attendance_dtr target ON target.BatchID = pa.TargetBatchID
      INNER JOIN agency sourceAgency ON sourceAgency.AgencyID = source.AgencyID
      INNER JOIN client sourceClient ON sourceClient.ClientID = source.ClientID
      INNER JOIN site sourceSite ON sourceSite.SiteID = source.SiteID
      LEFT JOIN \`user\` creator ON creator.UserID = pa.CreatedBy
      LEFT JOIN \`user\` approver ON approver.UserID = pa.ApprovedBy
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY pa.CreatedAt DESC, pa.AdjustmentID DESC LIMIT 250`, values)
    const ids = items.map(item => Number(item.AdjustmentID))
    const lines = ids.length ? await connection.execute<any[]>(`SELECT AdjustmentLineID, AdjustmentID, SourceAttendanceID, SourceDate,
      ComponentCode, Description, EntrySource, Direction, Quantity, Rate, Amount FROM payroll_adjustment_line
      WHERE AdjustmentID IN (${ids.map(() => '?').join(', ')}) ORDER BY SourceDate, AdjustmentLineID`, ids).then(([rows]) => rows) : []
    const lineMap = new Map<number, any[]>()
    for (const line of lines) {
      const id = Number(line.AdjustmentID), current = lineMap.get(id) || []
      current.push({ ...line, SourceDate: dateOnly(line.SourceDate) }); lineMap.set(id, current)
    }
    const sourceBatchId = query.sourceBatchId ? positiveId(query.sourceBatchId, 'Source DTR') : null
    const targetBatchId = query.targetBatchId ? positiveId(query.targetBatchId, 'Target DTR') : null
    const employeeId = query.employeeId ? positiveId(query.employeeId, 'Employee') : null
    let eligibleDates: any[] = [], targetBatches: any[] = [], sourceBatches: any[] = [], targetEmployees: any[] = []
    if (targetBatchId) {
      const [[target]] = await connection.execute<any[]>('SELECT BatchID, AgencyID, PeriodStart, PeriodEnd, Status FROM attendance_dtr WHERE BatchID = ?', [targetBatchId])
      if (target) {
        ;[targetEmployees] = await connection.execute<any[]>(`SELECT e.EmployeeID, e.EmployeeNumber,
          CONCAT_WS(', ', e.LastName, CONCAT_WS(' ', e.FirstName, e.MiddleName)) AS EmployeeName
          FROM attendance_dtr_employee roster
          INNER JOIN employee e ON e.EmployeeID = roster.EmployeeID
          WHERE roster.BatchID = ? ORDER BY e.LastName, e.FirstName, e.EmployeeID`, [targetBatchId])
        if (employeeId) {
          ;[sourceBatches] = await connection.execute<any[]>(`SELECT source.BatchID, source.PeriodStart, source.PeriodEnd, source.Status,
            c.ClientName, s.SiteName, COUNT(DISTINCT at.AttendanceID) AS AttendanceCount
            FROM attendance_dtr source
            INNER JOIN attendance_dtr_employee roster ON roster.BatchID = source.BatchID AND roster.EmployeeID = ?
            INNER JOIN attendance at ON at.BatchID = source.BatchID AND at.EmployeeID = ? AND (
              COALESCE(at.RegularHours, 0) + COALESCE(at.OTHours, 0) + COALESCE(at.OTExtHours, 0) +
              COALESCE(at.NightDiffHours, 0) + COALESCE(at.RestDayHours, 0) + COALESCE(at.RestDayOTHours, 0) +
              COALESCE(at.LegalHolidayHours, 0) + COALESCE(at.LegalHolidayOTHours, 0) +
              COALESCE(at.RestDayLegalHolidayHours, 0) + COALESCE(at.RestDayLegalHolidayOTHours, 0) +
              COALESCE(at.SpecialHolidayHours, 0) + COALESCE(at.SpecialHolidayOTHours, 0) +
              COALESCE(at.RestDaySpecialHolidayHours, 0) + COALESCE(at.RestDaySpecialHolidayOTHours, 0)
            ) > 0
            INNER JOIN client c ON c.ClientID = source.ClientID
            INNER JOIN site s ON s.SiteID = source.SiteID
            WHERE source.AgencyID = ? AND source.PeriodEnd < ?
            GROUP BY source.BatchID, source.PeriodStart, source.PeriodEnd, source.Status, c.ClientName, s.SiteName
            ORDER BY source.PeriodEnd DESC, source.BatchID DESC`, [employeeId, employeeId, target.AgencyID, dateOnly(target.PeriodStart)])
        }
      }
    }
    if (sourceBatchId && employeeId) {
      const [[source]] = await connection.execute<any[]>('SELECT BatchID, AgencyID, PeriodStart, PeriodEnd FROM attendance_dtr WHERE BatchID = ?', [sourceBatchId])
      if (source) {
        const earningColumns = earningComponents.map(([hours]) => `at.${hours}`).join(', ')
        const deductionColumns = deductionComponents.map(([hours]) => `at.${hours}`).join(', ')
        ;[eligibleDates] = await connection.execute<any[]>(`SELECT at.AttendanceID, at.AttendanceDate, at.AttendanceStatus,
          ${earningColumns}, ${deductionColumns},
          existing.AdjustmentID AS ExistingAdjustmentID, existingHeader.Status AS ExistingAdjustmentStatus
          FROM attendance at
          LEFT JOIN payroll_adjustment_line existing ON existing.SourceAttendanceID = at.AttendanceID
          LEFT JOIN payroll_adjustment existingHeader ON existingHeader.AdjustmentID = existing.AdjustmentID
          WHERE at.BatchID = ? AND at.EmployeeID = ? AND (
            ${earningComponents.map(([hours]) => `COALESCE(at.${hours}, 0)`).join(' + ')}
          ) > 0
          GROUP BY at.AttendanceID, existing.AdjustmentID, existingHeader.Status
          ORDER BY at.AttendanceDate`, [sourceBatchId, employeeId])
        ;[targetBatches] = await connection.execute<any[]>(`SELECT target.BatchID, target.PeriodStart, target.PeriodEnd, target.Status,
          c.ClientName, s.SiteName
          FROM attendance_dtr target
          INNER JOIN attendance_dtr_employee roster ON roster.BatchID = target.BatchID AND roster.EmployeeID = ?
          INNER JOIN client c ON c.ClientID = target.ClientID
          INNER JOIN site s ON s.SiteID = target.SiteID
          WHERE target.AgencyID = ? AND target.PeriodStart > ? AND target.Status <> 'Locked'
          ORDER BY target.PeriodStart, target.BatchID`, [employeeId, source.AgencyID, dateOnly(source.PeriodEnd)])
      }
    }
    return {
      items: items.map(item => ({ ...item, SourcePeriodStart: dateOnly(item.SourcePeriodStart), SourcePeriodEnd: dateOnly(item.SourcePeriodEnd), TargetPeriodStart: dateOnly(item.TargetPeriodStart), TargetPeriodEnd: dateOnly(item.TargetPeriodEnd), Lines: lineMap.get(Number(item.AdjustmentID)) || [] })),
      eligibleDates: eligibleDates.map(item => ({ ...item, AttendanceDate: dateOnly(item.AttendanceDate) })),
      targetBatches: targetBatches.map(item => ({ ...item, PeriodStart: dateOnly(item.PeriodStart), PeriodEnd: dateOnly(item.PeriodEnd) })),
      sourceBatches: sourceBatches.map(item => ({ ...item, PeriodStart: dateOnly(item.PeriodStart), PeriodEnd: dateOnly(item.PeriodEnd) })),
      targetEmployees,
      permissions: permissions(session.userType),
    }
  } finally { connection.release() }
}

export async function createPayrollAdjustment(event: any) {
  const session = requireSession(event); assertCanWrite(session.userType)
  const body = await readBody<Body>(event) || {}
  const employeeId = positiveId(body.EmployeeID, 'Employee')
  const sourceBatchId = positiveId(body.SourceBatchID, 'Source DTR')
  const targetBatchId = positiveId(body.TargetBatchID, 'Target cutoff')
  const dates = selectedDates(body.SourceDates)
  if (!dates.length) throw createError({ statusCode: 400, statusMessage: 'Select at least one saved attendance date from the original cutoff.' })
  const reason = cleanReason(body.Reason)
  const submit = body.Submit === true
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction(); await assertReady(connection)
    const [[source]] = await connection.execute<any[]>(`SELECT source.BatchID, source.AgencyID, source.SiteID, source.PeriodStart, source.PeriodEnd, source.Status,
      EXISTS (SELECT 1 FROM attendance_dtr_employee roster WHERE roster.BatchID = source.BatchID AND roster.EmployeeID = ?) AS HasEmployee
      FROM attendance_dtr source WHERE source.BatchID = ? FOR UPDATE`, [employeeId, sourceBatchId])
    if (!source) throw createError({ statusCode: 404, statusMessage: 'Source DTR not found.' })
    if (!Number(source.HasEmployee)) throw createError({ statusCode: 400, statusMessage: 'The employee does not belong to the source DTR.' })
    const [[target]] = await connection.execute<any[]>(`SELECT target.BatchID, target.AgencyID, target.PeriodStart, target.PeriodEnd, target.Status,
      EXISTS (SELECT 1 FROM attendance_dtr_employee roster WHERE roster.BatchID = target.BatchID AND roster.EmployeeID = ?) AS HasEmployee
      FROM attendance_dtr target WHERE target.BatchID = ? FOR UPDATE`, [employeeId, targetBatchId])
    if (!target) throw createError({ statusCode: 404, statusMessage: 'Target cutoff not found.' })
    if (Number(target.AgencyID) !== Number(source.AgencyID) || dateOnly(target.PeriodStart) <= dateOnly(source.PeriodEnd)) throw createError({ statusCode: 400, statusMessage: 'Choose a later cutoff under the same agency.' })
    if (!Number(target.HasEmployee)) throw createError({ statusCode: 400, statusMessage: 'Add the employee to the target DTR before assigning this adjustment.' })
    if (target.Status === 'Locked') throw createError({ statusCode: 409, statusMessage: 'The target cutoff is already locked.' })
    if (dates.some(item => item < dateOnly(source.PeriodStart) || item > dateOnly(source.PeriodEnd))) throw createError({ statusCode: 400, statusMessage: 'Every original date must be inside the source DTR cutoff.' })

    const attendance = dates.length ? await connection.execute<any[]>(`SELECT at.AttendanceID, at.AttendanceDate,
      ${[...earningComponents, ...deductionComponents].map(([hours, rate]) => `at.${hours}, pr.${rate}`).join(', ')},
      at.WorkPayrollRegularRate
      FROM attendance at
      INNER JOIN employee_deployment ed ON ed.DeploymentID = at.DeploymentID
      INNER JOIN site_rate sr ON sr.SiteRateID = COALESCE(at.WorkSiteRateID, ed.SiteRateID)
      INNER JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
      WHERE at.BatchID = ? AND at.EmployeeID = ? AND at.AttendanceDate IN (${dates.map(() => '?').join(', ')})
      ORDER BY at.AttendanceDate FOR UPDATE`, [sourceBatchId, employeeId, ...dates]).then(([rows]) => rows) : []
    if (attendance.length !== dates.length) throw createError({ statusCode: 400, statusMessage: 'Each selected date must have a saved attendance record in the source DTR.' })

    const lines: any[] = []
    for (const row of attendance) {
      const sourceDate = dateOnly(row.AttendanceDate)
      for (const [component, rateField, label] of earningComponents) {
        const quantity = Number(row[component] || 0)
        if (!quantity) continue
        const rate = Number(component === 'RegularHours' && row.WorkPayrollRegularRate != null ? row.WorkPayrollRegularRate : row[rateField] || 0)
        lines.push({ attendanceId: Number(row.AttendanceID), sourceDate, component, label, entrySource: 'DTR Snapshot', direction: 'Earning', quantity, rate, amount: Math.round(quantity * rate * 100) / 100 })
      }
      for (const [component, rateField, label] of deductionComponents) {
        const quantity = Number(row[component] || 0)
        if (!quantity) continue
        const rate = Number(row[rateField] || 0)
        lines.push({ attendanceId: Number(row.AttendanceID), sourceDate, component, label, entrySource: 'DTR Snapshot', direction: 'Deduction', quantity, rate, amount: -Math.round(quantity * rate * 100) / 100 })
      }
    }
    if (!lines.length) throw createError({ statusCode: 400, statusMessage: 'The selected dates have no payable attendance components.' })
    const attendanceIds = [...new Set(lines.map(line => line.attendanceId).filter(Boolean))]
    const [duplicates] = await connection.execute<any[]>(`SELECT pal.SourceDate, pal.ComponentCode, pa.AdjustmentID, pa.Status
      FROM payroll_adjustment_line pal INNER JOIN payroll_adjustment pa ON pa.AdjustmentID = pal.AdjustmentID
      WHERE pal.SourceAttendanceID IN (${attendanceIds.map(() => '?').join(', ')}) FOR UPDATE`, attendanceIds)
    if (duplicates.length) throw createError({ statusCode: 409, statusMessage: `An adjustment already claims ${dateOnly(duplicates[0].SourceDate)} ${duplicates[0].ComponentCode}. Open adjustment #${duplicates[0].AdjustmentID} instead.` })

    const total = Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100
    const status: Status = submit ? 'For Approval' : 'Draft'
    const [result] = await connection.execute<any>(`INSERT INTO payroll_adjustment
      (EmployeeID, SourceBatchID, TargetBatchID, AdjustmentType, Reason, VerificationReference, Status, TotalAmount, CreatedBy, SubmittedBy, SubmittedAt)
      VALUES (?, ?, ?, 'Missed Attendance Pay', ?, NULL, ?, ?, ?, ?, ?)`, [employeeId, sourceBatchId, targetBatchId, reason, status, total, session.sub, submit ? session.sub : null, submit ? new Date() : null])
    for (const line of lines) {
      await connection.execute(`INSERT INTO payroll_adjustment_line
        (AdjustmentID, SourceAttendanceID, SourceDate, ComponentCode, Description, EntrySource, Direction, Quantity, Rate, Amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [result.insertId, line.attendanceId, line.sourceDate, line.component, `${line.label} - ${line.sourceDate}`, line.entrySource, line.direction, line.quantity, line.rate, line.amount])
    }
    await connection.commit()
    return { id: result.insertId, status, totalAmount: total, lineCount: lines.length }
  } catch (error: any) {
    await connection.rollback()
    if (error?.code === 'ER_DUP_ENTRY') throw createError({ statusCode: 409, statusMessage: 'One of these attendance components already belongs to another adjustment.' })
    throw error
  } finally { connection.release() }
}

export async function updatePayrollAdjustment(event: any) {
  const session = requireSession(event); assertCanWrite(session.userType)
  const body = await readBody<Body>(event) || {}
  const adjustmentId = positiveId(body.AdjustmentID, 'Adjustment')
  const action = String(body.Action || '').toLowerCase()
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction(); await assertReady(connection)
    const [[current]] = await connection.execute<any[]>('SELECT AdjustmentID, Status, TargetPayrollID, Revision FROM payroll_adjustment WHERE AdjustmentID = ? FOR UPDATE', [adjustmentId])
    if (!current) throw createError({ statusCode: 404, statusMessage: 'Payroll adjustment not found.' })
    if (current.TargetPayrollID || current.Status === 'Applied') throw createError({ statusCode: 409, statusMessage: 'An applied payroll adjustment is locked. Create a reversal adjustment for another correction.' })
    let nextStatus: Status
    let extraSql = ''
    const values: any[] = []
    if (action === 'submit' && current.Status === 'Draft') {
      nextStatus = 'For Approval'; extraSql = ', SubmittedBy = ?, SubmittedAt = NOW(), ApprovedBy = NULL, ApprovedAt = NULL'; values.push(session.sub)
    } else if (action === 'approve' && current.Status === 'For Approval') {
      assertCanApprove(session.userType); nextStatus = 'Approved'; extraSql = ', ApprovedBy = ?, ApprovedAt = NOW()'; values.push(session.sub)
    } else if (action === 'reject' && current.Status === 'For Approval') {
      assertCanApprove(session.userType); nextStatus = 'Rejected'; extraSql = ', ApprovedBy = ?, ApprovedAt = NOW()'; values.push(session.sub)
    } else if (action === 'cancel' && ['Draft', 'For Approval', 'Approved'].includes(current.Status)) {
      nextStatus = 'Cancelled'
    } else if (action === 'reopen' && ['Rejected', 'Cancelled'].includes(current.Status)) {
      nextStatus = 'Draft'; extraSql = ', SubmittedBy = NULL, SubmittedAt = NULL, ApprovedBy = NULL, ApprovedAt = NULL'
    } else {
      throw createError({ statusCode: 409, statusMessage: `Cannot ${action || 'update'} an adjustment with status ${current.Status}.` })
    }
    await connection.execute(`UPDATE payroll_adjustment SET Status = ?, Revision = Revision + 1, UpdatedBy = ?${extraSql} WHERE AdjustmentID = ?`, [nextStatus, session.sub, ...values, adjustmentId])
    await connection.commit(); return { success: true, status: nextStatus, revision: Number(current.Revision) + 1 }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}
