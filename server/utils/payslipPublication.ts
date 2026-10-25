import { createError, readBody, setHeader } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { readEmployeePayslips } from './payslipCrud'

// Caller owns the transaction and locks the employee and their payroll rows first.
// Both employee and site posting use this writer, including the same snapshot and audit trail.
export async function writePayslipPublication(db:any,employeeId:number,key:string,actorId:number,action:string,profile?:any) {
  const [[existing]]=await db.execute<any[]>('SELECT PublicationID,SnapshotJson,Status FROM payslip_publication WHERE EmployeeID=? AND GroupKey=? FOR UPDATE',[employeeId,key])
  if(action==='withdraw'){
    if(!existing||existing.Status!=='Posted')return false
    await db.execute("UPDATE payslip_publication SET Status='Withdrawn',WithdrawnBy=?,WithdrawnAt=NOW() WHERE PublicationID=?",[actorId,existing.PublicationID])
    await db.execute("INSERT INTO payslip_publication_event(PublicationID,Action,SnapshotJson,ActorUserID) VALUES(?,'Withdrawn',?,?)",[existing.PublicationID,existing.SnapshotJson,actorId])
    return true
  }
  profile ||= await readEmployeePayslips(employeeId,db)
  const cutoff=profile.cutoffs.find((row:any)=>row.key===key)
  if(!cutoff)throw createError({statusCode:409,statusMessage:'Only a current finalized payslip can be posted.'})
  if(existing?.Status==='Posted'&&cutoff.publicationStatus==='Posted')return false
  const snapshot=JSON.stringify({employee:profile.employee,cutoff:{...cutoff,publicationStatus:'Posted'}})
  const [result]=await db.execute<any>(`INSERT INTO payslip_publication(EmployeeID,GroupKey,Status,SnapshotJson,PostedBy) VALUES(?,?,'Posted',?,?)
    ON DUPLICATE KEY UPDATE Status='Posted',SnapshotJson=VALUES(SnapshotJson),PostedBy=VALUES(PostedBy),PostedAt=NOW(),WithdrawnBy=NULL,WithdrawnAt=NULL`,[employeeId,key,snapshot,actorId])
  const publicationId=existing?.PublicationID||result.insertId
  await db.execute('DELETE FROM payslip_publication_source WHERE PublicationID=?',[publicationId])
  for(const id of cutoff.payrollIds)await db.execute('INSERT INTO payslip_publication_source(PublicationID,PayrollID) VALUES(?,?)',[publicationId,id])
  await db.execute("INSERT INTO payslip_publication_event(PublicationID,Action,SnapshotJson,ActorUserID) VALUES(?,'Posted',?,?)",[publicationId,snapshot,actorId])
  return true
}

export async function publishPayslip(event:any) {
  const session=requireSession(event)
  if(session.userType==='Viewer'||event.context?.moduleCanEdit===false)throw createError({statusCode:403,statusMessage:'Payslip edit access is required.'})
  const body=await readBody(event),employeeId=Number(body?.employeeId)
  if(!Number.isSafeInteger(employeeId)||employeeId<1||typeof body?.key!=='string'||body.key.length>150||!['post','withdraw'].includes(body.action))throw createError({statusCode:400,statusMessage:'Choose an employee, payslip and posting action.'})
  const db=await pool.getConnection()
  try{
    await db.beginTransaction()
    const [[employee]]=await db.execute<any[]>('SELECT EmployeeID FROM employee WHERE EmployeeID=? FOR UPDATE',[employeeId])
    if(!employee)throw createError({statusCode:404,statusMessage:'Employee not found.'})
    await db.execute('SELECT PayrollID FROM payroll WHERE EmployeeID=? ORDER BY PayrollID FOR UPDATE',[employeeId])
    const changed=await writePayslipPublication(db,employeeId,body.key,Number(session.sub),body.action)
    if(body.action==='withdraw'&&!changed)throw createError({statusCode:409,statusMessage:'This payslip is not currently posted.'})
    await db.commit();setHeader(event,'Cache-Control','private, no-store')
    return{success:true,status:body.action==='post'?'Posted':'Not Posted'}
  }catch(error){await db.rollback();throw error}finally{db.release()}
}
