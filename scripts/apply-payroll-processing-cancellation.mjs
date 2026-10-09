import mysql from 'mysql2/promise'

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
})

try {
  const [[payrollStatus]] = await connection.execute("SHOW COLUMNS FROM payroll LIKE 'Status'")
  if (!payrollStatus.Type.includes("'Cancelled'")) {
    await connection.query("ALTER TABLE payroll MODIFY COLUMN Status ENUM('Draft', 'For Approval', 'Approved', 'Released', 'Cancelled') DEFAULT 'Draft'")
  }
  const [[reviewStatus]] = await connection.execute("SHOW COLUMNS FROM payroll_processing_review LIKE 'ReviewStatus'")
  if (!reviewStatus.Type.includes("'Cancelled'")) {
    await connection.query("ALTER TABLE payroll_processing_review MODIFY COLUMN ReviewStatus ENUM('Pending', 'Approved', 'Rejected', 'Cancelled') NOT NULL DEFAULT 'Pending'")
  }
  const [[workflowAction]] = await connection.execute("SHOW COLUMNS FROM dtr_workflow_event LIKE 'Action'")
  if (!workflowAction.Type.includes("'Cancel Payroll'")) {
    await connection.query("ALTER TABLE dtr_workflow_event MODIFY COLUMN Action ENUM('Compute Payroll', 'Compute Billing', 'Approve Payroll', 'Reject Payroll', 'Cancel Payroll') NOT NULL")
  }
  const [[adjustmentStatus]] = await connection.execute("SHOW COLUMNS FROM payroll_adjustment LIKE 'Status'")
  if (!adjustmentStatus.Type.includes("'Ready for Payroll'")) {
    await connection.query("ALTER TABLE payroll_adjustment MODIFY COLUMN Status ENUM('Draft', 'For Approval', 'Approved', 'Ready for Payroll', 'Applied', 'Rejected', 'Cancelled') NOT NULL DEFAULT 'Draft'")
  }
  const [priorStatus] = await connection.execute("SHOW COLUMNS FROM payroll_adjustment LIKE 'PreAppliedStatus'")
  if (!priorStatus.length) {
    await connection.query("ALTER TABLE payroll_adjustment ADD COLUMN PreAppliedStatus ENUM('Approved', 'Ready for Payroll') NULL")
  }
  const [postingStatus] = await connection.execute("SHOW COLUMNS FROM payroll_processing_posting LIKE 'Status'")
  if (!postingStatus.length) {
    await connection.query(`ALTER TABLE payroll_processing_posting
      ADD COLUMN Status ENUM('Active', 'Cancelled') NOT NULL DEFAULT 'Active',
      ADD COLUMN CancelledBy INT NULL,
      ADD COLUMN CancelledAt DATETIME NULL,
      DROP PRIMARY KEY,
      ADD COLUMN PostingID BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST,
      ADD COLUMN ActiveEmployeeID INT GENERATED ALWAYS AS (CASE WHEN Status = 'Active' THEN EmployeeID ELSE NULL END) PERSISTENT,
      ADD UNIQUE KEY uq_payroll_processing_posting_active (BatchID, ActiveEmployeeID),
      ADD KEY idx_payroll_processing_posting_batch_status (BatchID, Status)`)
  }
  console.log('Payroll cancellation schema ready.')
} finally {
  await connection.end()
}
