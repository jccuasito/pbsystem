export type BtrEmployee = {
  EmployeeID: number
  EmployeeName: string
  EmployeeNumber: string | null
}
export type BtrAttendance = {
  EmployeeID: number
  AttendanceDate: string
  AttendanceStatus: string
  RegularHours: number | string
  OTHours: number | string
}
export type BtrEntry = {
  BTRID: number
  AttendanceDate: string
  ReplacedEmployeeID: number
  ReplacedEmployeeName: string
  ReplacedEmployeeNumber?: string | null
  RelieverEmployeeID: number
  RelieverEmployeeName: string
  RelieverEmployeeNumber?: string | null
  Hours: number | string
  Revision: number
  Issue?: string
}
export const btrDate = (value: string | Date) => value instanceof Date
  ? value.getFullYear()+'-'+String(value.getMonth()+1).padStart(2,'0')+'-'+String(value.getDate()).padStart(2,'0')
  : String(value).slice(0,10)
export const btrHundredths = (hours: number | string) => Math.round(Number(hours || 0) * 100)
export function resolveBtrEmployee(value: unknown, employees: BtrEmployee[]): BtrEmployee | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const key = String(value).trim().toUpperCase()
  if (!key) return undefined
  const match = /^(?:EMP-)?(\d+)$/.exec(key)
  if (match) {
    const byId = employees.find(employee => Number(employee.EmployeeID) === Number(match[1]))
    if (byId) return byId
  }
  const byNumber = employees.filter(employee => String(employee.EmployeeNumber || '').trim().toUpperCase() === key)
  return byNumber.length === 1 ? byNumber[0] : undefined
}
export function summarizeBtr(entries: BtrEntry[]) {
  const relievers = new Map<number, { EmployeeID: number; EmployeeName: string; units: number }>()
  const replaced = new Map<number, { EmployeeID: number; EmployeeName: string; units: number }>()
  const pairs = new Map<string, { RelieverEmployeeID: number; RelieverEmployeeName: string; ReplacedEmployeeID: number; ReplacedEmployeeName: string; units: number }>()
  let total = 0
  for (const entry of entries) {
    const units = btrHundredths(entry.Hours)
    total += units
    for (const [map, id, name] of [
      [relievers, entry.RelieverEmployeeID, entry.RelieverEmployeeName],
      [replaced, entry.ReplacedEmployeeID, entry.ReplacedEmployeeName]
    ] as const) {
      const item = map.get(id) || { EmployeeID: id, EmployeeName: name, units: 0 }
      item.units += units; map.set(id, item)
    }
    const key = entry.RelieverEmployeeID+':'+entry.ReplacedEmployeeID
    const pair = pairs.get(key) || { RelieverEmployeeID: entry.RelieverEmployeeID, RelieverEmployeeName: entry.RelieverEmployeeName,
      ReplacedEmployeeID: entry.ReplacedEmployeeID, ReplacedEmployeeName: entry.ReplacedEmployeeName, units: 0 }
    pair.units += units; pairs.set(key, pair)
  }
  const employeeTotals = (map: typeof relievers) => Array.from(map.values(), ({ units, ...item }) => ({ ...item, Hours: units / 100 }))
    .sort((a,b) => a.EmployeeName.localeCompare(b.EmployeeName))
  return {
    TotalHours: total / 100,
    relievers: employeeTotals(relievers), replaced: employeeTotals(replaced),
    pairs: Array.from(pairs.values(), ({ units, ...item }) => ({ ...item, Hours: units / 100 }))
      .sort((a,b) => a.RelieverEmployeeName.localeCompare(b.RelieverEmployeeName) || a.ReplacedEmployeeName.localeCompare(b.ReplacedEmployeeName))
  }
}
