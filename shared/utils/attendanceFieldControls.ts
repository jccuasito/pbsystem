export const attendanceControlledFields = [
  { key: 'RegularHours', label: 'Regular hours', group: 'Hours and overtime' },
  { key: 'OTHours', label: 'Regular OT', group: 'Hours and overtime' },
  { key: 'OTExtHours', label: 'OT extension', group: 'Hours and overtime' },
  { key: 'NightDiffHours', label: 'Night differential', group: 'Hours and overtime' },
  { key: 'RestDayHours', label: 'Rest day hours', group: 'Rest days and holidays' },
  { key: 'RestDayOTHours', label: 'Rest day OT', group: 'Rest days and holidays' },
  { key: 'LegalHolidayHours', label: 'Legal holiday hours', group: 'Rest days and holidays' },
  { key: 'LegalHolidayOTHours', label: 'Legal holiday OT', group: 'Rest days and holidays' },
  { key: 'RestDayLegalHolidayHours', label: 'Rest day legal holiday', group: 'Rest days and holidays' },
  { key: 'RestDayLegalHolidayOTHours', label: 'Rest day legal holiday OT', group: 'Rest days and holidays' },
  { key: 'SpecialHolidayHours', label: 'Special holiday hours', group: 'Rest days and holidays' },
  { key: 'SpecialHolidayOTHours', label: 'Special holiday OT', group: 'Rest days and holidays' },
  { key: 'RestDaySpecialHolidayHours', label: 'Rest day special holiday', group: 'Rest days and holidays' },
  { key: 'RestDaySpecialHolidayOTHours', label: 'Rest day special holiday OT', group: 'Rest days and holidays' },
  { key: 'BreakHours', label: 'Break hours', group: 'Breaks and time deductions' },
  { key: 'LateHours', label: 'Late minutes', group: 'Breaks and time deductions' },
  { key: 'UndertimeHours', label: 'Undertime minutes', group: 'Breaks and time deductions' },
] as const

export type AttendanceControlledField = typeof attendanceControlledFields[number]['key']
const keys = new Set<string>(attendanceControlledFields.map(field => field.key))
export function attendanceFieldList(value: unknown): AttendanceControlledField[] {
  if (typeof value === 'string') { try { value = JSON.parse(value) } catch { return [] } }
  return Array.isArray(value) ? [...new Set(value.filter((key): key is AttendanceControlledField => typeof key === 'string' && keys.has(key)))] : []
}
export function attendanceOverrideMap(value: unknown): Partial<Record<AttendanceControlledField, number>> {
  if (typeof value === 'string') { try { value = JSON.parse(value) } catch { return {} } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([key, amount]) => keys.has(key) && typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= 24))
}
export function permittedAttendanceOverrides(value: unknown, editable: unknown) {
  const allowed = new Set(attendanceFieldList(editable))
  return Object.fromEntries(Object.entries(attendanceOverrideMap(value)).filter(([key]) => allowed.has(key as AttendanceControlledField))) as ReturnType<typeof attendanceOverrideMap>
}

// Treat database clock values as wall-clock time, independent of browser timezone.
function stamp(value: unknown) {
  const text = String(value || '').replace('T', ' ').slice(0, 19)
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)) return NaN
  return Date.parse(text.replace(' ', 'T') + (text.length === 16 ? ':00Z' : 'Z'))
}
function clock(value: number) { return new Date(value).toISOString().slice(0, 16).replace('T', ' ') }
function scheduled(row: any, shift: any, end = false) {
  const date = String(row.AttendanceDate || '').slice(0, 10)
  const startClock = String(shift?.TimeIn || '').slice(0, 5), endClock = String(shift?.TimeOut || '').slice(0, 5)
  if (!startClock || (end && !endClock)) return NaN
  return stamp(date + ' ' + (end ? endClock : startClock)) + (end && endClock <= startClock ? 86400000 : 0)
}
export function manualNightWindowHours(timeIn: unknown, timeOut: unknown, shift: any) {
  const start = stamp(timeIn), end = stamp(timeOut)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  const dayShift = ['DS','DAY'].includes(String(shift?.ShiftType || '').toUpperCase())
  const fromClock = String(dayShift ? '22:00' : shift?.NDStartTime || '22:00').slice(0, 5), toClock = String(dayShift ? '06:00' : shift?.NDEndTime || '06:00').slice(0, 5)
  let total = 0
  for (let day = Math.floor(start / 86400000) * 86400000 - 86400000; day <= end; day += 86400000) {
    const date = new Date(day).toISOString().slice(0, 10)
    const from = stamp(date + ' ' + fromClock), to = stamp(date + ' ' + toClock) + (toClock <= fromClock ? 86400000 : 0)
    total += Math.max(0, Math.min(end, to) - Math.max(start, from))
  }
  return Math.round(total / 3600000 * 100) / 100
}

