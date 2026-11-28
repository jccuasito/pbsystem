import { getMethod, getRequestURL } from 'h3'
import pool from '../connection/dbconnect'
import { activityScopes, activityScopeForPath, type ActivitySubject } from '../../shared/utils/activityHistory'

// Only indexed, fixed-schema lookups. Never accept a table, SQL expression or
// display label from the request. Names are snapshotted so deletion/renaming
// cannot make a future history row ambiguous.
const queries: Record<string, string> = {
  agency: 'SELECT AgencyName AS label FROM agency WHERE AgencyID=?',
  client: 'SELECT ClientName AS label FROM client WHERE ClientID=?',
  site: 'SELECT SiteName AS label FROM site WHERE SiteID=?',
  'site-account': 'SELECT SiteAccountName AS label FROM site_account WHERE SiteAccountID=?',
  position: 'SELECT PositionName AS label FROM `position` WHERE PositionID=?',
  region: 'SELECT CONCAT_WS(\' · \',RegionCode,RegionName) AS label FROM region WHERE RegionID=?',
  'shift-code': 'SELECT CONCAT_WS(\' · \',ShiftCode,ShiftName) AS label FROM shift_code WHERE ShiftCodeID=?',
  'agency-position': `SELECT CONCAT_WS(' · ',a.AgencyName,p.PositionName) AS label FROM agency_position ap INNER JOIN agency a ON a.AgencyID=ap.AgencyID INNER JOIN \`position\` p ON p.PositionID=ap.PositionID WHERE ap.AgencyPositionID=?`,
  employee: `SELECT CONCAT_WS(' ',FirstName,MiddleName,LastName) AS label FROM employee WHERE EmployeeID=?`,
  department: 'SELECT DepartmentName AS label FROM department WHERE DepartmentID=?',
  user: `SELECT CONCAT_WS(' ',FirstName,LastName) AS label FROM \`user\` WHERE UserID=?`,
  holiday: `SELECT CONCAT(HolidayName,' · ',DATE_FORMAT(HolidayDate,'%Y-%m-%d')) AS label FROM holiday WHERE HolidayID=?`,
  dtr: `SELECT CONCAT_WS(' · ',a.AgencyName,s.SiteName,CONCAT(DATE_FORMAT(d.PeriodStart,'%Y-%m-%d'),' to ',DATE_FORMAT(d.PeriodEnd,'%Y-%m-%d'))) AS label FROM attendance_dtr d INNER JOIN agency a ON a.AgencyID=d.AgencyID INNER JOIN site s ON s.SiteID=d.SiteID WHERE d.BatchID=?`,
  'payroll-rate': `SELECT CONCAT_WS(' · ',a.AgencyName,p.PositionName,r.RegionID) AS label FROM payroll_rate r INNER JOIN agency_position ap ON ap.AgencyPositionID=r.AgencyPositionID INNER JOIN agency a ON a.AgencyID=ap.AgencyID INNER JOIN \`position\` p ON p.PositionID=ap.PositionID WHERE r.PayrollRateID=?`,
  'billing-rate': `SELECT CONCAT_WS(' · ',a.AgencyName,p.PositionName,r.RegionID) AS label FROM billing_rate r INNER JOIN agency_position ap ON ap.AgencyPositionID=r.AgencyPositionID INNER JOIN agency a ON a.AgencyID=ap.AgencyID INNER JOIN \`position\` p ON p.PositionID=ap.PositionID WHERE r.BillingRateID=?`,
  'site-rate': `SELECT s.SiteName AS label FROM site_rate r INNER JOIN site s ON s.SiteID=r.SiteID WHERE r.SiteRateID=?`,
  classification: 'SELECT ClassificationName AS label FROM deduction_loan_classification WHERE ClassificationID=?',
  'loan-type': 'SELECT LoanName AS label FROM loan_type WHERE LoanTypeID=?',
  'deduction-type': 'SELECT DeductionName AS label FROM deduction_type WHERE DeductionTypeID=?',
  'cash-account': `SELECT CONCAT_WS(' / ',CONCAT_WS(' ',e.FirstName,e.LastName),dt.DeductionName) AS label FROM cash_bond_account a INNER JOIN employee e ON e.EmployeeID=a.EmployeeID INNER JOIN deduction_type dt ON dt.DeductionTypeID=a.DeductionTypeID WHERE a.AccountID=?`,
  'agency-contribution': `SELECT CONCAT_WS(' / ',a.AgencyName,p.PositionName,dt.DeductionName) AS label FROM agency_contribution_plan plan INNER JOIN agency a ON a.AgencyID=plan.AgencyID INNER JOIN agency_position ap ON ap.AgencyPositionID=plan.AgencyPositionID INNER JOIN \`position\` p ON p.PositionID=ap.PositionID INNER JOIN deduction_type dt ON dt.DeductionTypeID=plan.DeductionTypeID WHERE plan.AgencyContributionID=?`,
  recurring: `SELECT CONCAT_WS(' / ',CONCAT_WS(' ',e.FirstName,e.LastName),dt.DeductionName) AS label FROM employee_recurring_deduction d INNER JOIN employee e ON e.EmployeeID=d.EmployeeID INNER JOIN deduction_type dt ON dt.DeductionTypeID=d.DeductionTypeID WHERE d.RecurringDeductionID=?`,
  adjustment: `SELECT CONCAT_WS(' / ',CONCAT_WS(' ',e.FirstName,e.LastName),a.AdjustmentType,CONCAT('Adjustment #',a.AdjustmentID)) AS label FROM payroll_adjustment a INNER JOIN employee e ON e.EmployeeID=a.EmployeeID WHERE a.AdjustmentID=?`,
  'loan-record': `SELECT CONCAT_WS(' / ',CONCAT_WS(' ',e.FirstName,e.LastName),lt.LoanName) AS label FROM employee_loan l INNER JOIN employee e ON e.EmployeeID=l.EmployeeID INNER JOIN loan_type lt ON lt.LoanTypeID=l.LoanTypeID WHERE l.LoanID=?`,
  'deduction-record': `SELECT CONCAT_WS(' / ',CONCAT_WS(' ',e.FirstName,e.LastName),dt.DeductionName) AS label FROM employee_deduction d INNER JOIN employee e ON e.EmployeeID=d.EmployeeID INNER JOIN deduction_type dt ON dt.DeductionTypeID=d.DeductionTypeID WHERE d.EmployeeDeductionID=?`,
  billing: `SELECT CONCAT_WS(' · ',a.AgencyName,c.ClientName,CONCAT('Billing #',d.BillingID)) AS label FROM billing_draft d INNER JOIN agency a ON a.AgencyID=d.AgencyID INNER JOIN client c ON c.ClientID=d.ClientID WHERE d.BillingID=?`,
}
const idKinds: Record<string, string> = { employeeid:'employee', batchid:'dtr', sourcebatchid:'dtr', targetbatchid:'dtr', agencyid:'agency', clientid:'client', siteid:'site', siteaccountid:'site-account', positionid:'position', regionid:'region', shiftcodeid:'shift-code', agencypositionid:'agency-position', departmentid:'department', userid:'user', payrollrateid:'payroll-rate', billingrateid:'billing-rate', siterateid:'site-rate', loantypeid:'loan-type', deductiontypeid:'deduction-type', classificationid:'classification', billingid:'billing',accountid:'cash-account',agencycontributionid:'agency-contribution',recurringdeductionid:'recurring',adjustmentid:'adjustment',loanid:'loan-record',employeedeductionid:'deduction-record' }
const positive = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value)>0 ? Number(value) : null

