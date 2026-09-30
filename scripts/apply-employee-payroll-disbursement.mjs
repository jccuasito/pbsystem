import mysql from 'mysql2/promise'

const database = process.env.DB_NAME || 'pbsystem'
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database,
})

async function columnExists(table, column) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [database, table, column],
  )
  return Number(rows[0]?.count || 0) > 0
}

async function columnIsNullable(table, column) {
  const [rows] = await connection.execute(
    'SELECT IS_NULLABLE AS nullable FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [database, table, column],
  )
  return String(rows[0]?.nullable || '').toUpperCase() === 'YES'
}

try {
  if (!(await columnExists('employee_profile', 'PaymentMethodEffectiveDate'))) {
    await connection.execute('ALTER TABLE employee_profile ADD COLUMN PaymentMethodEffectiveDate DATE NULL AFTER PaymentMethod')
  }

  if (!(await columnExists('bank', 'AccountName'))) {
    await connection.execute('ALTER TABLE bank ADD COLUMN AccountName VARCHAR(200) NULL AFTER EmployeeID')
  }
  await connection.execute(
    `UPDATE bank b
     INNER JOIN employee e ON e.EmployeeID = b.EmployeeID
     SET b.AccountName = UPPER(TRIM(CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName)))
     WHERE b.AccountName IS NULL OR TRIM(b.AccountName) = ''`,
  )
  if (await columnIsNullable('bank', 'AccountName')) {
    await connection.execute('ALTER TABLE bank MODIFY COLUMN AccountName VARCHAR(200) NOT NULL')
  }

  console.log('Employee payroll disbursement migration is applied.')
} finally {
  await connection.end()
}
