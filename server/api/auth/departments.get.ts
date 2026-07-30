import pool from '../../connection/dbconnect'
export default defineEventHandler(async () => { const [rows] = await pool.execute<any[]>('SELECT DepartmentID, DepartmentName FROM department WHERE Status = \'Active\' ORDER BY DepartmentName'); return { departments: rows } })
