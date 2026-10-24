import crypto from 'node:crypto'
import { createError, getQuery, readBody, setHeader } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

const canManage=(session:any,event:any)=>['Admin','Supervisor'].includes(session.userType)&&event.context?.moduleCanEdit!==false
export async function portalAccountStatus(event:any){
  const session=requireSession(event)
  setHeader(event,'Cache-Control','private, no-store')
  const employeeId=Number(getQuery(event).employeeId)
  if(!Number.isSafeInteger(employeeId)||employeeId<1)throw createError({statusCode:400,statusMessage:'Select an employee.'})
  const manage=canManage(session,event)
  const [[account]]=await pool.execute<any[]>(`SELECT AccountID,Status,Email,ContactNumber,AgreementVersion,AgreementAcceptedAt,CreatedAt FROM employee_portal_account WHERE EmployeeID=?`,[employeeId])
  return{canManage:manage,account:account?(manage?account:{Status:account.Status}):null}
}
export async function managePortalAccount(event:any){
  const session=requireSession(event)
  if(!canManage(session,event))throw createError({statusCode:403,statusMessage:'An authorized Admin or Supervisor must manage portal access.'})
  setHeader(event,'Cache-Control','private, no-store')
  const body=await readBody(event),employeeId=Number(body?.employeeId)
  if(!Number.isSafeInteger(employeeId)||employeeId<1||!['activate','deactivate','recovery'].includes(body?.action))throw createError({statusCode:400,statusMessage:'Select an employee account action.'})
  const db=await pool.getConnection()
  let recoveryCode:string|null=null
  try{
    await db.beginTransaction()
    const [[account]]=await db.execute<any[]>('SELECT AccountID,Status FROM employee_portal_account WHERE EmployeeID=? FOR UPDATE',[employeeId])
    if(!account)throw createError({statusCode:404,statusMessage:'No employee portal account exists yet.'})
    if(body.action==='recovery'){
      if(account.Status!=='Active')throw createError({statusCode:409,statusMessage:'Activate this account before issuing a recovery code.'})
      recoveryCode=crypto.randomBytes(18).toString('hex')
      await db.execute('UPDATE employee_portal_account SET ResetTokenHash=?,ResetExpiresAt=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE) WHERE AccountID=?',[crypto.createHash('sha256').update(recoveryCode).digest('hex'),account.AccountID])
    }else await db.execute('UPDATE employee_portal_account SET Status=?,ResetTokenHash=NULL,ResetExpiresAt=NULL WHERE AccountID=?',[body.action==='activate'?'Active':'Inactive',account.AccountID])
    await db.execute('DELETE FROM employee_portal_session WHERE AccountID=?',[account.AccountID])
    await db.execute('INSERT INTO employee_portal_event(AccountID,Action,ActorUserID) VALUES(?,?,?)',[account.AccountID,body.action==='recovery'?'HR issued recovery code':body.action==='activate'?'HR activated account':'HR deactivated account',session.sub])
    await db.commit();return{success:true,recoveryCode}
  }catch(error){await db.rollback();throw error}finally{db.release()}
}
