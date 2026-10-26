import { newPortalRecoveryCode, portalRecoveryHash, recoveryAttemptKey } from './employeePortalRecovery'
import { createError, getQuery, readBody, setHeader } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

const canManage=(session:any,event:any)=>['Admin','Supervisor'].includes(session.userType)&&event.context?.moduleCanEdit!==false
export async function portalAccountStatus(event:any){
  const session=requireSession(event)
  setHeader(event,'Cache-Control','private, no-store')
  const query=getQuery(event),employeeId=Number(query.employeeId)
  if(!Number.isSafeInteger(employeeId)||employeeId<1)throw createError({statusCode:400,statusMessage:'Select an employee.'})
  const manage=canManage(session,event)
  if(!manage){
    const [[account]]=await pool.execute<any[]>('SELECT Status FROM employee_portal_account WHERE EmployeeID=?',[employeeId])
    return{canManage:false,account:account||null}
  }
  // Account/event DATETIMEs are database-local; recovery/session expiry uses UTC.
  const iso=(expression:string)=>`DATE_FORMAT(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,NOW(),UTC_TIMESTAMP()),${expression}),'%Y-%m-%dT%H:%i:%s.000Z')`
  const [[account]]=await pool.execute<any[]>(`SELECT AccountID,Status,Email,ContactNumber,AgreementVersion,
    ${iso('AgreementAcceptedAt')} AS AgreementAcceptedAt,${iso('CreatedAt')} AS CreatedAt,
    ${iso("(SELECT MAX(login.CreatedAt) FROM employee_portal_event login WHERE login.AccountID=employee_portal_account.AccountID AND login.Action='Signed in')")} AS LastSignInAt,
    (SELECT COUNT(*) FROM employee_portal_session ps WHERE ps.AccountID=employee_portal_account.AccountID AND ps.ExpiresAt>UTC_TIMESTAMP()) AS ActiveSessions,
    CASE WHEN ResetTokenHash IS NOT NULL AND ResetExpiresAt>UTC_TIMESTAMP() THEN 1 ELSE 0 END AS RecoveryPending,
    DATE_FORMAT(ResetExpiresAt,'%Y-%m-%dT%H:%i:%s.000Z') AS RecoveryExpiresAt
    FROM employee_portal_account WHERE EmployeeID=?`,[employeeId])
  if(!account)return{canManage:true,account:null,activity:{items:[],pagination:{page:1,pages:1,total:0}}}
  const [[count]]=await pool.execute<any[]>('SELECT COUNT(*) AS Total FROM employee_portal_event WHERE AccountID=?',[account.AccountID])
  const total=Number(count.Total),pageSize=10,pages=Math.max(1,Math.ceil(total/pageSize)),page=Math.max(1,Math.min(pages,Math.floor(Number(query.activityPage)||1)))
  const [items]=await pool.execute<any[]>(`SELECT ev.EventID,ev.Action,ev.ActorUserID,
    CONCAT_WS(' ',actor.FirstName,actor.LastName) AS ActorName,${iso('ev.CreatedAt')} AS CreatedAt
    FROM employee_portal_event ev LEFT JOIN \`user\` actor ON actor.UserID=ev.ActorUserID
    WHERE ev.AccountID=? ORDER BY ev.EventID DESC LIMIT ? OFFSET ?`,[account.AccountID,pageSize,(page-1)*pageSize])
  return{canManage:true,account,activity:{items,pagination:{page,pageSize,pages,total}}}
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
    const [[account]]=await db.execute<any[]>('SELECT AccountID,Status,ResetTokenHash FROM employee_portal_account WHERE EmployeeID=? FOR UPDATE',[employeeId])
    if(!account)throw createError({statusCode:404,statusMessage:'No employee portal account exists yet.'})
    if(body.action==='recovery'){
      if(account.Status!=='Active')throw createError({statusCode:409,statusMessage:'Activate this account before issuing a recovery code.'})
      do{recoveryCode=newPortalRecoveryCode()}while(portalRecoveryHash(account.AccountID,recoveryCode)===account.ResetTokenHash)
      await db.execute('UPDATE employee_portal_account SET ResetTokenHash=?,ResetExpiresAt=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE) WHERE AccountID=?',[portalRecoveryHash(account.AccountID,recoveryCode),account.AccountID])
      await db.execute('DELETE FROM employee_portal_attempt WHERE LimitKey=?',[recoveryAttemptKey(account.AccountID)])
    }else await db.execute('UPDATE employee_portal_account SET Status=?,ResetTokenHash=NULL,ResetExpiresAt=NULL WHERE AccountID=?',[body.action==='activate'?'Active':'Inactive',account.AccountID])
    await db.execute('DELETE FROM employee_portal_session WHERE AccountID=?',[account.AccountID])
    await db.execute('INSERT INTO employee_portal_event(AccountID,Action,ActorUserID) VALUES(?,?,?)',[account.AccountID,body.action==='recovery'?'HR issued recovery code':body.action==='activate'?'HR activated account':'HR deactivated account',session.sub])
    const [[expiry]]=recoveryCode?await db.execute<any[]>("SELECT DATE_FORMAT(ResetExpiresAt,'%Y-%m-%dT%H:%i:%s.000Z') AS ExpiresAt FROM employee_portal_account WHERE AccountID=?",[account.AccountID]):[[null]]
    await db.commit();return{success:true,recoveryCode,expiresAt:expiry?.ExpiresAt||null}
  }catch(error){await db.rollback();throw error}finally{db.release()}
}
