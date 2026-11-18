// A promotion can divide one site cutoff between consecutive fixed assignments.
// Save each day against the deployment covering that date, never the roster's
// latest deployment for the entire cutoff. Cutoff-only relievers keep theirs.
export async function dtrDeploymentAtDate(connection: any, enrollment: any, employeeId: number, attendanceDate: string) {
  const [[source]] = await connection.execute<any[]>("SELECT DeploymentID, EmployeeID, SiteID, IsPermanentSite, DATE_FORMAT(StartDate, '%Y-%m-%d') AS StartDate, DATE_FORMAT(EndDate, '%Y-%m-%d') AS EndDate FROM employee_deployment WHERE DeploymentID=?", [enrollment.DeploymentID])
  if (!source || Number(source.EmployeeID) !== employeeId) return null
  if (!Number(source.IsPermanentSite)) return source.StartDate <= attendanceDate && (!source.EndDate || source.EndDate >= attendanceDate) ? enrollment : null
  const [[dated]] = await connection.execute<any[]>(`SELECT DeploymentID FROM employee_deployment
    WHERE EmployeeID=? AND SiteID=? AND IsPermanentSite=1 AND StartDate<=? AND (EndDate IS NULL OR EndDate>=?)
    ORDER BY StartDate DESC, DeploymentID DESC LIMIT 1`, [employeeId, source.SiteID, attendanceDate, attendanceDate])
  return dated ? { ...enrollment, DeploymentID: Number(dated.DeploymentID) } : null
}