export function previewAttendanceFieldEdit(row: any, field: AttendanceControlledField, shift: any, policy: any = {}): { timeOut: string; conflict: string } {
  const start = stamp(row.TimeIn), current = stamp(row.TimeOut)
  const value = Number(row[field])
  const unchanged = String(row.TimeOut || '')
  if (!Number.isFinite(start)) return { timeOut: unchanged, conflict: 'Enter a valid Time in before editing hours.' }
  if (!Number.isFinite(value) || value < 0 || value > 24) return { timeOut: unchanged, conflict: 'Enter a value from 0 to 24 hours.' }
  const maxHours = Math.max(Number(row.WorkdayCount || 1), Number(shift?.WorkdayCount || 1)) > 1 ? 48 : 24
  let end = current
  if (field === 'NightDiffHours') {
    let best = NaN, distance = Infinity
    for (let minute = 1; minute <= maxHours * 60; minute++) {
      const candidate = start + minute * 60000
      if (Math.abs(manualNightWindowHours(row.TimeIn, clock(candidate), shift) - value) > .005) continue
      const delta = Math.abs(candidate - (Number.isFinite(current) ? current : start))
      if (delta < distance) { best = candidate; distance = delta }
    }
    if (!Number.isFinite(best)) return { timeOut: unchanged, conflict: 'This ND value has no matching Time out with the current Time in. Adjust the time or use the automatic value.' }
    end = best
  } else if (field === 'LateHours') {
    const expected = Math.max(0, (start - scheduled(row, shift)) / 3600000)
    if (!Number.isFinite(expected) || Math.abs(expected - value) > 1 / 120) return { timeOut: unchanged, conflict: 'Late minutes depend on Time in. Change Time in or use the matching late value; Time in will not be moved automatically.' }
  } else if (field === 'UndertimeHours') {
    end = scheduled(row, shift, true) - value * 3600000
  } else if (['RegularHours', 'OTHours', 'OTExtHours', 'BreakHours'].includes(field)) {
    const durationFields = Number(policy.AutoBreakEnabled) === 1 ? ['RegularHours', 'OTHours', 'OTExtHours', 'BreakHours'] : ['RegularHours', 'OTHours', 'OTExtHours']
    const gross = durationFields.reduce((sum, key) => sum + Math.max(0, Number(row[key] || 0)), 0)
    end = start + Math.round((gross - Number(row.LateHours || 0) - Number(row.UndertimeHours || 0)) * 60) * 60000
  } else {
    // Holiday/rest-day classifications overlap existing work; they add no time.
    const available = Math.max(0, (current - start) / 3600000)
    if (!Number.isFinite(available) || value > available + .01) return { timeOut: unchanged, conflict: 'These classified hours exceed the worked time. Extend the time range or reduce this value.' }
  }
  if (!Number.isFinite(end) || end <= start || end - start > maxHours * 3600000) return { timeOut: unchanged, conflict: `Time out must follow Time in and fit within ${maxHours} hours.` }
  return { timeOut: clock(end), conflict: '' }
}

export function attendanceTimeConflict(row: any, overrides: unknown, shift: any, policy: any = {}) {
  const manual = attendanceOverrideMap(overrides)
  if (Object.keys(manual).length) {
    const start = stamp(row.TimeIn), end = stamp(row.TimeOut)
    const maxHours = Math.max(Number(row.WorkdayCount || 1), Number(shift?.WorkdayCount || 1)) > 1 ? 48 : 24
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > maxHours * 3600000) return `Enter valid Time in/out within ${maxHours} hours before saving manual fields.`
  }
  if (['RegularHours', 'OTHours', 'OTExtHours', 'BreakHours'].some(key => key in manual)) {
    const span = (stamp(row.TimeOut) - stamp(row.TimeIn)) / 3600000
    const durationFields = Number(policy.AutoBreakEnabled) === 1 ? ['RegularHours','OTHours','OTExtHours','BreakHours'] : ['RegularHours','OTHours','OTExtHours']
    const payableSpan = durationFields.reduce((sum,key) => sum + Number(row[key] || 0), 0) - Number(row.LateHours || 0) - Number(row.UndertimeHours || 0)
    if (!Number.isFinite(span) || Math.abs(span - payableSpan) > .025) return 'The hour allocations do not match the proposed time range. Adjust the hours or use their automatic values.'
  }
  for (const key of Object.keys(manual) as AttendanceControlledField[]) {
    if (key === 'NightDiffHours' && Math.abs(manualNightWindowHours(row.TimeIn, row.TimeOut, shift) - Number(manual[key])) > .005) return 'Night differential does not match the proposed time range. Adjust ND or use its automatic value.'
    if (key === 'LateHours' || key === 'UndertimeHours' || /Holiday|^RestDay/.test(key)) {
      const preview = previewAttendanceFieldEdit(row, key, shift, policy)
      if (preview.conflict) return preview.conflict
      if (key === 'UndertimeHours' && Math.abs(stamp(preview.timeOut) - stamp(row.TimeOut)) > 30000) return 'Undertime does not match the proposed Time out.'
    }
  }
  return ''
}

export function reconcileAttendanceAllocations(row: any, overrides: unknown, policy: any = {}) {
  const manual = attendanceOverrideMap(overrides), result = { ...row, ...manual }
  if (!['RegularHours','OTHours','OTExtHours','BreakHours'].some(key => key in manual)) return result
  const span = (stamp(row.TimeOut) - stamp(row.TimeIn)) / 3600000
  if (!Number.isFinite(span) || span <= 0) return result
  const baseline = Number(result.RegularHours || 0) + Number(result.OTHours || 0) + (Number(policy.AutoBreakEnabled) === 1 ? Number(result.BreakHours || 0) : 0)
  const late = Number(result.LateHours || 0)
  const rounded = (value: number) => Math.round(Math.max(0, value) * 100) / 100
  if (!('OTExtHours' in manual)) result.OTExtHours = rounded(span + late - baseline)
  if (!('UndertimeHours' in manual)) result.UndertimeHours = rounded(baseline + Number(result.OTExtHours || 0) - span - late)
  return result
}
