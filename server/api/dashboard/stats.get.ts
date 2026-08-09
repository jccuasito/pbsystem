import pool from '../../connection/dbconnect'
import { requireSession } from '../../utils/auth'

function finiteNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

export default defineEventHandler(async (event) => {
  const session = requireSession(event)

  const [[[totals]], [[previousBilling]], [[activeSites]], [[loansCompletingSoon]]] = await Promise.all([
    pool.execute<any[]>(`
      SELECT
        (SELECT COUNT(*) FROM employee WHERE Status = 'Active') AS totalEmployees,
        (SELECT COUNT(*) FROM employee WHERE Status = 'Active' AND DateHired >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS employeesHiredThisMonth,
        (SELECT COUNT(DISTINCT EmployeeID) FROM attendance WHERE AttendanceDate = CURDATE() AND AttendanceStatus = 'Present') AS presentToday,
        (SELECT COUNT(*) FROM payroll WHERE Status = 'For Approval') AS pendingPayroll,
        (SELECT COALESCE(SUM(TotalAmount), 0) FROM billing WHERE YEAR(BillingDate) = YEAR(CURDATE()) AND MONTH(BillingDate) = MONTH(CURDATE())) AS currentMonthBilling,
        (SELECT COUNT(*) FROM employee_deployment WHERE EndDate IS NULL OR EndDate >= CURDATE()) AS activeDeployments,
        (SELECT COUNT(*) FROM employee_loan WHERE Status = 'Active') AS activeLoans
    `),
    pool.execute<any[]>(`SELECT COALESCE(SUM(TotalAmount), 0) AS total FROM billing WHERE YEAR(BillingDate) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) AND MONTH(BillingDate) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))`),
    pool.execute<any[]>(`SELECT COUNT(DISTINCT SiteID) AS count FROM employee_deployment WHERE EndDate IS NULL OR EndDate >= CURDATE()`),
    pool.execute<any[]>(`SELECT COUNT(*) AS count FROM employee_loan WHERE Status = 'Active' AND EndDate BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)`)
  ])

  const totalEmployees = finiteNumber(totals.totalEmployees)
  const employeesHiredThisMonth = finiteNumber(totals.employeesHiredThisMonth)
  const presentToday = finiteNumber(totals.presentToday)
  const pendingPayroll = finiteNumber(totals.pendingPayroll)
  const currentMonthBilling = finiteNumber(totals.currentMonthBilling)
  const activeDeployments = finiteNumber(totals.activeDeployments)
  const activeLoans = finiteNumber(totals.activeLoans)
  const lastMonthBilling = finiteNumber(previousBilling.total)
  const siteCount = finiteNumber(activeSites.count)
  const loansCompletingSoonCount = finiteNumber(loansCompletingSoon.count)
  const billingTrend = lastMonthBilling > 0
    ? `${currentMonthBilling >= lastMonthBilling ? '+' : ''}${((currentMonthBilling - lastMonthBilling) / lastMonthBilling * 100).toFixed(1)}% vs last month`
    : 'No billing last month'

  return {
    stats: [
      { label: 'Total Employees', value: totalEmployees, trend: `${employeesHiredThisMonth} hired this month`, trendType: 'up', icon: 'user' },
      { label: 'Present Today', value: presentToday, trend: `${totalEmployees ? (presentToday / totalEmployees * 100).toFixed(1) : '0.0'}% attendance`, trendType: 'flat', icon: 'clock' },
      { label: 'Pending Payroll', value: pendingPayroll, trend: 'For Approval', trendType: 'warn', icon: 'peso' },
      { label: "This Month's Billing", value: currentMonthBilling, trend: billingTrend, trendType: currentMonthBilling >= lastMonthBilling ? 'up' : 'warn', icon: 'file-text' },
      { label: 'Active Deployments', value: activeDeployments, trend: `across ${siteCount} sites`, trendType: 'flat', icon: 'building' },
      { label: 'Active Loans', value: activeLoans, trend: `${loansCompletingSoonCount} completing soon`, trendType: 'warn', icon: 'peso' }
    ]
  }
})
