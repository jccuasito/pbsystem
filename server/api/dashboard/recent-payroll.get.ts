import pool from '../../connection/dbconnect'
import { requireSession } from '../../utils/auth'

const pesoFormat = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

export default defineEventHandler(async (event) => {
  const session = requireSession(event)

  const [rows] = await pool.execute<any[]>(`
    SELECT p.PayrollID, CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName) AS name,
      DATE_FORMAT(p.StartDate, '%b %e') AS periodStart, DATE_FORMAT(p.EndDate, '%e, %Y') AS periodEnd,
      p.NetPay, p.Status
    FROM payroll p INNER JOIN employee e ON e.EmployeeID = p.EmployeeID
    ORDER BY p.PayrollDate DESC, p.PayrollID DESC LIMIT 5
  `)

  return { payroll: rows.map((row) => ({ id: row.PayrollID, name: row.name, period: `${row.periodStart}-${row.periodEnd}`, amount: pesoFormat.format(Number(row.NetPay)), status: row.Status })) }
})
