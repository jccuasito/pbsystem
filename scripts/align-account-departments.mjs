import mysql from 'mysql2/promise'

const requiredNames = [
  'HR Department',
  'Billing Department',
  'Accounting Department',
  'Logestics Department',
  'Operations Department',
  'IT Department'
]

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem'
})

try {
  await connection.beginTransaction()
  for (const name of requiredNames) {
    await connection.execute("INSERT INTO department (DepartmentName, Status) VALUES (?, 'Active') ON DUPLICATE KEY UPDATE Status = 'Active'", [name])
  }
  const [departments] = await connection.execute('SELECT DepartmentID, DepartmentName FROM department WHERE Status = ? FOR UPDATE', ['Active'])
  for (const department of departments) {
    if (requiredNames.some(name => name.toLowerCase() === department.DepartmentName.toLowerCase())) continue
    const [assigned] = await connection.execute('SELECT UserID FROM `user` WHERE DepartmentID = ? LIMIT 1', [department.DepartmentID])
    if (assigned.length) throw new Error(`Cannot remove ${department.DepartmentName}: user accounts are assigned to it.`)
    await connection.execute("UPDATE department SET Status = 'Inactive' WHERE DepartmentID = ?", [department.DepartmentID])
  }
  await connection.commit()
  console.log('Active account departments aligned with the six approved names.')
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  await connection.end()
}
