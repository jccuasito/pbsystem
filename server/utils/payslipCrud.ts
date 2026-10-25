import { getQuery, createError, setHeader } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

// Shared source validation keeps employee and site publication filters in sync.
export const finalizedPayslipCte = `WITH finalized AS (
  SELECT py.EmployeeID,py.PayrollID,py.GrossPay,py.TotalDeduction,py.NetPay,pp.BatchID,
    CONCAT(DATE_FORMAT(py.StartDate,'%Y-%m-%d'),':',DATE_FORMAT(py.EndDate,'%Y-%m-%d'),':',
      -- Legacy deployment and DTR enrollment columns can use different collations.
      -- Normalize the expression before comparing; do not alter stored payroll data.
      CASE WHEN CONVERT(COALESCE(de.AttendanceType,ed.DeploymentType,'Regular') USING utf8mb4) COLLATE utf8mb4_unicode_ci='Reliever'
        THEN CONCAT('reliever:',COALESCE(NULLIF(COALESCE(d.SiteID,ed.SiteID),0),CONCAT('payroll:',py.PayrollID))) ELSE 'regular' END) AS GroupKey
  FROM payroll py
  LEFT JOIN payroll_processing_posting pp ON pp.PayrollID=py.PayrollID AND pp.Status='Active'
  LEFT JOIN attendance_dtr d ON d.BatchID=pp.BatchID
  LEFT JOIN attendance_dtr_employee de ON de.BatchID=pp.BatchID AND de.EmployeeID=py.EmployeeID
  LEFT JOIN employee_deployment ed ON ed.DeploymentID=py.DeploymentID
  WHERE py.Status IN ('Approved','Released')
), current_groups AS (
  SELECT EmployeeID,GroupKey,COUNT(*) AS SourceCount FROM finalized GROUP BY EmployeeID,GroupKey
), valid_publications AS (
  SELECT pub.EmployeeID,pub.GroupKey FROM payslip_publication pub
  JOIN current_groups g ON g.EmployeeID=pub.EmployeeID AND g.GroupKey=pub.GroupKey
  LEFT JOIN payslip_publication_source src ON src.PublicationID=pub.PublicationID
  LEFT JOIN finalized f ON f.PayrollID=src.PayrollID AND f.EmployeeID=pub.EmployeeID AND f.GroupKey=pub.GroupKey
  WHERE pub.Status='Posted'
  GROUP BY pub.PublicationID,pub.EmployeeID,pub.GroupKey,g.SourceCount
  HAVING COUNT(src.PayrollID)=g.SourceCount AND COUNT(f.PayrollID)=g.SourceCount
)`

const cents = (value: unknown) => Math.round(Number(value || 0) * 100)
const pesos = (value: number) => value / 100
const governmentProvider = (name: string) => /pag[ -]?ibig|social security system|^sss$|philhealth/i.test(name)

function displayName(name: string, classification: string | null) {
  const provider = classification === 'Social Security System' ? 'SSS'
    : /^pag[ -]?ibig$/i.test(classification || '') ? 'Pag-ibig' : classification || ''
  return provider && provider.toLowerCase() !== name.toLowerCase() ? `${provider} · ${name}` : provider || name
}

function addLine(lines: Map<string, any>, section: string, label: string, amount: unknown, hours = 0) {
  const key = `${section}:${label}`
  const line = lines.get(key) || { section, label, hours: 0, amountCents: 0 }
  line.hours += Number(hours || 0)
  line.amountCents += Math.abs(cents(amount))
  lines.set(key, line)
}

