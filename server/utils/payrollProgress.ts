import { createError, getQuery } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

export function payrollProgressPercent(completed: number, expected: number) {
  if (!expected) return null
  // Never round an incomplete run up to 100%.
  return completed === expected ? 100 : Math.floor(completed * 1000 / expected) / 10
}
export function groupPayrollProgress(rows: any[], unconfiguredSites = 0) {
  const companies = new Map<number, any>(), seen = new Set<string>()
  for (const row of rows) {
    const agencyId=Number(row.AgencyID), siteId=Number(row.SiteID), key=`${agencyId}:${siteId}`
    if(seen.has(key))continue
    seen.add(key)
    if(!companies.has(agencyId)) companies.set(agencyId,{AgencyID:agencyId,AgencyName:row.AgencyName,groups:new Map<number,any>()})
    const company=companies.get(agencyId), accountId=Number(row.SiteAccountID||0)
    if(!company.groups.has(accountId))company.groups.set(accountId,{SiteAccountID:accountId,SiteAccountName:row.SiteAccountName||'Unassigned Site Account',sites:[]})
    const hasDtr=Number(row.DtrCount)>0
    company.groups.get(accountId).sites.push({SiteID:siteId,SiteName:row.SiteName,
      Status:!hasDtr?'No DTR':Number(row.FinalizedDtrCount)===Number(row.DtrCount)?'Finalized':'Pending payroll'})
  }
  function counts(sites:any[]){
    const ExpectedSites=sites.length,CompletedSites=sites.filter(site=>site.Status==='Finalized').length
    return{ExpectedSites,CompletedSites,PendingSites:ExpectedSites-CompletedSites,MissingDtrSites:sites.filter(site=>site.Status==='No DTR').length,Percent:payrollProgressPercent(CompletedSites,ExpectedSites)}
  }
  const result=[...companies.values()].map(company=>{
    const groups=[...company.groups.values()].sort((a:any,b:any)=>a.SiteAccountName.localeCompare(b.SiteAccountName)).map((group:any)=>({...group,...counts(group.sites)}))
    return{...company,groups,...counts(groups.flatMap(group=>group.sites))}
  }).sort((a,b)=>a.AgencyName.localeCompare(b.AgencyName))
  const totals=counts(result.flatMap(company=>company.groups.flatMap(group=>group.sites)))
  return{companies:result,totals:{...totals,UnconfiguredSites:unconfiguredSites,Percent:unconfiguredSites?null:totals.Percent}}
}
function currentCutoff(){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]))
  const last=new Date(Date.UTC(Number(parts.year),Number(parts.month),0)).getUTCDate()
  return{PeriodStart:`${parts.year}-${parts.month}-${Number(parts.day)<=15?'01':'16'}`,PeriodEnd:`${parts.year}-${parts.month}-${Number(parts.day)<=15?'15':last}`}
}
function validDay(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value}
export async function listPayrollProgress(event:any){
  const session=requireSession(event)
  void session.sub
  const query=getQuery(event)
  if(Array.isArray(query.periodStart)||Array.isArray(query.periodEnd))throw createError({statusCode:400,statusMessage:'Select a single payroll cutoff.'})
  const supplied=Boolean(query.periodStart||query.periodEnd)
  if(supplied&&(!validDay(String(query.periodStart||''))||!validDay(String(query.periodEnd||''))||String(query.periodStart)>String(query.periodEnd)))throw createError({statusCode:400,statusMessage:'Select a valid payroll cutoff.'})
  const [recorded]=await pool.execute<any[]>(`SELECT DISTINCT DATE_FORMAT(PeriodStart,'%Y-%m-%d') AS PeriodStart,DATE_FORMAT(PeriodEnd,'%Y-%m-%d') AS PeriodEnd FROM attendance_dtr ORDER BY PeriodEnd DESC,PeriodStart DESC`)
  const current=currentCutoff(),period=supplied?{PeriodStart:String(query.periodStart),PeriodEnd:String(query.periodEnd)}:recorded[0]||current
  const cutoffs=[...new Map([...recorded,current,period].map(row=>[`${row.PeriodStart}:${row.PeriodEnd}`,row])).values()].sort((a,b)=>b.PeriodEnd.localeCompare(a.PeriodEnd)||b.PeriodStart.localeCompare(a.PeriodStart))
  const {PeriodStart:start,PeriodEnd:end}=period
  const [rows]=await pool.execute<any[]>(`SELECT expected.AgencyID,a.AgencyName,s.SiteID,s.SiteName,coverage.SiteAccountID,sa.SiteAccountName,
      COUNT(d.BatchID) AS DtrCount,
      COALESCE(SUM(CASE WHEN posted.PostingCount>0 AND posted.PostingCount=posted.FinalizedCount THEN 1 ELSE 0 END),0) AS FinalizedDtrCount
    FROM (
      SELECT link.AgencyID,link.SiteID FROM site_agency link
      INNER JOIN site covered ON covered.SiteID=link.SiteID AND covered.Status='Active'
      INNER JOIN agency coveredAgency ON coveredAgency.AgencyID=link.AgencyID AND coveredAgency.Status='Active'
      WHERE link.Status='Active'
      UNION SELECT AgencyID,SiteID FROM attendance_dtr WHERE PeriodStart=? AND PeriodEnd=?
    ) expected
    INNER JOIN agency a ON a.AgencyID=expected.AgencyID
    INNER JOIN site s ON s.SiteID=expected.SiteID
    LEFT JOIN site_agency coverage ON coverage.SiteID=s.SiteID AND coverage.AgencyID=expected.AgencyID
    LEFT JOIN site_account sa ON sa.SiteAccountID=coverage.SiteAccountID
    LEFT JOIN attendance_dtr d ON d.AgencyID=expected.AgencyID AND d.SiteID=expected.SiteID AND d.PeriodStart=? AND d.PeriodEnd=?
    LEFT JOIN (
      SELECT links.BatchID,COUNT(*) AS PostingCount,SUM(CASE WHEN py.Status IN ('Approved','Released') THEN 1 ELSE 0 END) AS FinalizedCount
      FROM (SELECT DISTINCT BatchID,PayrollID FROM payroll_processing_posting WHERE Status='Active') links
      INNER JOIN payroll py ON py.PayrollID=links.PayrollID
      INNER JOIN attendance_dtr source ON source.BatchID=links.BatchID AND source.PeriodStart=? AND source.PeriodEnd=?
      GROUP BY links.BatchID
    ) posted ON posted.BatchID=d.BatchID
    GROUP BY expected.AgencyID,a.AgencyName,s.SiteID,s.SiteName,coverage.SiteAccountID,sa.SiteAccountName
    ORDER BY a.AgencyName,sa.SiteAccountName,s.SiteName`,[start,end,start,end,start,end])
  const [[unconfigured]]=await pool.execute<any[]>(`SELECT COUNT(*) AS total FROM site s WHERE s.Status='Active'
    AND NOT EXISTS(SELECT 1 FROM site_agency link INNER JOIN agency a ON a.AgencyID=link.AgencyID AND a.Status='Active' WHERE link.SiteID=s.SiteID AND link.Status='Active')
    AND NOT EXISTS(SELECT 1 FROM attendance_dtr d WHERE d.SiteID=s.SiteID AND d.PeriodStart=? AND d.PeriodEnd=?)`,[start,end])
  return{...groupPayrollProgress(rows,Number(unconfigured.total||0)),cutoffs,period,basis:'current-site-agency-coverage-and-cutoff-dtrs',grouping:'current-site-agency-links'}
}
