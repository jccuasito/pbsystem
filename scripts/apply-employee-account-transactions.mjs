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
  await connection.query(`CREATE TABLE IF NOT EXISTS employee_account_transaction (
    TransactionRecordID BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    TransactionID VARCHAR(32) NULL,
    EmployeeID INT NULL,
    EmployeeName VARCHAR(255) NOT NULL,
    EmployeeNumber VARCHAR(30) NULL,
    AgencyID INT NULL,
    AgencyName VARCHAR(150) NULL,
    PositionName VARCHAR(150) NULL,
    EntryType ENUM('Loan', 'Deduction') NOT NULL,
    SourceRecordID INT NOT NULL,
    AccountReference VARCHAR(32) NULL,
    IssuanceCode VARCHAR(100) NULL,
    ClassificationName VARCHAR(100) NULL,
    ItemName VARCHAR(150) NOT NULL,
    PayrollID INT NULL,
    TransactionDate DATE NOT NULL,
    CutoffStartDate DATE NULL,
    CutoffEndDate DATE NULL,
    Amount DECIMAL(10,2) NOT NULL,
    BalanceBefore DECIMAL(10,2) NOT NULL,
    BalanceAfter DECIMAL(10,2) NOT NULL,
    Status ENUM('Posted', 'Voided') NOT NULL DEFAULT 'Posted',
    Remarks VARCHAR(255) NULL,
    CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    VoidedAt TIMESTAMP NULL,
    PRIMARY KEY (TransactionRecordID),
    UNIQUE KEY uq_employee_account_transaction_id (TransactionID),
    UNIQUE KEY uq_employee_account_transaction_payroll_source (PayrollID, EntryType, SourceRecordID),
    KEY idx_employee_account_transaction_employee_date (EmployeeID, TransactionDate),
    KEY idx_employee_account_transaction_agency_date (AgencyID, TransactionDate),
    KEY idx_employee_account_transaction_source (EntryType, SourceRecordID, TransactionDate),
    KEY idx_employee_account_transaction_payroll (PayrollID),
    CONSTRAINT fk_employee_account_transaction_employee FOREIGN KEY (EmployeeID) REFERENCES employee (EmployeeID) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_employee_account_transaction_payroll FOREIGN KEY (PayrollID) REFERENCES payroll (PayrollID) ON DELETE SET NULL ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

  if (!await hasColumn('employee_account_transaction', 'AccountReference')) {
    await connection.query('ALTER TABLE `employee_account_transaction` ADD COLUMN `AccountReference` VARCHAR(32) NULL AFTER `SourceRecordID`')
  }
  if (!await hasIndex('employee_account_transaction', 'uq_employee_account_transaction_payroll_source')) {
    await connection.query('ALTER TABLE `employee_account_transaction` ADD UNIQUE KEY `uq_employee_account_transaction_payroll_source` (`PayrollID`, `EntryType`, `SourceRecordID`)')
  }

  for (const table of ['employee_loan', 'employee_deduction']) {
    const transactionIndex = table === 'employee_loan' ? 'uq_employee_loan_transaction_id' : 'uq_employee_deduction_transaction_id'
    const ordinaryIssuanceIndex = table === 'employee_loan' ? 'idx_employee_loan_issuance_code' : 'idx_employee_deduction_issuance_code'
    const uniqueIssuanceIndex = table === 'employee_loan' ? 'uq_employee_loan_issuance_code' : 'uq_employee_deduction_issuance_code'
    const accountReferenceIndex = table === 'employee_loan' ? 'uq_employee_loan_account_reference' : 'uq_employee_deduction_account_reference'
    if (await hasIndex(table, transactionIndex)) {
      await connection.query(`ALTER TABLE \`${table}\` DROP INDEX \`${transactionIndex}\``)
    }
    if (await hasColumn(table, 'TransactionID')) {
      await connection.query(`ALTER TABLE \`${table}\` DROP COLUMN \`TransactionID\``)
    }
    if (await hasIndex(table, ordinaryIssuanceIndex)) {
      await connection.query(`ALTER TABLE \`${table}\` DROP INDEX \`${ordinaryIssuanceIndex}\``)
    }
    if (!await hasIndex(table, uniqueIssuanceIndex)) {
      await connection.query(`ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${uniqueIssuanceIndex}\` (\`IssuanceCode\`)`)
    }
    if (!await hasColumn(table, 'AccountReference')) {
      const afterColumn = table === 'employee_loan' ? 'LoanTypeID' : 'DeductionTypeID'
      await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`AccountReference\` VARCHAR(32) NULL AFTER \`${afterColumn}\``)
    }
    const idColumn = table === 'employee_loan' ? 'LoanID' : 'EmployeeDeductionID'
    const prefix = table === 'employee_loan' ? 'LN' : 'DED'
    await connection.query(`UPDATE \`${table}\` SET AccountReference = CONCAT('${prefix}', CASE WHEN \`${idColumn}\` < 1000000 THEN LPAD(\`${idColumn}\`, 6, '0') ELSE CAST(\`${idColumn}\` AS CHAR) END) WHERE AccountReference IS NULL`)
    if (!await hasIndex(table, accountReferenceIndex)) {
      await connection.query(`ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${accountReferenceIndex}\` (\`AccountReference\`)`)
    }
  }

  await connection.query(`UPDATE employee_account_transaction t
    LEFT JOIN employee_loan el ON t.EntryType = 'Loan' AND el.LoanID = t.SourceRecordID
    LEFT JOIN employee_deduction ed ON t.EntryType = 'Deduction' AND ed.EmployeeDeductionID = t.SourceRecordID
    SET t.AccountReference = COALESCE(t.AccountReference, el.AccountReference, ed.AccountReference)
    WHERE t.AccountReference IS NULL`)
  await connection.query("UPDATE employee_account_transaction SET AccountReference = CONCAT('LEGACY', TransactionRecordID) WHERE AccountReference IS NULL")
  await connection.query('ALTER TABLE `employee_account_transaction` MODIFY COLUMN `AccountReference` VARCHAR(32) NOT NULL')

  console.log('Employee account transaction ledger is ready.')
} finally {
  await connection.end()
}
