import pool from '../../connection/dbconnect'
import { requireSession } from '../../utils/auth'

function relativeTime(value: Date | string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`
  if (seconds < 172800) return 'Yesterday'
  return `${Math.floor(seconds / 86400)} days ago`
}

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  const [rows] = await pool.execute<any[]>(`
    SELECT text, activityAt FROM (
      SELECT CONCAT('Payroll for ', DATE_FORMAT(StartDate, '%b %e'), '-', DATE_FORMAT(EndDate, '%e'), ' cutoff is ', LOWER(Status)) AS text, PayrollDate AS activityAt FROM payroll
      UNION ALL
      SELECT CONCAT('Attendance for ', DATE_FORMAT(AttendanceDate, '%b %e'), ' was marked ', AttendanceStatus) AS text, COALESCE(UpdatedAt, CreatedAt) AS activityAt FROM attendance
      UNION ALL
      SELECT CONCAT('Billing for ', BillingPeriod, ' is ', LOWER(Status)) AS text, BillingDate AS activityAt FROM billing
    ) AS activities WHERE activityAt IS NOT NULL ORDER BY activityAt DESC LIMIT 5
  `)
  return { activities: rows.map((row) => ({ text: row.text, time: relativeTime(row.activityAt) })) }
})
