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
