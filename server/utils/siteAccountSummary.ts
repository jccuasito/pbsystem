import { createError, getQuery } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

function validDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value
}
export function groupSiteAccountSummary(accounts: any[], sites: any[]) {
  const groups = new Map<number, any>(accounts.map(account => [Number(account.SiteAccountID), { ...account, sites: [] }]))
  for (const site of sites) {
    const key = Number(site.SiteAccountID || 0)
    if (!groups.has(key)) groups.set(key, { SiteAccountID: key, SiteAccountName: 'Unassigned sites', Status: 'Unassigned', sites: [] })
    groups.get(key).sites.push(site)
  }
  const finish = (rows: any[]) => {
    const counts = { SiteCount: rows.length, DtrCount: 0, FinalizedDtrCount: 0, PayrollEntries: 0, SitesWithoutDtr: 0 }
    const amounts = { Gross: 0, Deductions: 0, Net: 0 }
    for (const row of rows) {
      counts.DtrCount += Number(row.DtrCount || 0)
      counts.FinalizedDtrCount += Number(row.FinalizedDtrCount || 0)
      counts.PayrollEntries += Number(row.PayrollEntries || 0)
      if (!Number(row.DtrCount)) counts.SitesWithoutDtr++
      for (const key of ['Gross','Deductions','Net'] as const) amounts[key] += Math.round(Number(row[key] || 0) * 100)
    }
    return { ...counts, ...Object.fromEntries(Object.entries(amounts).map(([key,cents])=>[key,cents/100])),
      Ready: counts.DtrCount > 0 && counts.SitesWithoutDtr === 0 && counts.FinalizedDtrCount === counts.DtrCount }
  }
  return { accounts: [...groups.values()].map(group=>({ ...group, ...finish(group.sites) })), totals: finish(sites) }
}

export async function listSiteAccountPayroll(event: any) {
  const session = requireSession(event)
  void session.sub
  const query = getQuery(event)
  if (Array.isArray(query.periodStart) || Array.isArray(query.periodEnd)) throw createError({ statusCode: 400, statusMessage: 'Select a single payroll cutoff.' })
  const [cutoffs] = await pool.execute<any[]>(`SELECT DISTINCT DATE_FORMAT(PeriodStart,'%Y-%m-%d') AS PeriodStart,
    DATE_FORMAT(PeriodEnd,'%Y-%m-%d') AS PeriodEnd FROM attendance_dtr ORDER BY PeriodEnd DESC,PeriodStart DESC`)
  const start = String(query.periodStart || cutoffs[0]?.PeriodStart || '')
  const end = String(query.periodEnd || cutoffs[0]?.PeriodEnd || '')
  if ((query.periodStart || query.periodEnd) && (!query.periodStart || !query.periodEnd)) throw createError({ statusCode: 400, statusMessage: 'Select both cutoff dates.' })
  if ((start || end) && (!validDay(start) || !validDay(end) || start > end)) throw createError({ statusCode: 400, statusMessage: 'Select a valid payroll cutoff.' })
  const [accounts] = await pool.execute<any[]>('SELECT SiteAccountID,SiteAccountName,Status FROM site_account ORDER BY SiteAccountName')
  if (!start) return { ...groupSiteAccountSummary(accounts,[]), cutoffs, period: null, grouping: 'current-site-agency-links' }
  // Aggregate each posting before joining site/account rows; agency/rate links must
  // never fan out one employee payroll into multiple monetary contributions.
  const [sites] = await pool.execute<any[]>(`SELECT s.SiteID,s.SiteName,c.ClientName,expected.AgencyID,a.AgencyName,coverage.SiteAccountID,
      COUNT(d.BatchID) AS DtrCount,
      COALESCE(SUM(CASE WHEN t.PayrollEntries>0 AND t.PayrollEntries=t.PostingCount THEN 1 ELSE 0 END),0) AS FinalizedDtrCount,
      COALESCE(SUM(t.PayrollEntries),0) AS PayrollEntries,
      COALESCE(SUM(t.Gross),0) AS Gross,COALESCE(SUM(t.Deductions),0) AS Deductions,COALESCE(SUM(t.Net),0) AS Net
    FROM (
      SELECT link.SiteID,link.AgencyID FROM site_agency link
      INNER JOIN site covered ON covered.SiteID=link.SiteID AND covered.Status='Active'
      INNER JOIN agency company ON company.AgencyID=link.AgencyID AND company.Status='Active'
      WHERE link.Status='Active'
      UNION SELECT SiteID,AgencyID FROM attendance_dtr WHERE PeriodStart=? AND PeriodEnd=?
      UNION SELECT unassigned.SiteID,NULL AS AgencyID FROM site unassigned WHERE unassigned.Status='Active'
        AND NOT EXISTS(SELECT 1 FROM site_agency link INNER JOIN agency company ON company.AgencyID=link.AgencyID AND company.Status='Active' WHERE link.SiteID=unassigned.SiteID AND link.Status='Active')
        AND NOT EXISTS(SELECT 1 FROM attendance_dtr source WHERE source.SiteID=unassigned.SiteID AND source.PeriodStart=? AND source.PeriodEnd=?)
    ) expected
    INNER JOIN site s ON s.SiteID=expected.SiteID INNER JOIN client c ON c.ClientID=s.ClientID
    LEFT JOIN agency a ON a.AgencyID=expected.AgencyID
    LEFT JOIN site_agency coverage ON coverage.SiteID=expected.SiteID AND coverage.AgencyID=expected.AgencyID
    LEFT JOIN attendance_dtr d ON d.SiteID=s.SiteID AND d.AgencyID=expected.AgencyID AND d.PeriodStart=? AND d.PeriodEnd=?
    LEFT JOIN (
      SELECT p.BatchID,COUNT(*) AS PostingCount,
        SUM(CASE WHEN py.Status IN ('Approved','Released') THEN 1 ELSE 0 END) AS PayrollEntries,
        SUM(CASE WHEN py.Status IN ('Approved','Released') THEN py.GrossPay ELSE 0 END) AS Gross,
        SUM(CASE WHEN py.Status IN ('Approved','Released') THEN py.TotalDeduction ELSE 0 END) AS Deductions,
        SUM(CASE WHEN py.Status IN ('Approved','Released') THEN py.NetPay ELSE 0 END) AS Net
      FROM (SELECT DISTINCT BatchID,PayrollID FROM payroll_processing_posting WHERE Status='Active') p
      INNER JOIN payroll py ON py.PayrollID=p.PayrollID
      INNER JOIN attendance_dtr source ON source.BatchID=p.BatchID AND source.PeriodStart=? AND source.PeriodEnd=?
      GROUP BY p.BatchID
    ) t ON t.BatchID=d.BatchID
    GROUP BY s.SiteID,s.SiteName,c.ClientName,expected.AgencyID,a.AgencyName,coverage.SiteAccountID
    ORDER BY c.ClientName,s.SiteName,a.AgencyName`, [start,end,start,end,start,end,start,end])
  return { ...groupSiteAccountSummary(accounts,sites), cutoffs, period: { PeriodStart: start, PeriodEnd: end }, grouping: 'current-site-agency-links' }
}
