import { createError, getQuery, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

type Body = Record<string, unknown>
type Status = 'Draft' | 'For Approval' | 'Approved' | 'Ready for Payroll' | 'Applied' | 'Rejected' | 'Cancelled'

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

const manualComponents = earningComponents.slice(0, 4)
function manualDays(value: unknown) {
  if (!Array.isArray(value)) return []
  if (value.length > 31) throw createError({ statusCode: 400, statusMessage: 'Select no more than 31 missed dates.' })
  const dates = new Set<string>()
  return value.map((entry: any) => {
    const sourceDate = String(entry?.SourceDate || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) || dateOnly(new Date(`${sourceDate}T00:00:00`)) !== sourceDate || dates.has(sourceDate)) {
      throw createError({ statusCode: 400, statusMessage: 'Enter distinct valid missed attendance dates.' })
    }
    dates.add(sourceDate)
    const shiftCodeId = entry?.ShiftCodeID == null || entry.ShiftCodeID === '' ? null : positiveId(entry.ShiftCodeID, 'Shift code')
    const hours: Record<string, number> = {}
    for (const [component] of manualComponents) {
      const raw = entry[component]
      const amount = Number(raw)
      if (raw === '' || raw == null || !Number.isFinite(amount) || amount < 0 || amount > 24 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001) {
        throw createError({ statusCode: 400, statusMessage: `${component} must be between 0 and 24 hours, with at most two decimal places.` })
      }
      hours[component] = amount
    }
    const worked = hours.RegularHours + hours.OTHours + hours.OTExtHours
    if (worked <= 0 || worked > 24 || hours.NightDiffHours > worked) throw createError({ statusCode: 400, statusMessage: 'Each missed day needs worked hours (at most 24); night differential cannot exceed worked hours.' })
    return { sourceDate, shiftCodeId, hours }
  })
}

function periodDates(start: unknown, end: unknown) {
  const dates: string[] = []
  const cursor = new Date(`${dateOnly(start)}T00:00:00Z`)
  const last = dateOnly(end)
  while (cursor.toISOString().slice(0, 10) <= last && dates.length < 31) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

async function excludedManualDates(connection: any, source: any) {
  const [holidays] = await connection.execute<any[]>(`SELECT h.HolidayDate, h.HolidayType, h.HolidayName, h.Recurring,
    ssh.SiteSpecialHolidayID FROM holiday h
    LEFT JOIN site_special_holiday ssh ON ssh.HolidayID = h.HolidayID AND ssh.SiteID = ?
    WHERE h.Status = 'Active' AND (h.HolidayType = 'Legal' OR ssh.SiteSpecialHolidayID IS NOT NULL)`, [source.SiteID])
  const excluded = new Map<string, string>()
  for (const day of periodDates(source.PeriodStart, source.PeriodEnd)) {
    if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) excluded.set(day, 'Sunday requires rest-day treatment; correct it through a reviewed payroll calculation.')
    const holiday = holidays.find(item => {
      const holidayDate = dateOnly(item.HolidayDate)
      return holidayDate === day || (Number(item.Recurring) === 1 && holidayDate.slice(5) === day.slice(5))
    })
    if (holiday) excluded.set(day, `${holiday.HolidayType} holiday (${holiday.HolidayName}) requires holiday rates.`)
  }
  return excluded
}

async function assertReady(connection: any) {
  const [rows] = await connection.execute<any[]>(`SELECT COUNT(*) AS TableCount FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN ('payroll_adjustment', 'payroll_adjustment_line', 'payroll_adjustment_manual_day')`)
  if (Number(rows[0]?.TableCount || 0) !== 3) throw createError({ statusCode: 503, statusMessage: 'Payroll adjustments are not installed. Run scripts/apply-payroll-adjustments.mjs first.' })
}

