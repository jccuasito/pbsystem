import { createHash } from 'node:crypto'
import { createError, getQuery, readBody, setHeader } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { finalizedPayslipCte, readPayslipProfiles } from './payslipCrud'
import { writePayslipPublication } from './payslipPublication'

type Scope = { batchId:number } | { siteAccountId:number;agencyId:number;periodStart:string;periodEnd:string }
const finalized = finalizedPayslipCte + `, eligible AS (
  SELECT f.*,d.AgencyID,d.SiteID,a.AgencyName,s.SiteName,c.ClientName,
    COALESCE(coverage.SiteAccountID,0) AS SiteAccountID,
    COALESCE(account.SiteAccountName,'Unassigned Site Account') AS SiteAccountName,
    DATE_FORMAT(d.PeriodStart,'%Y-%m-%d') AS PeriodStart,DATE_FORMAT(d.PeriodEnd,'%Y-%m-%d') AS PeriodEnd,
    CASE WHEN v.EmployeeID IS NOT NULL THEN 1 ELSE 0 END AS IsPosted
  FROM finalized f JOIN attendance_dtr d ON d.BatchID=f.BatchID
  LEFT JOIN agency a ON a.AgencyID=d.AgencyID LEFT JOIN site s ON s.SiteID=d.SiteID
  LEFT JOIN client c ON c.ClientID=d.ClientID
  LEFT JOIN site_agency coverage ON coverage.SiteID=d.SiteID AND coverage.AgencyID=d.AgencyID
  LEFT JOIN site_account account ON account.SiteAccountID=coverage.SiteAccountID
  LEFT JOIN valid_publications v ON v.EmployeeID=f.EmployeeID AND v.GroupKey=f.GroupKey
), sites AS (
  SELECT BatchID,AgencyID,SiteID,AgencyName,SiteName,ClientName,PeriodStart,PeriodEnd,
    COUNT(*) AS PayrollCount,COUNT(DISTINCT EmployeeID) AS EmployeeCount,SUM(IsPosted) AS PostedPayrollCount,
    SUM(GrossPay) AS GrossPay,SUM(TotalDeduction) AS TotalDeduction,SUM(NetPay) AS NetPay
  FROM eligible GROUP BY BatchID,AgencyID,SiteID,AgencyName,SiteName,ClientName,PeriodStart,PeriodEnd
), accounts AS (
  SELECT SiteAccountID,SiteAccountName,AgencyID,AgencyName,PeriodStart,PeriodEnd,
    COUNT(DISTINCT SiteID) AS SiteCount,COUNT(DISTINCT BatchID) AS BatchCount,
    COUNT(*) AS PayrollCount,COUNT(DISTINCT EmployeeID) AS EmployeeCount,SUM(IsPosted) AS PostedPayrollCount,
    SUM(GrossPay) AS GrossPay,SUM(TotalDeduction) AS TotalDeduction,SUM(NetPay) AS NetPay
  FROM eligible GROUP BY SiteAccountID,SiteAccountName,AgencyID,AgencyName,PeriodStart,PeriodEnd
)`
const postingStatus=(posted:number,total:number)=>posted===total?'Posted':posted>0?'Partially posted':'Not Posted'
const id=(value:unknown)=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):0
const validPeriod=(start:string,end:string)=>/^\d{4}-\d{2}-\d{2}$/.test(start)&&/^\d{4}-\d{2}-\d{2}$/.test(end)&&start<=end
function editAccess(event:any,session:any){return session.userType!=='Viewer'&&event.context?.moduleCanEdit!==false}
function readScope(value:any):Scope{
  if(value.batchId!==undefined){
    if(!id(value.batchId)||value.siteAccountId!==undefined)throw createError({statusCode:400,statusMessage:'Choose a valid posting group.'})
    return{batchId:id(value.batchId)}
  }
  const siteAccountId=Number(value.siteAccountId),agencyId=id(value.agencyId)
  const periodStart=String(value.periodStart||''),periodEnd=String(value.periodEnd||'')
  if(value.siteAccountId===undefined||value.siteAccountId===''||!Number.isSafeInteger(siteAccountId)||siteAccountId<0||!agencyId||!validPeriod(periodStart,periodEnd))throw createError({statusCode:400,statusMessage:'Choose a Site Account, agency and cutoff.'})
  return{siteAccountId,agencyId,periodStart,periodEnd}
}
function accountScope(row:any):Scope{return{siteAccountId:Number(row.SiteAccountID),agencyId:Number(row.AgencyID),periodStart:row.PeriodStart,periodEnd:row.PeriodEnd}}