export function payslipGroups(payrolls: any[], details: any[], deductions: any[], transactions: any[]) {
  const grouped = new Map<string, any>()
  const groupByPayrollId = new Map<number, any>()
  const loanTransactions = new Set(transactions.filter(item => item.EntryType === 'Loan').map(item => Number(item.PayrollID)))
  for (const payroll of payrolls) {
    const isReliever = payroll.AssignmentType === 'Reliever'
    const siteId = Number(payroll.SiteID || 0)
    const key = `${payroll.PeriodStart}:${payroll.PeriodEnd}:${isReliever ? `reliever:${siteId || `payroll:${payroll.PayrollID}`}` : 'regular'}`
    const group = grouped.get(key) || {
      key, periodStart: payroll.PeriodStart, periodEnd: payroll.PeriodEnd, status: 'Released',
      assignmentType: isReliever ? 'Reliever' : 'Regular',
      siteName: isReliever ? payroll.SiteName || 'Unassigned site' : null,
      payrollIds: [], sources: [], grossCents: 0, deductionCents: 0, netCents: 0,
      lines: new Map<string, any>(),
    }
    group.payrollIds.push(Number(payroll.PayrollID))
    group.sources.push({ payrollId: Number(payroll.PayrollID), batchId: payroll.BatchID,
      siteName: payroll.SiteName || 'Unassigned site', clientName: payroll.ClientName || '',
      gross: Number(payroll.GrossPay), deductions: Number(payroll.TotalDeduction), net: Number(payroll.NetPay) })
    group.grossCents += cents(payroll.GrossPay)
    group.deductionCents += cents(payroll.TotalDeduction)
    group.netCents += cents(payroll.NetPay)
    if (payroll.Status !== 'Released') group.status = 'Approved'
    grouped.set(key, group)
    groupByPayrollId.set(Number(payroll.PayrollID), group)
  }
  const groupFor = (payrollId: number) => groupByPayrollId.get(Number(payrollId))
  for (const detail of details) {
    const group = groupFor(detail.PayrollID)
    if (!group) continue
    const description = String(detail.Description || '').trim()
    const amount = Number(detail.Amount || 0)
    if (description.startsWith('Loan:')) {
      if (!loanTransactions.has(Number(detail.PayrollID))) addLine(group.lines, 'other', description.slice(5).trim(), amount)
    } else if (description.startsWith('Adjustment #')) {
      const match = /^Adjustment #\d+:\s*(.*?)(?:\s+-\s+\d{4}-\d{2}-\d{2})?$/.exec(description)
      addLine(group.lines, amount >= 0 ? 'adjustment' : 'other',
        `Adjustment · ${match?.[1] || description}`, amount, Number(detail.Quantity || 0))
    } else {
      const isLateUndertime = description === 'Late' || description === 'Undertime'
      addLine(group.lines, amount >= 0 ? 'earnings' : 'other',
        isLateUndertime ? 'Late / Undertime' : description, amount,
        amount >= 0 || isLateUndertime ? Number(detail.Quantity || 0) : 0)
    }
  }
  for (const deduction of deductions) {
    const group = groupFor(deduction.PayrollID)
    if (!group) continue
    const name = String(deduction.DeductionName || 'Deduction')
    const classification = deduction.ClassificationName ? String(deduction.ClassificationName) : null
    addLine(group.lines, governmentProvider(classification || '') ? 'government' : 'other',
      displayName(name, classification), deduction.Amount)
  }
  for (const transaction of transactions) {
    if (transaction.EntryType !== 'Loan') continue
    const group = groupFor(transaction.PayrollID)
    if (!group) continue
    const classification = transaction.ClassificationName ? String(transaction.ClassificationName) : null
    addLine(group.lines, governmentProvider(classification || '') ? 'government' : 'other',
      displayName(String(transaction.ItemName || 'Loan'), classification), transaction.Amount)
  }
  for (const group of grouped.values()) {
    const earningLines = [...group.lines.values()].filter((line: any) => ['earnings', 'adjustment'].includes(line.section))
    const deductionLines = [...group.lines.values()].filter((line: any) => ['government', 'other'].includes(line.section))
    const unitemizedEarnings = group.grossCents - earningLines.reduce((sum: number, line: any) => sum + line.amountCents, 0)
    const unitemizedDeductions = group.deductionCents - deductionLines.reduce((sum: number, line: any) => sum + line.amountCents, 0)
    if (unitemizedEarnings > 0) addLine(group.lines, 'earnings', 'Other posted earnings', pesos(unitemizedEarnings))
    if (unitemizedDeductions > 0) addLine(group.lines, 'other', 'Other posted deductions', pesos(unitemizedDeductions))
  }
  return [...grouped.values()].map(group => ({
    key: group.key, periodStart: group.periodStart, periodEnd: group.periodEnd, status: group.status,
    assignmentType: group.assignmentType, siteName: group.siteName,
    payrollIds: group.payrollIds, sources: group.sources,
    gross: pesos(group.grossCents), deductions: pesos(group.deductionCents), net: pesos(group.netCents),
    lines: [...group.lines.values()].map(line => ({ section: line.section, label: line.label,
      hours: Math.round(line.hours * 100) / 100, amount: pesos(line.amountCents) })),
  })).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.periodStart.localeCompare(a.periodStart)
    || a.assignmentType.localeCompare(b.assignmentType) || (a.siteName || '').localeCompare(b.siteName || ''))
}

