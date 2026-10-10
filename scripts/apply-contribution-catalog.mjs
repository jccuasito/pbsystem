import mysql from 'mysql2/promise'

const database = process.env.DB_NAME || 'pbsystem'
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database,
})

try {
  const [columnRows] = await connection.execute(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'deduction_loan_classification' AND COLUMN_NAME = 'AppliesTo'`,
    [database],
  )
  if (!columnRows[0]) throw new Error('Apply the deduction/loan catalog migration first.')
  if (!String(columnRows[0].COLUMN_TYPE).includes("'Contribution'")) {
    await connection.query("ALTER TABLE deduction_loan_classification MODIFY AppliesTo ENUM('Loan', 'Deduction', 'Contribution') NOT NULL DEFAULT 'Loan'")
  }
  const [indexes] = await connection.execute(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'deduction_loan_classification'
        AND INDEX_NAME IN ('uq_deduction_loan_classification_name', 'uq_deduction_loan_classification_scope_name')`,
    [database],
  )
  const names = new Set(indexes.map(row => row.INDEX_NAME))
  if (!names.has('uq_deduction_loan_classification_scope_name')) {
    await connection.query('ALTER TABLE deduction_loan_classification ADD UNIQUE KEY uq_deduction_loan_classification_scope_name (AppliesTo, ClassificationName)')
  }
  if (names.has('uq_deduction_loan_classification_name')) {
    await connection.query('ALTER TABLE deduction_loan_classification DROP INDEX uq_deduction_loan_classification_name')
  }
  console.log('Contribution classification type is ready.')
} finally {
  await connection.end()
}
