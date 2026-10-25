import { createHash } from 'node:crypto'
import { createError, getQuery, readBody, setHeader } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { finalizedPayslipCte, readPayslipProfiles } from './payslipCrud'
import { writePayslipPublication } from './payslipPublication'

// Keep group keys identical to payslipGroups: regular is one employee/cutoff;
// reliever is one employee/cutoff/site. A site action always publishes that whole group.
const finalized = finalizedPayslipCte + `, sites AS (
  SELECT d.BatchID,d.AgencyID,d.SiteID,a.AgencyName,s.SiteName,c.ClientName,
    DATE_FORMAT(d.PeriodStart,'%Y-%m-%d') AS PeriodStart,DATE_FORMAT(d.PeriodEnd,'%Y-%m-%d') AS PeriodEnd,
    COUNT(*) AS PayrollCount,COUNT(DISTINCT f.EmployeeID) AS EmployeeCount,
    SUM(CASE WHEN v.EmployeeID IS NOT NULL THEN 1 ELSE 0 END) AS PostedPayrollCount,
    SUM(f.GrossPay) AS GrossPay,SUM(f.TotalDeduction) AS TotalDeduction,SUM(f.NetPay) AS NetPay
  FROM finalized f JOIN attendance_dtr d ON d.BatchID=f.BatchID
  LEFT JOIN agency a ON a.AgencyID=d.AgencyID LEFT JOIN site s ON s.SiteID=d.SiteID
  LEFT JOIN client c ON c.ClientID=d.ClientID
  LEFT JOIN valid_publications v ON v.EmployeeID=f.EmployeeID AND v.GroupKey=f.GroupKey
  GROUP BY d.BatchID,d.AgencyID,d.SiteID,a.AgencyName,s.SiteName,c.ClientName,d.PeriodStart,d.PeriodEnd
)`
const postingStatus=(posted:number,total:number)=>posted===total?'Posted':posted>0?'Partially posted':'Not Posted'
const id=(value:unknown)=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):0
function editAccess(event:any,session:any){return session.userType!=='Viewer'&&event.context?.moduleCanEdit!==false}

async function readHeader(db:any,batchId:number,lock=false){
  const [[row]]=await db.execute<any[]>(`SELECT d.BatchID,d.AgencyID,d.SiteID,a.AgencyName,s.SiteName,c.ClientName,
    DATE_FORMAT(d.PeriodStart,'%Y-%m-%d') AS PeriodStart,DATE_FORMAT(d.PeriodEnd,'%Y-%m-%d') AS PeriodEnd
    FROM attendance_dtr d LEFT JOIN agency a ON a.AgencyID=d.AgencyID
    LEFT JOIN site s ON s.SiteID=d.SiteID LEFT JOIN client c ON c.ClientID=d.ClientID
    WHERE d.BatchID=?`+(lock?' FOR UPDATE':''),[batchId])
  if(!row)throw createError({statusCode:404,statusMessage:'Site payroll not found.'})
  return row
}
async function readEmployeeIds(db:any,batchId:number,lock=false){
  if(lock){
    // Current locking reads do not establish a stale repeatable-read snapshot before
    // waiting on employee/payroll locks. The DTR lock prevents roster changes here.
    const [rows]=await db.execute<any[]>(`SELECT EmployeeID FROM payroll_processing_posting
      WHERE BatchID=? AND Status='Active' ORDER BY EmployeeID FOR UPDATE`,[batchId])
    return [...new Set(rows.map(row=>Number(row.EmployeeID)))]
  }
  const [rows]=await db.execute<any[]>(`SELECT DISTINCT py.EmployeeID FROM payroll_processing_posting pp
    JOIN payroll py ON py.PayrollID=pp.PayrollID WHERE pp.BatchID=? AND pp.Status='Active'
    AND py.Status IN ('Approved','Released') ORDER BY py.EmployeeID`,[batchId])
  return rows.map(row=>Number(row.EmployeeID))
}
async function readRoster(db:any,header:any,employeeIds:number[]){
  if(!employeeIds.length)throw createError({statusCode:409,statusMessage:'This site has no current finalized payroll. Refresh the list.'})
  const profiles=await readPayslipProfiles(employeeIds,db,{start:header.PeriodStart,end:header.PeriodEnd})
  const items=profiles.map(profile=>({employee:profile.employee,cutoffs:profile.cutoffs.filter(cutoff=>cutoff.sources.some((source:any)=>Number(source.batchId)===Number(header.BatchID)))})).filter(row=>row.cutoffs.length)
  const reviewToken=createHash('sha256').update(JSON.stringify({header,items:items.map(row=>({employee:row.employee,cutoffs:row.cutoffs.map(({publicationStatus,publicationId,postedAt,...cutoff}:any)=>cutoff)}))})).digest('hex')
  return{header,items,reviewToken}
}