async function readHeader(db:any,scope:Scope,lock=false){
  if('batchId' in scope){
    const [[row]]=await db.execute<any[]>(`SELECT d.BatchID,d.AgencyID,d.SiteID,a.AgencyName,s.SiteName,c.ClientName,
      DATE_FORMAT(d.PeriodStart,'%Y-%m-%d') AS PeriodStart,DATE_FORMAT(d.PeriodEnd,'%Y-%m-%d') AS PeriodEnd
      FROM attendance_dtr d LEFT JOIN agency a ON a.AgencyID=d.AgencyID
      LEFT JOIN site s ON s.SiteID=d.SiteID LEFT JOIN client c ON c.ClientID=d.ClientID
      WHERE d.BatchID=?`+(lock?' FOR UPDATE':''),[scope.batchId])
    if(!row)throw createError({statusCode:404,statusMessage:'Site payroll not found.'})
    return{...row,Scope:scope,BatchIDs:[scope.batchId]}
  }
  const [batches]=await db.execute<any[]>(`SELECT DISTINCT d.BatchID,d.SiteID,s.SiteName,c.ClientName,a.AgencyName,
    COALESCE(account.SiteAccountName,'Unassigned Site Account') AS SiteAccountName
    FROM attendance_dtr d JOIN payroll_processing_posting pp ON pp.BatchID=d.BatchID AND pp.Status='Active'
    JOIN payroll py ON py.PayrollID=pp.PayrollID AND py.Status IN ('Approved','Released')
    LEFT JOIN agency a ON a.AgencyID=d.AgencyID LEFT JOIN site s ON s.SiteID=d.SiteID
    LEFT JOIN client c ON c.ClientID=d.ClientID
    LEFT JOIN site_agency coverage ON coverage.SiteID=d.SiteID AND coverage.AgencyID=d.AgencyID
    LEFT JOIN site_account account ON account.SiteAccountID=coverage.SiteAccountID
    WHERE d.AgencyID=? AND d.PeriodStart=? AND d.PeriodEnd=? AND COALESCE(coverage.SiteAccountID,0)=?
    ORDER BY d.BatchID`,[scope.agencyId,scope.periodStart,scope.periodEnd,scope.siteAccountId])
  if(!batches.length)throw createError({statusCode:409,statusMessage:'This account has no current finalized site payrolls. Refresh the list.'})
  return{Scope:scope,SiteAccountID:scope.siteAccountId,SiteAccountName:batches[0].SiteAccountName,
    AgencyID:scope.agencyId,AgencyName:batches[0].AgencyName,PeriodStart:scope.periodStart,PeriodEnd:scope.periodEnd,
    BatchIDs:batches.map(row=>Number(row.BatchID)),SiteCount:new Set(batches.map(row=>Number(row.SiteID))).size,
    IncludedSites:batches.map(({BatchID,SiteID,SiteName,ClientName}:any)=>({BatchID,SiteID,SiteName,ClientName}))}
}
async function readEmployeeIds(db:any,batchIds:number[],lock=false){
  if(!batchIds.length)return []
  const marks=batchIds.map(()=>'?').join(',')
  if(lock){
    // Locking reads avoid establishing a stale snapshot before employee/payroll locks.
    const [rows]=await db.execute<any[]>(`SELECT EmployeeID FROM payroll_processing_posting
      WHERE BatchID IN (${marks}) AND Status='Active' ORDER BY BatchID,EmployeeID FOR UPDATE`,batchIds)
    return [...new Set(rows.map(row=>Number(row.EmployeeID)))].sort((a,b)=>a-b)
  }
  const [rows]=await db.execute<any[]>(`SELECT DISTINCT py.EmployeeID FROM payroll_processing_posting pp
    JOIN payroll py ON py.PayrollID=pp.PayrollID WHERE pp.BatchID IN (${marks}) AND pp.Status='Active'
    AND py.Status IN ('Approved','Released') ORDER BY py.EmployeeID`,batchIds)
  return rows.map(row=>Number(row.EmployeeID))
}
async function readRoster(db:any,header:any,employeeIds:number[]){
  if(!employeeIds.length)throw createError({statusCode:409,statusMessage:'This group has no current finalized payroll. Refresh the list.'})
  const batchIds=new Set<number>(header.BatchIDs)
  const profiles=await readPayslipProfiles(employeeIds,db,{start:header.PeriodStart,end:header.PeriodEnd})
  // One row per employee and one instance of each group, even across multiple sites.
  const items=profiles.map(profile=>({employee:profile.employee,cutoffs:profile.cutoffs.filter(cutoff=>cutoff.sources.some((source:any)=>batchIds.has(Number(source.batchId))))})).filter(row=>row.cutoffs.length)
  const reviewToken=createHash('sha256').update(JSON.stringify({header,items:items.map(row=>({employee:row.employee,cutoffs:row.cutoffs.map(({publicationStatus,publicationId,postedAt,...cutoff}:any)=>cutoff)}))})).digest('hex')
  return{header,items,reviewToken}
}
async function lockAccountBatches(db:any,scope:Exclude<Scope,{batchId:number}>){
  // Lock every DTR in this agency/cutoff, including not-yet-finalized sites, and
  // current coverage before reading the group. New finalizations/reassignments
  // must not silently expand the reviewed account while a bulk action is running.
  const [batches]=await db.execute<any[]>(`SELECT BatchID,SiteID FROM attendance_dtr
    WHERE AgencyID=? AND PeriodStart=? AND PeriodEnd=? ORDER BY BatchID FOR UPDATE`,[scope.agencyId,scope.periodStart,scope.periodEnd])
  const [coverage]=await db.execute<any[]>(`SELECT SiteID,SiteAccountID FROM site_agency
    WHERE AgencyID=? ORDER BY SiteID FOR UPDATE`,[scope.agencyId])
  const accounts=new Map(coverage.map(row=>[Number(row.SiteID),Number(row.SiteAccountID||0)]))
  return batches.filter(row=>(accounts.get(Number(row.SiteID))||0)===scope.siteAccountId).map(row=>Number(row.BatchID))
}

