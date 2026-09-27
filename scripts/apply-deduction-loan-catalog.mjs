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
    `SELECT COUNT(*) AS count FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [database, table, column],
  )
  return Number(rows[0]?.count || 0) > 0
}

async function hasIndex(table, index) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [database, table, index],
  )
  return Number(rows[0]?.count || 0) > 0
}

async function hasForeignKey(table, constraint) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    [database, table, constraint],
  )
  return Number(rows[0]?.count || 0) > 0
}

try {
  await connection.query(`CREATE TABLE IF NOT EXISTS deduction_loan_classification (
    ClassificationID INT NOT NULL AUTO_INCREMENT,
    ClassificationName VARCHAR(100) NOT NULL,
    AppliesTo ENUM('Loan', 'Deduction') NOT NULL DEFAULT 'Loan',
    Description VARCHAR(255) NULL,
    Status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (ClassificationID),
    UNIQUE KEY uq_deduction_loan_classification_name (ClassificationName)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

  for (const table of ['loan_type', 'deduction_type']) {
    if (!await hasColumn(table, 'ClassificationID')) {
      const after = table === 'loan_type' ? 'LoanName' : 'DeductionName'
      await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN ClassificationID INT NULL AFTER \`${after}\``)
    }
    if (!await hasColumn(table, 'Description')) {
      const after = table === 'loan_type' ? 'GovernmentAgency' : 'DeductionPeriod'
      await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN Description VARCHAR(255) NULL AFTER \`${after}\``)
    }
  }

  const [bothRows] = await connection.execute(
    `SELECT c.ClassificationID, c.ClassificationName, c.Description, c.Status,
            (SELECT COUNT(*) FROM loan_type lt WHERE lt.ClassificationID = c.ClassificationID) AS LoanCount,
            (SELECT COUNT(*) FROM deduction_type dt WHERE dt.ClassificationID = c.ClassificationID) AS DeductionCount
       FROM deduction_loan_classification c
      WHERE c.AppliesTo = 'Both'`,
  )
  for (const row of bothRows) {
    if (Number(row.LoanCount) > 0 && Number(row.DeductionCount) > 0) {
      const baseName = `${row.ClassificationName} (Deduction)`
      let name = baseName
      let suffix = 2
      while (true) {
        const [existing] = await connection.execute(
          'SELECT ClassificationID FROM deduction_loan_classification WHERE ClassificationName = ? LIMIT 1',
          [name],
        )
        if (!existing[0]) break
        name = `${baseName} ${suffix++}`
      }
      const [result] = await connection.execute(
        `INSERT INTO deduction_loan_classification (ClassificationName, AppliesTo, Description, Status)
         VALUES (?, 'Deduction', ?, ?)`,
        [name, row.Description, row.Status],
      )
      await connection.execute(
        'UPDATE deduction_type SET ClassificationID = ? WHERE ClassificationID = ?',
        [result.insertId, row.ClassificationID],
      )
      await connection.execute(
        "UPDATE deduction_loan_classification SET AppliesTo = 'Loan' WHERE ClassificationID = ?",
        [row.ClassificationID],
      )
    } else {
      await connection.execute(
        'UPDATE deduction_loan_classification SET AppliesTo = ? WHERE ClassificationID = ?',
        [Number(row.DeductionCount) > 0 ? 'Deduction' : 'Loan', row.ClassificationID],
      )
    }
  }
  await connection.query("ALTER TABLE deduction_loan_classification MODIFY AppliesTo ENUM('Loan', 'Deduction') NOT NULL DEFAULT 'Loan'")

  const indexes = [
    ['loan_type', 'uq_loan_type_name', 'UNIQUE KEY uq_loan_type_name (LoanName)'],
    ['loan_type', 'idx_loan_type_classification', 'KEY idx_loan_type_classification (ClassificationID)'],
    ['deduction_type', 'uq_deduction_type_name', 'UNIQUE KEY uq_deduction_type_name (DeductionName)'],
    ['deduction_type', 'idx_deduction_type_classification', 'KEY idx_deduction_type_classification (ClassificationID)'],
  ]
  for (const [table, name, definition] of indexes) {
    if (!await hasIndex(table, name)) await connection.query(`ALTER TABLE \`${table}\` ADD ${definition}`)
  }

  const foreignKeys = [
    ['loan_type', 'fk_loan_type_classification'],
    ['deduction_type', 'fk_deduction_type_classification'],
  ]
  for (const [table, name] of foreignKeys) {
    if (!await hasForeignKey(table, name)) {
      await connection.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` FOREIGN KEY (ClassificationID) REFERENCES deduction_loan_classification (ClassificationID) ON DELETE RESTRICT ON UPDATE CASCADE`)
    }
  }

  console.log('Deduction and loan catalog migration applied.')
} finally {
  await connection.end()
}

