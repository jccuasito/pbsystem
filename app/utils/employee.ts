export type EmployeeIdentity = {
  EmployeeID?: number | string | null
  EmployeeNumber?: string | null
  EmployeeName?: string | null
  FirstName?: string | null
  MiddleName?: string | null
  LastName?: string | null
}

export function formatEmployeeId(employeeId: EmployeeIdentity['EmployeeID']) {
  const id = Number(employeeId)
  if (!Number.isInteger(id) || id <= 0) return '\u2014'
  return `EMP-${String(id).padStart(4, '0')}`
}

export function formatEmployeeNumber(employeeNumber: EmployeeIdentity['EmployeeNumber']) {
  return typeof employeeNumber === 'string' && employeeNumber.trim() ? employeeNumber.trim() : 'Not yet assigned'
}

export function formatEmployeeName(employee: EmployeeIdentity) {
  const suppliedName = employee.EmployeeName?.trim()
  if (suppliedName) return suppliedName

  return [employee.FirstName, employee.MiddleName, employee.LastName]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .join(' ') || 'Unnamed employee'
}

export function formatEmployeeLabel(employee: EmployeeIdentity) {
  const badge = typeof employee.EmployeeNumber === 'string' ? employee.EmployeeNumber.trim() : ''
  return `${formatEmployeeId(employee.EmployeeID)} \u2014 ${formatEmployeeName(employee)}${badge ? ` (${badge})` : ''}`
}

/** Use the Philippine calendar day, regardless of the browser or server timezone. */
export function employeeCurrentDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find(value => value.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function calendarDate(value: unknown) {
  if (typeof value !== 'string') return null
  // API dates may include a timestamp. Birthday is a calendar date, not an instant.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T| )/.exec(value)
  if (!match) return null
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!
    ? { year, month, day } : null
}

export function employeeAge(birthday: unknown, asOf = employeeCurrentDate()): number | null {
  const birth = calendarDate(birthday), current = calendarDate(asOf)
  if (!birth || !current) return null
  const birthdayPending = current.month < birth.month || (current.month === birth.month && current.day < birth.day)
  // February 29 birthdays advance on March 1 in non-leap years.
  const age = current.year - birth.year - Number(birthdayPending)
  return age >= 0 ? age : null
}

export function formatEmployeeAge(birthday: unknown, asOf = employeeCurrentDate()) {
  const age = employeeAge(birthday, asOf)
  return age === null ? '\u2014' : `${age} ${age === 1 ? 'year' : 'years'} old`
}