export async function listSitePayslips(event:any){
  const session=requireSession(event)
  setHeader(event,'Cache-Control','private, no-store')
  const query=getQuery(event),canPost=editAccess(event,session)
  if(query.batchId!==undefined||query.siteAccountId!==undefined){
    const scope=readScope(query),db=await pool.getConnection()
    try{
      await db.beginTransaction()
      const header=await readHeader(db,scope),result=await readRoster(db,header,await readEmployeeIds(db,header.BatchIDs))
      await db.commit();return{...result,canPost}
    }catch(error){await db.rollback();throw error}finally{db.release()}
  }
  if(query.groupBy!==undefined&&query.groupBy!=='account')throw createError({statusCode:400,statusMessage:'Choose a valid payslip grouping.'})
  const byAccount=query.groupBy==='account',table=byAccount?'accounts':'sites'
  const agencyId=query.agencyId?id(query.agencyId):0
  if(query.agencyId&&!agencyId)throw createError({statusCode:400,statusMessage:'Choose a valid agency.'})
  const search=String(query.search||'').trim().slice(0,100),start=String(query.periodStart||''),end=String(query.periodEnd||'')
  if((start||end)&&!validPeriod(start,end))throw createError({statusCode:400,statusMessage:'Choose a valid payroll cutoff.'})
  const filters:Record<string,string>={'':'1=1',posted:'PostedPayrollCount=PayrollCount','not-posted':'PostedPayrollCount<PayrollCount',partial:'PostedPayrollCount>0 AND PostedPayrollCount<PayrollCount'}
  const filter=String(query.postingStatus||'')
  if(!Object.hasOwn(filters,filter))throw createError({statusCode:400,statusMessage:'Choose a valid posting status.'})
  const searchColumns=byAccount?'SiteAccountName,AgencyName':'SiteName,AgencyName,ClientName,BatchID'
  const where=`WHERE (?=0 OR AgencyID=?) AND (?='' OR CONVERT(CONCAT_WS(' ',${searchColumns}) USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE ?)
    AND (?='' OR (PeriodStart=? AND PeriodEnd=?)) AND (${filters[filter]})`
  const params=[agencyId,agencyId,search,'%'+search+'%',start,start,end]
  const [[count]]=await pool.execute<any[]>(finalized+' SELECT COUNT(*) AS Total FROM '+table+' '+where,params)
  const pageSize=25,total=Number(count.Total),pages=Math.max(1,Math.ceil(total/pageSize)),page=Math.max(1,Math.min(pages,Math.floor(Number(query.page)||1)))
  const order=byAccount?'SiteAccountName,AgencyName,SiteAccountID':'SiteName,AgencyName,BatchID DESC'
  const results=await Promise.all([
    pool.execute<any[]>(finalized+` SELECT * FROM ${table} ${where} ORDER BY PeriodEnd DESC,PeriodStart DESC,${order} LIMIT ? OFFSET ?`,[...params,pageSize,(page-1)*pageSize]),
    pool.execute<any[]>(finalized+' SELECT DISTINCT AgencyID,AgencyName FROM '+table+' ORDER BY AgencyName'),
    pool.execute<any[]>(finalized+' SELECT DISTINCT PeriodStart,PeriodEnd FROM '+table+' ORDER BY PeriodEnd DESC,PeriodStart DESC')
  ])
  return{items:results[0][0].map(row=>({...row,Scope:byAccount?accountScope(row):{batchId:Number(row.BatchID)},PublicationStatus:postingStatus(Number(row.PostedPayrollCount),Number(row.PayrollCount))})),agencies:results[1][0],cutoffs:results[2][0],canPost,pagination:{page,pageSize,total,pages}}
}