export async function readPayslipProfiles(employeeIds:number[],db:any=pool,period?:{start:string;end:string}) {
  const ids=[...new Set(employeeIds)]
  if(!ids.length)return []
  const marks=ids.map(()=>'?').join(',')
  const [employees]=await db.execute<any[]>(`SELECT e.EmployeeID,e.EmployeeNumber,
    CONCAT_WS(', ',e.LastName,CONCAT_WS(' ',e.FirstName,e.MiddleName)) AS EmployeeName,
    e.Status,a.AgencyName,p.PositionName FROM employee e
    LEFT JOIN agency_position ap ON ap.AgencyPositionID=e.AgencyPositionID
    LEFT JOIN agency a ON a.AgencyID=ap.AgencyID
    LEFT JOIN \`position\` p ON p.PositionID=ap.PositionID WHERE e.EmployeeID IN (${marks}) ORDER BY e.EmployeeID`,ids)
  const [payrolls]=await db.execute<any[]>(`SELECT py.EmployeeID,py.PayrollID,py.Status,
    DATE_FORMAT(py.StartDate,'%Y-%m-%d') AS PeriodStart,DATE_FORMAT(py.EndDate,'%Y-%m-%d') AS PeriodEnd,
    py.GrossPay,py.TotalDeduction,py.NetPay,pp.BatchID,COALESCE(d.SiteID,ed.SiteID) AS SiteID,
    COALESCE(de.AttendanceType,ed.DeploymentType,'Regular') AS AssignmentType,
    COALESCE(dsite.SiteName,deploymentSite.SiteName) AS SiteName,client.ClientName
    FROM payroll py
    LEFT JOIN payroll_processing_posting pp ON pp.PayrollID=py.PayrollID AND pp.Status='Active'
    LEFT JOIN attendance_dtr d ON d.BatchID=pp.BatchID
    LEFT JOIN site dsite ON dsite.SiteID=d.SiteID
    LEFT JOIN client ON client.ClientID=d.ClientID
    LEFT JOIN attendance_dtr_employee de ON de.BatchID=pp.BatchID AND de.EmployeeID=py.EmployeeID
    LEFT JOIN employee_deployment ed ON ed.DeploymentID=py.DeploymentID
    LEFT JOIN site deploymentSite ON deploymentSite.SiteID=ed.SiteID
    WHERE py.EmployeeID IN (${marks}) AND py.Status IN ('Approved','Released')
    ${period?'AND py.StartDate=? AND py.EndDate=?':''}
    ORDER BY py.EndDate DESC,py.StartDate DESC,py.PayrollID DESC`,[...ids,...(period?[period.start,period.end]:[])])
  if(!payrolls.length)return employees.map(employee=>({employee,cutoffs:[]}))
  const payrollIds=payrolls.map(row=>Number(row.PayrollID)),payrollMarks=payrollIds.map(()=>'?').join(',')
  const [[details],[deductions],[transactions],[publications]]=await Promise.all([
    db.execute<any[]>(`SELECT PayrollID,Description,Quantity,Amount FROM payroll_detail WHERE PayrollID IN (${payrollMarks}) ORDER BY PayrollID,PayrollDetailID`,payrollIds),
    db.execute<any[]>(`SELECT pd.PayrollID,pd.ReferenceType,pd.Amount,dt.DeductionName,c.ClassificationName
      FROM payroll_deduction pd LEFT JOIN deduction_type dt ON dt.DeductionTypeID=pd.DeductionTypeID
      LEFT JOIN deduction_loan_classification c ON c.ClassificationID=dt.ClassificationID
      WHERE pd.PayrollID IN (${payrollMarks}) ORDER BY pd.PayrollID,pd.PayrollDeductionID`,payrollIds),
    db.execute<any[]>(`SELECT PayrollID,EntryType,ItemName,ClassificationName,Amount FROM employee_account_transaction
      WHERE PayrollID IN (${payrollMarks}) AND Status='Posted' ORDER BY PayrollID,TransactionRecordID`,payrollIds),
    // Database-local DATETIME must be converted before the driver's UTC Date interpretation.
    db.execute<any[]>(`SELECT EmployeeID,PublicationID,GroupKey,Status,SnapshotJson,
      DATE_FORMAT(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,NOW(),UTC_TIMESTAMP()),PostedAt),'%Y-%m-%dT%H:%i:%s.000Z') AS PostedAt
      FROM payslip_publication WHERE EmployeeID IN (${marks}) ${period?'AND GroupKey LIKE ?':''}`,[...ids,...(period?[period.start+':'+period.end+':%']:[])])
  ])
  const owners=new Map(payrolls.map(row=>[Number(row.PayrollID),Number(row.EmployeeID)]))
  function byEmployee(rows:any[],owner:(row:any)=>number){const grouped=new Map<number,any[]>();for(const row of rows){const id=owner(row);if(!grouped.has(id))grouped.set(id,[]);grouped.get(id)!.push(row)}return grouped}
  const pay=byEmployee(payrolls,row=>Number(row.EmployeeID)),detail=byEmployee(details,row=>owners.get(Number(row.PayrollID))!),deduction=byEmployee(deductions,row=>owners.get(Number(row.PayrollID))!),transaction=byEmployee(transactions,row=>owners.get(Number(row.PayrollID))!),published=byEmployee(publications,row=>Number(row.EmployeeID))
  return employees.map(employee=>{
    const id=Number(employee.EmployeeID),cutoffs=payslipGroups(pay.get(id)||[],detail.get(id)||[],deduction.get(id)||[],transaction.get(id)||[])
    for(const cutoff of cutoffs){
      const publication=(published.get(id)||[]).find(row=>row.GroupKey===cutoff.key)
      let saved:any=null;try{saved=publication?JSON.parse(publication.SnapshotJson):null}catch{}
      const sameSources=Array.isArray(saved?.cutoff?.payrollIds)&&JSON.stringify([...saved.cutoff.payrollIds].sort((a:number,b:number)=>a-b))===JSON.stringify([...cutoff.payrollIds].sort((a:number,b:number)=>a-b))
      Object.assign(cutoff,{publicationStatus:publication?.Status==='Posted'&&sameSources?'Posted':'Not Posted',publicationId:publication?.PublicationID||null,postedAt:publication?.PostedAt||null})
    }
    return{employee,cutoffs}
  })
}

