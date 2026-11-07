const leaveStatuses = new Set(['On-Leave', 'Vacation Leave', 'Sick Leave'])

export type EmployeeDaySite = {
  SiteID: number | null
  ClientName: string
  SiteName: string
  Source: 'Attendance record' | 'DTR assignment' | 'Fixed deployment'
}

// Use dated records, then dated assignments. Never borrow today's posting for a past date.
export function employeeDailySites(employeeId: unknown, date: string, attendance: any[], rosters: any[], deployments: any[]): EmployeeDaySite[] {
  const sameEmployee = (row: any) => String(row.EmployeeID) === String(employeeId)
  const covers = (row: any) => (!row.StartDate || String(row.StartDate).slice(0, 10) <= date)
    && (!row.EndDate || String(row.EndDate).slice(0, 10) >= date)
  const records = attendance.filter(row => sameEmployee(row) && String(row.AttendanceDate).slice(0, 10) === date && row.SiteName)
  const assigned = rosters.filter(row => sameEmployee(row) && String(row.PeriodStart).slice(0, 10) <= date
    && String(row.PeriodEnd).slice(0, 10) >= date && covers(row) && row.SiteName)
  const fixed = deployments.filter(row => sameEmployee(row) && covers(row) && row.SiteName)
  const rows = records.length ? records : assigned.length ? assigned : fixed
  const source: EmployeeDaySite['Source'] = records.length ? 'Attendance record' : assigned.length ? 'DTR assignment' : 'Fixed deployment'
  const sites = new Map<string, EmployeeDaySite>()
  for (const row of rows) {
    const site = { SiteID: row.SiteID == null ? null : Number(row.SiteID), ClientName: String(row.ClientName || ''), SiteName: String(row.SiteName), Source: source }
    sites.set(site.SiteID == null ? `${site.ClientName}|${site.SiteName}` : String(site.SiteID), site)
  }
  return [...sites.values()]
}

// Count calendar dates, rather than attendance rows: one employee can have
// several site entries on the same day. Undeployed dates are not missing work.
export function employeeStatusCutoffSummary(
  dates: readonly string[],
  statusAt: (date: string) => unknown,
  assignedAt: (date: string) => boolean,
) {
  const counts: Record<string, number> = { Present: 0, Absent: 0, Leave: 0, Suspended: 0 }
  let assignedDays = 0, encodedDays = 0
  for (const date of new Set(dates)) {
    if (!assignedAt(date)) continue
    assignedDays++
    const status = String(statusAt(date) || '').trim()
    if (!status) continue
    encodedDays++
    const category = leaveStatuses.has(status) ? 'Leave' : status
    counts[category] = (counts[category] || 0) + 1
  }
  return { assignedDays, encodedDays, missingDays: assignedDays - encodedDays, counts }
}
