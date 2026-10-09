export async function recordDtrWorkflowEvent(connection: any, entry: {
  batchId: number
  action: 'Compute Payroll' | 'Compute Billing' | 'Approve Payroll' | 'Reject Payroll' | 'Cancel Payroll'
  previousStatus: string
  nextStatus: string
  actorUserId: number
  reason?: string | null
  snapshot?: unknown
}) {
  const [[actor]] = await connection.execute<any[]>(
    `SELECT CONCAT_WS(' ', actor.FirstName, actor.LastName) AS ActorName,
      actor.UserType AS ActorRole, department.DepartmentName AS ActorDepartment
      FROM user actor LEFT JOIN department department ON department.DepartmentID = actor.DepartmentID
      WHERE actor.UserID = ? LIMIT 1`,
    [entry.actorUserId],
  )
  await connection.execute(
    `INSERT INTO dtr_workflow_event
      (BatchID, Action, PreviousDtrStatus, NextDtrStatus, ActorUserID, ActorName, ActorRole, ActorDepartment, Reason, SnapshotJson)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.batchId, entry.action, entry.previousStatus, entry.nextStatus, entry.actorUserId,
      actor?.ActorName || `User #${entry.actorUserId}`, actor?.ActorRole || null, actor?.ActorDepartment || null, entry.reason || null,
      entry.snapshot === undefined ? null : JSON.stringify(entry.snapshot)],
  )
}
