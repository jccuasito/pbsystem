type AttendanceStatusInput = {
  AttendanceStatus?: unknown
  TimeIn?: unknown
  TimeOut?: unknown
  RegularHours?: unknown
  OTHours?: unknown
  OTExtHours?: unknown
  RestDayHours?: unknown
  RestDayOTHours?: unknown
  LegalHolidayHours?: unknown
  LegalHolidayOTHours?: unknown
  SpecialHolidayHours?: unknown
  SpecialHolidayOTHours?: unknown
  RestDayLegalHolidayHours?: unknown
  RestDayLegalHolidayOTHours?: unknown
  RestDaySpecialHolidayHours?: unknown
  RestDaySpecialHolidayOTHours?: unknown
  BreakHours?: unknown
  LateHours?: unknown
  UndertimeHours?: unknown
}

const nonWorkStatuses = new Set(['Absent', 'Rest Day', 'On-Leave', 'Reliever'])
const amount = (value: unknown) => Math.max(0, Number(value) || 0)
const timestamp = (value: unknown) => value instanceof Date ? value.getTime() : new Date(String(value || '').replace(' ', 'T')).getTime()

/** Status only: never changes payroll hours, actual timestamps, or day counts. */
export function automaticDtrAttendanceStatus(record: AttendanceStatusInput, regularHours: unknown): string {
  const current = String(record.AttendanceStatus || 'Present')
  if (nonWorkStatuses.has(current)) return current
  const late = amount(record.LateHours)
  // Holiday columns can mirror ordinary hours. ND is an overlapping premium.
  // Neither may be added again when measuring how much of a day was worked.
  const credited = Math.max(
    amount(record.RegularHours) + amount(record.OTHours) + amount(record.OTExtHours),
    amount(record.RestDayHours) + amount(record.RestDayOTHours),
    amount(record.LegalHolidayHours) + amount(record.LegalHolidayOTHours),
    amount(record.SpecialHolidayHours) + amount(record.SpecialHolidayOTHours),
    amount(record.RestDayLegalHolidayHours) + amount(record.RestDayLegalHolidayOTHours),
    amount(record.RestDaySpecialHolidayHours) + amount(record.RestDaySpecialHolidayOTHours),
  )
  // Scheduled allocations track late separately; remove it for classification.
  let worked = Math.max(0, credited - late)
  const start = timestamp(record.TimeIn), end = timestamp(record.TimeOut)
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    const actual = Math.max(0, (end - start) / 3600000 - amount(record.BreakHours))
    worked = credited > 0 ? Math.min(worked, actual) : actual
  }
  const regular = amount(regularHours)
  if (regular > 0 && worked > 0 && Math.round(worked * 60) <= Math.round(regular * 30)) return 'Half-Day'
  if (late > 0 || amount(record.UndertimeHours) > 0) return 'Late'
  return current === 'Holiday' ? 'Holiday' : 'Present'
}