export async function publishSitePayslips(event:any){
  const session=requireSession(event)
  if(!editAccess(event,session))throw createError({statusCode:403,statusMessage:'Payslip edit access is required.'})
  const body=await readBody(event),scope=readScope(body||{})
  if(!['post','withdraw'].includes(body?.action)||!Array.isArray(body?.employeeIds)||!body.employeeIds.length||body.employeeIds.length>5000||body.employeeIds.some((value:any)=>!id(value))||new Set(body.employeeIds.map(Number)).size!==body.employeeIds.length||typeof body.reviewToken!=='string'||!/^[a-f0-9]{64}$/.test(body.reviewToken))throw createError({statusCode:400,statusMessage:'Review the payroll group and select employees before posting.'})
  const selected=new Set<number>(body.employeeIds.map(Number)),db=await pool.getConnection()
  try{
    await db.beginTransaction()
    const initialHeader='batchId' in scope?await readHeader(db,scope,true):null
    const candidateIds=initialHeader?initialHeader.BatchIDs:await lockAccountBatches(db,scope as Exclude<Scope,{batchId:number}>)
    const employeeIds=await readEmployeeIds(db,candidateIds,true)
    if(!employeeIds.length)throw createError({statusCode:409,statusMessage:'This payroll group is no longer finalized.'})
    const marks=employeeIds.map(()=>'?').join(',')
    // Same employee -> payroll -> publication order as individual posting.
    await db.execute(`SELECT EmployeeID FROM employee WHERE EmployeeID IN (${marks}) ORDER BY EmployeeID FOR UPDATE`,employeeIds)
    await db.execute(`SELECT PayrollID FROM payroll WHERE EmployeeID IN (${marks}) ORDER BY EmployeeID,PayrollID FOR UPDATE`,employeeIds)
    const header=initialHeader||await readHeader(db,scope),reviewed=await readRoster(db,header,employeeIds)
    if(reviewed.reviewToken!==body.reviewToken)throw createError({statusCode:409,statusMessage:'The account, sites or finalized payroll changed. Refresh and review again before posting.'})
    if([...selected].some(employeeId=>!reviewed.items.some(row=>Number(row.employee.EmployeeID)===employeeId)))throw createError({statusCode:400,statusMessage:'Selected employees must belong to this payroll group.'})
    const profiles=reviewed.items.filter(row=>selected.has(Number(row.employee.EmployeeID))),included=new Set<number>(header.BatchIDs)
    if(body.includeCombined!==true&&profiles.some(row=>row.cutoffs.some(cutoff=>cutoff.sources.some((source:any)=>!included.has(Number(source.batchId))))))throw createError({statusCode:409,statusMessage:'Acknowledge the combined payslips that include payroll outside this group.'})
    let changed=0,unchanged=0
    for(const profile of profiles)for(const cutoff of profile.cutoffs){
      if(await writePayslipPublication(db,Number(profile.employee.EmployeeID),cutoff.key,Number(session.sub),body.action,profile))changed++;else unchanged++
    }
    await db.commit();setHeader(event,'Cache-Control','private, no-store')
    return{success:true,changed,unchanged,status:body.action==='post'?'Posted':'Not Posted'}
  }catch(error){await db.rollback();throw error}finally{db.release()}
}