function targetKind(path: string, input: any): string | null {
  if (path.startsWith('/api/organization/')) {
    const resource=path.split('/')[3]!
    return resource==='positions'?'position':Object.hasOwn(queries,resource)?resource:null
  }
  if (/^\/api\/employees(?:\/\d+(?:\/.*)?)?$/.test(path)) return 'employee'
  if (/^\/api\/attendance\/dtr(?:\/\d+(?:\/.*)?)?$/.test(path) || /^\/api\/payroll\/processing\//.test(path)) return 'dtr'
  if (path.startsWith('/api/attendance/holidays')) return 'holiday'
  if (path.startsWith('/api/rates/')) { const kind=path.split('/')[3]!;return Object.hasOwn(queries,kind)?kind:kind==='versions'?(input.rateKind==='billing'?'billing-rate':'payroll-rate'):null }
  if (/^\/api\/billing\/drafts(?:\/\d+(?:\/status)?)?$/.test(path)) return 'billing'
  if (path.startsWith('/api/settings/users/')) return 'user'
  if (path.startsWith('/api/settings/departments')) return 'department'
  if(path==='/api/deductions-loans/employee-records')return input.entryType==='Loan'?'loan-record':input.entryType==='Deduction'?'deduction-record':null
  if (path.startsWith('/api/deductions-loans/')) {const kind=path.split('/')[3]!;return ['classification','loan-type','deduction-type'].includes(kind)?kind:null}
  return null
}

export async function resolveActivitySubjects(event: any, response?: any) {
  const input=event.context.activityInput||{},path=getRequestURL(event).pathname.replace(/\/+$/,''),kind=targetKind(path,input)
  const candidates:{kind:string;id:number}[]=[]
  const module=activityScopes[activityScopeForPath(path)||'']?.module
  const allowed:Record<string,string[]>={organization:['agency','client','site','site-account','position','region','shift-code','agency-position'],rates:['agency','client','site','position','region','agency-position','payroll-rate','billing-rate','site-rate'],employees:['employee','agency','client','site','position','shift-code'],attendance:['employee','dtr','agency','client','site','shift-code','holiday'],payroll:['employee','dtr','agency','client','site','adjustment'],payslips:['employee','dtr','agency','client','site'],billing:['billing','dtr','agency','client','site'],deductions:['employee','agency','classification','loan-type','deduction-type','cash-account','agency-contribution','recurring','loan-record','deduction-record'],settings:['user','department']}
  const add=(key:string|null,value:unknown)=>{const id=positive(value);if(key&&id&&allowed[module||'']?.includes(key)&&Object.hasOwn(queries,key)&&!candidates.some(item=>item.kind===key&&item.id===id))candidates.push({kind:key,id})}
  const routeId=path.split('/').find(part=>/^[1-9]\d*$/.test(part))
  // Existing record before mutation; generated record after successful create.
  add(kind,routeId||input.ids?.id||input.ids?.RecordID||response?.body?.id||response?.body?.billingId||response?.body?.department?.id)
  if(path==='/api/deductions-loans/employee-records')add(input.entryType==='Loan'?'loan-type':input.entryType==='Deduction'?'deduction-type':null,input.ids?.CatalogItemID)
  for(const [key,value] of Object.entries(input.ids||{}))add(idKinds[key.toLowerCase()]||null,value)
  // Self-profile changes identify their actual actor, not an arbitrary body ID.
  if(path.startsWith('/api/auth/'))add('user',event.context.securityActor?.UserID)
  const subjects:ActivitySubject[]=[]
  for(const candidate of candidates.slice(0,3)){
    try{
      const [[row]]=await pool.execute<any[]>(queries[candidate.kind]!,[candidate.id])
      if(row?.label)subjects.push({kind:candidate.kind,id:String(candidate.id),label:String(row.label).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,220)})
    }catch{event.context.activitySubjectUnavailable=true}
  }
  return subjects
}

export async function prepareActivitySubjects(event:any){
  if(!event.context?.securityActor||!['POST','PUT','PATCH','DELETE'].includes(getMethod(event))||!activityScopeForPath(getRequestURL(event).pathname))return
  event.context.activitySubjects=await resolveActivitySubjects(event)
}

export async function finishActivitySubjects(event:any,response:any){
  if(event.context.activitySubjectsExact)return
  const before:ActivitySubject[]=event.context.activitySubjects||[]
  const after=await resolveActivitySubjects(event,response)
  const previous=new Map(before.map(item=>[`${item.kind}:${item.id}`,item])),subjects=new Map<string,ActivitySubject>()
  for(const item of after){const old=previous.get(`${item.kind}:${item.id}`);subjects.set(`${item.kind}:${item.id}`,{...item,...(old&&old.label!==item.label?{previousLabel:old.label}:{})})}
  for(const item of before)if(!subjects.has(`${item.kind}:${item.id}`))subjects.set(`${item.kind}:${item.id}`,item)
  event.context.activitySubjects=[...subjects.values()].slice(0,3)
}
