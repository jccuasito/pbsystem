import mysql from 'mysql2/promise'

const database = process.env.DB_NAME || 'pbsystem'
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database,
})

async function hasColumn(table, column) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [database, table, column],
  )
  return Number(rows[0]?.count || 0) > 0
}

async function hasIndex(table, index) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [database, table, index],
  )
  return Number(rows[0]?.count || 0) > 0
}

try {
  const columns = [
    ['employee_loan', 'IssuanceCode', 'VARCHAR(100) NULL AFTER LoanTypeID'],
    ['employee_loan', 'RepaymentStartDate', 'DATE NULL AFTER ReleaseDate'],
    ['employee_loan', 'RepaymentMonths', 'SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER RepaymentStartDate'],
    ['employee_loan', 'RepaymentCutoff', "ENUM('First','Second') NOT NULL DEFAULT 'Second' AFTER RepaymentMonths"],
    ['employee_loan', 'FinalInstallmentAmount', 'DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER MonthlyDeduction'],
    ['employee_loan', 'IsPaused', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER EndDate'],
    ['employee_loan', 'PauseStartDate', 'DATE NULL AFTER IsPaused'],
    ['employee_loan', 'ResumeDate', 'DATE NULL AFTER PauseStartDate'],
    ['employee_loan', 'PauseReason', 'VARCHAR(255) NULL AFTER ResumeDate'],
    ['employee_loan', 'Remarks', 'VARCHAR(255) NULL AFTER PauseReason'],
    ['employee_loan', 'CreatedAt', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'],
    ['employee_loan', 'UpdatedAt', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
    ['employee_deduction', 'IssuanceCode', 'VARCHAR(100) NULL AFTER DeductionTypeID'],
    ['employee_deduction', 'IssuanceDate', 'DATE NULL AFTER IssuanceCode'],
    ['employee_deduction', 'RemainingBalance', 'DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER Amount'],
    ['employee_deduction', 'InstallmentAmount', 'DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER RemainingBalance'],
    ['employee_deduction', 'FinalInstallmentAmount', 'DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER InstallmentAmount'],
    ['employee_deduction', 'RepaymentStartDate', 'DATE NULL AFTER StartDate'],
    ['employee_deduction', 'RepaymentMonths', 'SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER RepaymentStartDate'],
    ['employee_deduction', 'RepaymentCutoff', "ENUM('First','Second') NOT NULL DEFAULT 'First' AFTER RepaymentMonths"],
    ['employee_deduction', 'IsPaused', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER EndDate'],
    ['employee_deduction', 'PauseStartDate', 'DATE NULL AFTER IsPaused'],
    ['employee_deduction', 'ResumeDate', 'DATE NULL AFTER PauseStartDate'],
    ['employee_deduction', 'PauseReason', 'VARCHAR(255) NULL AFTER ResumeDate'],
    ['employee_deduction', 'CreatedAt', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'],
    ['employee_deduction', 'UpdatedAt', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
  ]
  for (const [table, column, definition] of columns) {
    if (!await hasColumn(table, column)) {
      await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`)
    }
  }

  const indexes = [
    ['employee_loan', 'uq_employee_loan_issuance_code', 'UNIQUE KEY `uq_employee_loan_issuance_code` (`IssuanceCode`)'],
    ['employee_deduction', 'uq_employee_deduction_issuance_code', 'UNIQUE KEY `uq_employee_deduction_issuance_code` (`IssuanceCode`)'],
    ['employee_loan', 'idx_employee_loan_repayment_queue', 'KEY `idx_employee_loan_repayment_queue` (`EmployeeID`, `Status`, `RepaymentCutoff`, `RepaymentStartDate`, `ReleaseDate`)'],
    ['employee_deduction', 'idx_employee_deduction_repayment_queue', 'KEY `idx_employee_deduction_repayment_queue` (`EmployeeID`, `Status`, `RepaymentCutoff`, `RepaymentStartDate`, `IssuanceDate`)'],
  ]
  for (const [table, index, definition] of indexes) {
    if (!await hasIndex(table, index)) {
      await connection.query(`ALTER TABLE \`${table}\` ADD ${definition}`)
    }
  }

  await connection.execute(
    'UPDATE employee_deduction SET IssuanceDate = StartDate WHERE IssuanceDate IS NULL AND StartDate IS NOT NULL',
  )
  await connection.execute(
    `UPDATE employee_loan
        SET RepaymentStartDate = COALESCE(RepaymentStartDate, ReleaseDate),
            RepaymentMonths = GREATEST(1, RepaymentMonths),
            EndDate = COALESCE(EndDate, LAST_DAY(COALESCE(RepaymentStartDate, ReleaseDate))),
            MonthlyDeduction = CASE WHEN MonthlyDeduction > 0 THEN MonthlyDeduction ELSE LoanAmount END,
            FinalInstallmentAmount = CASE WHEN FinalInstallmentAmount > 0 THEN FinalInstallmentAmount ELSE LoanAmount END`,
  )
  await connection.execute(
    `UPDATE employee_deduction
        SET RepaymentStartDate = COALESCE(RepaymentStartDate, StartDate, IssuanceDate),
            RepaymentMonths = GREATEST(1, RepaymentMonths),
            EndDate = COALESCE(EndDate,
              CASE WHEN RepaymentCutoff = 'First'
                THEN DATE_ADD(DATE_FORMAT(DATE_ADD(COALESCE(RepaymentStartDate, StartDate, IssuanceDate), INTERVAL IF(DAY(COALESCE(RepaymentStartDate, StartDate, IssuanceDate)) > 15, 1, 0) MONTH), '%Y-%m-01'), INTERVAL 14 DAY)
                ELSE LAST_DAY(COALESCE(RepaymentStartDate, StartDate, IssuanceDate))
              END),
            RemainingBalance = CASE WHEN Status = 'Completed' THEN 0 ELSE Amount END,
            InstallmentAmount = CASE WHEN InstallmentAmount > 0 THEN InstallmentAmount ELSE Amount END,
            FinalInstallmentAmount = CASE WHEN FinalInstallmentAmount > 0 THEN FinalInstallmentAmount ELSE Amount END`,
  )
  console.log('Employee loan and deduction issuance and repayment-plan fields are ready.')
} finally {
  await connection.end()
}