export async function listSitePayslips(event:any){
  const session=requireSession(event)
  setHeader(event,'Cache-Control','private, no-store')
  const query=getQuery(event),canPost=editAccess(event,session)
  if(query.batchId!==undefined){
    const batchId=id(query.batchId)
    if(!batchId)throw createError({statusCode:400,statusMessage:'Choose a valid site payroll.'})
    // A single snapshot keeps the reviewed roster, payslip sources and totals consistent.
    const db=await pool.getConnection()
    try{
      await db.beginTransaction()
      const header=await readHeader(db,batchId),result=await readRoster(db,header,await readEmployeeIds(db,batchId))
      await db.commit();return{...result,canPost}
    }catch(error){await db.rollback();throw error}finally{db.release()}
  }
  const agencyId=query.agencyId?id(query.agencyId):0
  if(query.agencyId&&!agencyId)throw createError({statusCode:400,statusMessage:'Choose a valid agency.'})
  const search=String(query.search||'').trim().slice(0,100),start=String(query.periodStart||''),end=String(query.periodEnd||'')
  if((start||end)&&(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end))throw createError({statusCode:400,statusMessage:'Choose a valid payroll cutoff.'})
  const filters:Record<string,string>={'':'1=1',posted:'PostedPayrollCount=PayrollCount','not-posted':'PostedPayrollCount<PayrollCount',partial:'PostedPayrollCount>0 AND PostedPayrollCount<PayrollCount'}
  const filter=String(query.postingStatus||'')
  if(!Object.hasOwn(filters,filter))throw createError({statusCode:400,statusMessage:'Choose a valid posting status.'})
  const where=`WHERE (?=0 OR AgencyID=?) AND (?='' OR CONCAT_WS(' ',SiteName,AgencyName,ClientName,BatchID) LIKE ?)
    AND (?='' OR (PeriodStart=? AND PeriodEnd=?)) AND (${filters[filter]})`
  const params=[agencyId,agencyId,search,'%'+search+'%',start,start,end]
  const [[count]]=await pool.execute<any[]>(finalized+' SELECT COUNT(*) AS Total FROM sites '+where,params)
  const pageSize=25,total=Number(count.Total),pages=Math.max(1,Math.ceil(total/pageSize)),page=Math.max(1,Math.min(pages,Math.floor(Number(query.page)||1)))
  const results=await Promise.all([
    pool.execute<any[]>(finalized+` SELECT * FROM sites ${where} ORDER BY PeriodEnd DESC,PeriodStart DESC,SiteName,AgencyName,BatchID DESC LIMIT ? OFFSET ?`,[...params,pageSize,(page-1)*pageSize]),
    pool.execute<any[]>(finalized+' SELECT DISTINCT AgencyID,AgencyName FROM sites ORDER BY AgencyName'),
    pool.execute<any[]>(finalized+' SELECT DISTINCT PeriodStart,PeriodEnd FROM sites ORDER BY PeriodEnd DESC,PeriodStart DESC')
  ])
  return{items:results[0][0].map(row=>({...row,PublicationStatus:postingStatus(Number(row.PostedPayrollCount),Number(row.PayrollCount))})),agencies:results[1][0],cutoffs:results[2][0],canPost,pagination:{page,pageSize,total,pages}}
}

export async function publishSitePayslips(event:any){
  const session=requireSession(event)
  if(!editAccess(event,session))throw createError({statusCode:403,statusMessage:'Payslip edit access is required.'})
  const body=await readBody(event),batchId=id(body?.batchId)
  if(!batchId||!['post','withdraw'].includes(body?.action)||!Array.isArray(body?.employeeIds)||!body.employeeIds.length||body.employeeIds.length>5000||body.employeeIds.some((value:any)=>!id(value))||new Set(body.employeeIds.map(Number)).size!==body.employeeIds.length||typeof body.reviewToken!=='string'||!/^[a-f0-9]{64}$/.test(body.reviewToken))throw createError({statusCode:400,statusMessage:'Review the site payroll and select employees before posting.'})
  const selected=new Set<number>(body.employeeIds.map(Number)),db=await pool.getConnection()
  try{
    await db.beginTransaction()
    const header=await readHeader(db,batchId,true),employeeIds=await readEmployeeIds(db,batchId,true)
    if(!employeeIds.length)throw createError({statusCode:409,statusMessage:'This site payroll is no longer finalized.'})
    // Same employee -> payroll -> publication lock order as individual posting.
    // Lock all payrolls for these employees so combined-site groups cannot change mid-post.
    const marks=employeeIds.map(()=>'?').join(',')
    await db.execute(`SELECT EmployeeID FROM employee WHERE EmployeeID IN (${marks}) ORDER BY EmployeeID FOR UPDATE`,employeeIds)
    await db.execute(`SELECT PayrollID FROM payroll WHERE EmployeeID IN (${marks}) ORDER BY EmployeeID,PayrollID FOR UPDATE`,employeeIds)
    const reviewed=await readRoster(db,header,employeeIds)
    if(reviewed.reviewToken!==body.reviewToken)throw createError({statusCode:409,statusMessage:'The finalized payroll changed. Refresh and review it again before posting.'})
    if([...selected].some(employeeId=>!reviewed.items.some(row=>Number(row.employee.EmployeeID)===employeeId)))throw createError({statusCode:400,statusMessage:'Selected employees must belong to this site payroll.'})
    const profiles=reviewed.items.filter(row=>selected.has(Number(row.employee.EmployeeID)))
    if(body.includeCombined!==true&&profiles.some(row=>row.cutoffs.some(cutoff=>cutoff.sources.some((source:any)=>Number(source.batchId)!==batchId))))throw createError({statusCode:409,statusMessage:'Acknowledge the combined payslips that include payroll from other sites.'})
    let changed=0,unchanged=0
    for(const profile of profiles)for(const cutoff of profile.cutoffs){
      if(await writePayslipPublication(db,Number(profile.employee.EmployeeID),cutoff.key,Number(session.sub),body.action,profile))changed++;else unchanged++
    }
    await db.commit();setHeader(event,'Cache-Control','private, no-store')
    return{success:true,changed,unchanged,status:body.action==='post'?'Posted':'Not Posted'}
  }catch(error){await db.rollback();throw error}finally{db.release()}
}