export async function readEmployeePayslips(employeeId:number,db:any=pool){
  const [profile]=await readPayslipProfiles([employeeId],db)
  if(!profile)throw createError({statusCode:404,statusMessage:'Employee not found.'})
  return profile
}

export async function listPayslips(event: any) {
  const session = requireSession(event)
  void session.sub
  setHeader(event,'Cache-Control','private, no-store')
  const query = getQuery(event)
  const employeeId = Number(query.employeeId || 0)
  if (query.employeeId !== undefined && (!Number.isInteger(employeeId) || employeeId < 1)) {
    throw createError({ statusCode: 400, statusMessage: 'Select a valid employee.' })
  }
  if (employeeId) return {...await readEmployeePayslips(employeeId),canPost:session.userType!=='Viewer'&&event.context?.moduleCanEdit!==false}

  const search = String(query.search || '').trim().slice(0, 100)
  const agencyId = Number(query.agencyId || 0)
  if (query.agencyId && (!Number.isInteger(agencyId) || agencyId < 1)) {
    throw createError({ statusCode: 400, statusMessage: 'Select a valid agency.' })
  }
  const page = Math.max(1, Math.min(100000, Math.floor(Number(query.page) || 1)))
  const pageSize = 25
  const joins = `LEFT JOIN (SELECT EmployeeID,MAX(EndDate) AS LastCutoffEnd,COUNT(*) AS PayrollCount,
      COUNT(DISTINCT StartDate,EndDate) AS CutoffCount FROM payroll WHERE Status IN ('Approved','Released') GROUP BY EmployeeID) summary ON summary.EmployeeID=e.EmployeeID
    LEFT JOIN (SELECT v.EmployeeID,COUNT(*) AS PostedPayrollCount FROM valid_publications v
      JOIN finalized f ON f.EmployeeID=v.EmployeeID AND f.GroupKey=v.GroupKey
      GROUP BY v.EmployeeID) published ON published.EmployeeID=e.EmployeeID`
  const postingFilters:Record<string,string>={
    '':'1=1',posted:'COALESCE(summary.PayrollCount,0)>0 AND COALESCE(published.PostedPayrollCount,0)=summary.PayrollCount',
    'not-posted':'COALESCE(summary.PayrollCount,0)>COALESCE(published.PostedPayrollCount,0)',
    partial:'COALESCE(published.PostedPayrollCount,0)>0 AND published.PostedPayrollCount<summary.PayrollCount',
    'no-payslips':'COALESCE(summary.PayrollCount,0)=0'
  }
  const filter=String(query.postingStatus||'')
  if(!Object.hasOwn(postingFilters,filter))throw createError({statusCode:400,statusMessage:'Select a valid payslip posting status.'})
  const where = `WHERE (? = 0 OR ap.AgencyID = ?) AND (? = '' OR
    CONCAT_WS(' ', e.EmployeeNumber, e.FirstName, e.MiddleName, e.LastName) LIKE ?) AND (${postingFilters[filter]})`
  const params = [agencyId, agencyId, search, `%${search}%`]
  const [[count]] = await pool.execute<any[]>(finalizedPayslipCte+` SELECT COUNT(*) AS Total FROM employee e
    LEFT JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID ${joins} ${where}`, params)
  const [items] = await pool.execute<any[]>(finalizedPayslipCte+` SELECT e.EmployeeID, e.EmployeeNumber,
      CONCAT_WS(', ', e.LastName, CONCAT_WS(' ', e.FirstName, e.MiddleName)) AS EmployeeName,
      e.Status, a.AgencyName, p.PositionName,
      DATE_FORMAT(summary.LastCutoffEnd, '%Y-%m-%d') AS LastCutoffEnd,
      COALESCE(summary.CutoffCount,0) AS CutoffCount,COALESCE(summary.PayrollCount,0) AS PayrollCount,
      COALESCE(published.PostedPayrollCount,0) AS PostedPayrollCount,
      CASE WHEN COALESCE(summary.PayrollCount,0)=0 THEN 'No payslips'
        WHEN published.PostedPayrollCount=summary.PayrollCount THEN 'Posted'
        WHEN COALESCE(published.PostedPayrollCount,0)>0 THEN 'Partially posted' ELSE 'Not Posted' END AS PublicationStatus
    FROM employee e LEFT JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
    LEFT JOIN agency a ON a.AgencyID = ap.AgencyID
    LEFT JOIN \`position\` p ON p.PositionID = ap.PositionID
    ${joins}
    ${where} ORDER BY summary.LastCutoffEnd DESC, e.LastName, e.FirstName, e.EmployeeID
    LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize])
  const [agencies] = await pool.execute<any[]>(`SELECT AgencyID, AgencyName FROM agency
    WHERE Status = 'Active' ORDER BY AgencyName`)
  return { items, agencies, canPost:session.userType!=='Viewer'&&event.context?.moduleCanEdit!==false, pagination: { page, pageSize, total: Number(count.Total),
    pages: Math.max(1, Math.ceil(Number(count.Total) / pageSize)) } }
}