function listFilters(query: Record<string, string | undefined>) {
  const filters: string[] = []
  const values: any[] = []
  if (query.sourceBatchId) { filters.push('pa.SourceBatchID = ?'); values.push(positiveId(query.sourceBatchId, 'Source DTR')) }
  if (query.targetBatchId) { filters.push('pa.TargetBatchID = ?'); values.push(positiveId(query.targetBatchId, 'Target DTR')) }
  if (query.employeeId) { filters.push('pa.EmployeeID = ?'); values.push(positiveId(query.employeeId, 'Employee')) }
  if (query.status) {
    const allowed: Status[] = ['Draft', 'For Approval', 'Approved', 'Ready for Payroll', 'Applied', 'Rejected', 'Cancelled']
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
    let missedDates: any[] = [], shiftCodes: any[] = []
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
            LEFT JOIN attendance at ON at.BatchID = source.BatchID AND at.EmployeeID = ? AND (
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
      const [[source]] = await connection.execute<any[]>('SELECT BatchID, AgencyID, SiteID, PeriodStart, PeriodEnd, Status FROM attendance_dtr WHERE BatchID = ?', [sourceBatchId])
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
        const [saved] = await connection.execute<any[]>(`SELECT AttendanceDate, AttendanceStatus,
          ${earningComponents.map(([hours]) => `COALESCE(${hours}, 0)`).join(' + ')} AS PayableHours
          FROM attendance WHERE BatchID = ? AND EmployeeID = ?`, [sourceBatchId, employeeId])
        const [claims] = await connection.execute<any[]>(`SELECT md.SourceDate, md.AdjustmentID, pa.Status
          FROM payroll_adjustment_manual_day md INNER JOIN payroll_adjustment pa ON pa.AdjustmentID = md.AdjustmentID
          WHERE md.SourceBatchID = ? AND md.EmployeeID = ? AND md.ClaimActive = 1`, [sourceBatchId, employeeId])
        const savedByDate = new Map(saved.map(item => [dateOnly(item.AttendanceDate), item]))
        const claimsByDate = new Map(claims.map(item => [dateOnly(item.SourceDate), item]))
        const excluded = await excludedManualDates(connection, source)
        missedDates = periodDates(source.PeriodStart, source.PeriodEnd).map(day => ({
          SourceDate: day, AttendanceStatus: savedByDate.get(day)?.AttendanceStatus || null,
          PayableHours: Number(savedByDate.get(day)?.PayableHours || 0),
          ExistingAdjustmentID: claimsByDate.get(day)?.AdjustmentID || null,
          ExistingAdjustmentStatus: claimsByDate.get(day)?.Status || null,
          UnavailableReason: source.Status === 'Draft' ? 'Edit this date in the original Draft DTR.' : excluded.get(day) || null,
        }))
        ;[shiftCodes] = await connection.execute<any[]>(`SELECT ShiftCodeID, ShiftCode, ShiftName, RegularHours, RegularOTCap
          FROM shift_code WHERE AgencyID = ? AND Status = 'Active' ORDER BY ShiftCode`, [source.AgencyID])
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
      missedDates,
      shiftCodes,
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
  const verifiedDays = manualDays(body.ManualDays)
  if (Boolean(dates.length) === Boolean(verifiedDays.length)) throw createError({ statusCode: 400, statusMessage: 'Select saved attendance dates or verified missed days, but not both.' })
  const verificationReference = String(body.VerificationReference || '').trim()
  if (verifiedDays.length && (verificationReference.length < 5 || verificationReference.length > 255)) throw createError({ statusCode: 400, statusMessage: 'Enter a verification reference (5–255 characters) for missed days.' })
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
    if (verifiedDays.some(item => item.sourceDate < dateOnly(source.PeriodStart) || item.sourceDate > dateOnly(source.PeriodEnd))) throw createError({ statusCode: 400, statusMessage: 'Every missed date must be inside the original cutoff.' })

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
    if (verifiedDays.length) {
      if (source.Status === 'Draft') throw createError({ statusCode: 409, statusMessage: 'The original DTR is still Draft. Add the missed days there before finalizing it.' })
      const excluded = await excludedManualDates(connection, source)
      const blocked = verifiedDays.find(item => excluded.has(item.sourceDate))
      if (blocked) throw createError({ statusCode: 400, statusMessage: `${blocked.sourceDate}: ${excluded.get(blocked.sourceDate)}` })
      const [existing] = await connection.execute<any[]>(`SELECT AttendanceDate,
        ${earningComponents.map(([hours]) => `COALESCE(${hours}, 0)`).join(' + ')} AS PayableHours
        FROM attendance WHERE BatchID = ? AND EmployeeID = ? AND AttendanceDate IN (${verifiedDays.map(() => '?').join(', ')}) FOR UPDATE`,
      [sourceBatchId, employeeId, ...verifiedDays.map(item => item.sourceDate)])
      if (existing.some(item => Number(item.PayableHours) > 0)) throw createError({ statusCode: 409, statusMessage: 'A selected day already has payable attendance in the original DTR. Use its saved-date adjustment instead.' })
      const [claimed] = await connection.execute<any[]>(`SELECT SourceDate, AdjustmentID FROM payroll_adjustment_manual_day
        WHERE SourceBatchID = ? AND EmployeeID = ? AND ClaimActive = 1 AND SourceDate IN (${verifiedDays.map(() => '?').join(', ')}) FOR UPDATE`,
      [sourceBatchId, employeeId, ...verifiedDays.map(item => item.sourceDate)])
      if (claimed.length) throw createError({ statusCode: 409, statusMessage: `${dateOnly(claimed[0].SourceDate)} already belongs to adjustment #${claimed[0].AdjustmentID}. Open that adjustment instead.` })
      const selectedShiftIds = [...new Set(verifiedDays.map(item => item.shiftCodeId).filter((id): id is number => id != null))]
      const [shifts] = selectedShiftIds.length ? await connection.execute<any[]>(`SELECT ShiftCodeID FROM shift_code
        WHERE AgencyID = ? AND Status = 'Active' AND ShiftCodeID IN (${selectedShiftIds.map(() => '?').join(', ')})`,
      [source.AgencyID, ...selectedShiftIds]) : [[]]
      const allowedShifts = new Set(shifts.map(item => Number(item.ShiftCodeID)))
      if (verifiedDays.some(item => item.shiftCodeId != null && !allowedShifts.has(item.shiftCodeId))) throw createError({ statusCode: 400, statusMessage: 'Choose an active shift code from the original DTR agency, or leave it blank and enter verified hours directly.' })
      const [[rate]] = await connection.execute<any[]>(`SELECT pr.RegularRate, pr.OTRate, pr.OTExtRate, pr.NightDiffRate
        FROM attendance_dtr_employee roster
        INNER JOIN employee_deployment ed ON ed.DeploymentID = roster.DeploymentID
        INNER JOIN site_rate sr ON sr.SiteRateID = ed.SiteRateID
        INNER JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
        WHERE roster.BatchID = ? AND roster.EmployeeID = ?`, [sourceBatchId, employeeId])
      if (!rate) throw createError({ statusCode: 409, statusMessage: 'Original deployment payroll rates are unavailable. Review the employee deployment before creating an adjustment.' })
      for (const day of verifiedDays) for (const [component, rateField, label] of manualComponents) {
        const quantity = day.hours[component]
        if (!quantity) continue
        const hourlyRate = Number(rate[rateField])
        if (!Number.isFinite(hourlyRate) || hourlyRate < 0) throw createError({ statusCode: 409, statusMessage: `${label} rate is unavailable for this deployment.` })
        lines.push({ attendanceId: null, sourceDate: day.sourceDate, component, label, entrySource: 'Manual Verification', direction: 'Earning', quantity, rate: hourlyRate, amount: Math.round(quantity * hourlyRate * 100) / 100 })
      }
    }
    if (!lines.length) throw createError({ statusCode: 400, statusMessage: 'The selected dates have no payable attendance components.' })
    const attendanceIds = [...new Set(lines.map(line => line.attendanceId).filter(Boolean))]
    if (attendanceIds.length) {
      const [duplicates] = await connection.execute<any[]>(`SELECT pal.SourceDate, pal.ComponentCode, pa.AdjustmentID, pa.Status
        FROM payroll_adjustment_line pal INNER JOIN payroll_adjustment pa ON pa.AdjustmentID = pal.AdjustmentID
        WHERE pal.SourceAttendanceID IN (${attendanceIds.map(() => '?').join(', ')}) FOR UPDATE`, attendanceIds)
      if (duplicates.length) throw createError({ statusCode: 409, statusMessage: `An adjustment already claims ${dateOnly(duplicates[0].SourceDate)} ${duplicates[0].ComponentCode}. Open adjustment #${duplicates[0].AdjustmentID} instead.` })
    }

    const total = Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100
    const status: Status = submit ? verifiedDays.length ? 'Ready for Payroll' : 'For Approval' : 'Draft'
    const [result] = await connection.execute<any>(`INSERT INTO payroll_adjustment
      (EmployeeID, SourceBatchID, TargetBatchID, AdjustmentType, Reason, VerificationReference, Status, TotalAmount, CreatedBy, SubmittedBy, SubmittedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [employeeId, sourceBatchId, targetBatchId, verifiedDays.length ? 'Verified Missed Attendance' : 'Missed Attendance Pay', reason, verifiedDays.length ? verificationReference : null, status, total, session.sub, submit ? session.sub : null, submit ? new Date() : null])
    for (const day of verifiedDays) await connection.execute(`INSERT INTO payroll_adjustment_manual_day
      (AdjustmentID, EmployeeID, SourceBatchID, SourceDate, ShiftCodeID, RegularHours, OTHours, OTExtHours, NightDiffHours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [result.insertId, employeeId, sourceBatchId, day.sourceDate, day.shiftCodeId,
      day.hours.RegularHours, day.hours.OTHours, day.hours.OTExtHours, day.hours.NightDiffHours])
    for (const line of lines) {
      await connection.execute(`INSERT INTO payroll_adjustment_line
        (AdjustmentID, SourceAttendanceID, SourceDate, ComponentCode, Description, EntrySource, Direction, Quantity, Rate, Amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [result.insertId, line.attendanceId, line.sourceDate, line.component, `${line.label} - ${line.sourceDate}`, line.entrySource, line.direction, line.quantity, line.rate, line.amount])
    }
    await connection.commit()
    return { id: result.insertId, status, totalAmount: total, lineCount: lines.length }
  } catch (error: any) {
    await connection.rollback()
    if (error?.code === 'ER_DUP_ENTRY') throw createError({ statusCode: 409, statusMessage: 'A selected attendance date or component already belongs to another adjustment.' })
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
    const [[current]] = await connection.execute<any[]>('SELECT AdjustmentID, AdjustmentType, Status, TargetPayrollID, Revision FROM payroll_adjustment WHERE AdjustmentID = ? FOR UPDATE', [adjustmentId])
    if (!current) throw createError({ statusCode: 404, statusMessage: 'Payroll adjustment not found.' })
    if (current.TargetPayrollID || current.Status === 'Applied') throw createError({ statusCode: 409, statusMessage: 'An applied payroll adjustment is locked. Create a reversal adjustment for another correction.' })
    let nextStatus: Status
    let extraSql = ''
    const values: any[] = []
    if (action === 'submit' && current.Status === 'Draft') {
      nextStatus = current.AdjustmentType === 'Verified Missed Attendance' ? 'Ready for Payroll' : 'For Approval'
      extraSql = ', SubmittedBy = ?, SubmittedAt = NOW(), ApprovedBy = NULL, ApprovedAt = NULL'; values.push(session.sub)
    } else if (action === 'approve' && current.Status === 'For Approval' && current.AdjustmentType !== 'Verified Missed Attendance') {
      assertCanApprove(session.userType); nextStatus = 'Approved'; extraSql = ', ApprovedBy = ?, ApprovedAt = NOW()'; values.push(session.sub)
    } else if (action === 'reject' && current.Status === 'For Approval' && current.AdjustmentType !== 'Verified Missed Attendance') {
      assertCanApprove(session.userType); nextStatus = 'Rejected'; extraSql = ', ApprovedBy = ?, ApprovedAt = NOW()'; values.push(session.sub)
    } else if (action === 'cancel' && ['Draft', 'For Approval', 'Approved', 'Ready for Payroll'].includes(current.Status)) {
      nextStatus = 'Cancelled'
    } else if (action === 'reopen' && ['Rejected', 'Cancelled'].includes(current.Status)) {
      nextStatus = 'Draft'; extraSql = ', SubmittedBy = NULL, SubmittedAt = NULL, ApprovedBy = NULL, ApprovedAt = NULL'
    } else {
      throw createError({ statusCode: 409, statusMessage: `Cannot ${action || 'update'} an adjustment with status ${current.Status}.` })
    }
    await connection.execute(`UPDATE payroll_adjustment SET Status = ?, Revision = Revision + 1, UpdatedBy = ?${extraSql} WHERE AdjustmentID = ?`, [nextStatus, session.sub, ...values, adjustmentId])
    if (['Rejected', 'Cancelled'].includes(nextStatus)) await connection.execute('UPDATE payroll_adjustment_manual_day SET ClaimActive = NULL WHERE AdjustmentID = ?', [adjustmentId])
    if (action === 'reopen') await connection.execute('UPDATE payroll_adjustment_manual_day SET ClaimActive = 1 WHERE AdjustmentID = ?', [adjustmentId])
    await connection.commit(); return { success: true, status: nextStatus, revision: Number(current.Revision) + 1 }
  } catch (error: any) {
    await connection.rollback()
    if (error?.code === 'ER_DUP_ENTRY') throw createError({ statusCode: 409, statusMessage: 'A newer adjustment already claims this missed date. Keep the old adjustment cancelled or rejected.' })
    throw error
  } finally { connection.release() }
}
