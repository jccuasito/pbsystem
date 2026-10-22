const leaveStatuses = new Set(['On-Leave', 'Vacation Leave', 'Sick Leave'])

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
