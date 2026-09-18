type DeploymentPeriod = {
  EmployeeID: unknown
  IsPermanentSite: unknown
  StartDate: unknown
  EndDate?: unknown
  SiteName?: string
}

// New deployments may follow an ended assignment, but may not overlap one.
// Cutoff-only DTR records are not permanent site assignments.
export function findDeploymentConflict(rows: DeploymentPeriod[], employeeId: unknown, start: string, end = '') {
  if (!employeeId || !start) return undefined
  return rows.find(row => String(row.EmployeeID) === String(employeeId)
    && Number(row.IsPermanentSite) === 1
    && String(row.StartDate).slice(0, 10) <= (end || '9999-12-31')
    && (!row.EndDate || String(row.EndDate).slice(0, 10) >= start))
}
