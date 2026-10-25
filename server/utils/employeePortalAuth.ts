import crypto from 'node:crypto'
import { createError, getCookie, setCookie, getRequestHeader, getRequestURL, setHeader } from 'h3'
import pool from '../connection/dbconnect'
import { hashPassword, passwordMatches, assertPassword, normalizeEmail } from './auth'
import { governmentIdIdentity, validateGovernmentId } from '../../shared/utils/governmentIds'
import { normalizePortalName, portalAgreementVersion, portalPrivacySections } from '../../shared/utils/employeePortal'
import { portalRecoveryHash, recoveryAttemptKey } from './employeePortalRecovery'

const cookie='pbs_employee_session'
const digest=(value:string)=>crypto.createHash('sha256').update(value).digest('hex')
const dummyHash=hashPassword('portal-invalid-login-placeholder-2048')
export function portalNoStore(event:any){setHeader(event,'Cache-Control','private, no-store');setHeader(event,'Pragma','no-cache')}
export function portalMutation(event:any){
  const origin=getRequestHeader(event,'origin')
  if(origin&&origin!==getRequestURL(event).origin)throw createError({statusCode:403,statusMessage:'Open this portal directly to continue.'})
  if(!getRequestHeader(event,'content-type')?.toLowerCase().startsWith('application/json'))throw createError({statusCode:415,statusMessage:'Send a JSON request.'})
  if(Number(getRequestHeader(event,'content-length')||0)>16384)throw createError({statusCode:413,statusMessage:'This request is too large.'})
  portalNoStore(event)
}
export async function portalLimit(event:any,action:string,identity='',maximum=15){
  const address=event.node?.req?.socket?.remoteAddress||'local'
  const keys=[`${action}:ip:${address}`,...(identity?[`${action}:identity:${identity}`]:[])]
  const window=Math.floor(Date.now()/900000)
  for(const key of keys){
    const id=digest(key)
    await pool.execute('INSERT INTO employee_portal_attempt(LimitKey,WindowStart,Attempts) VALUES(?,?,1) ON DUPLICATE KEY UPDATE Attempts=Attempts+1',[id,window])
    const [[row]]=await pool.execute<any[]>('SELECT Attempts FROM employee_portal_attempt WHERE LimitKey=? AND WindowStart=?',[id,window])
    if(Number(row.Attempts)>maximum)throw createError({statusCode:429,statusMessage:'Too many attempts. Try again in 15 minutes or contact HR.'})
  }
  await pool.execute('DELETE FROM employee_portal_attempt WHERE WindowStart<?',[window-96])
}
function password(value:unknown,confirmation:unknown){
  if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>72||value!==confirmation)throw createError({statusCode:400,statusMessage:'Passwords must match and be no more than 72 bytes.'})
  assertPassword(value);return value
}
function email(value:unknown){
  if(typeof value!=='string'||value.length>190||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw createError({statusCode:400,statusMessage:'Enter a valid email address.'})
  return normalizeEmail(value)
}
function contact(value:unknown){const text=String(value||'').trim();if(!/^\+?[0-9 ()-]{7,25}$/.test(text))throw createError({statusCode:400,statusMessage:'Enter a valid contact number.'});return text}
export async function startEmployeeSession(event:any,accountId:number){
  const token=crypto.randomBytes(32).toString('hex')
  await pool.execute('DELETE FROM employee_portal_session WHERE ExpiresAt<UTC_TIMESTAMP()')
  await pool.execute('INSERT INTO employee_portal_session(TokenHash,AccountID,ExpiresAt) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 12 HOUR))',[digest(token),accountId])
  setCookie(event,cookie,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:43200})
}
export async function requireEmployeeSession(event:any){
  portalNoStore(event)
  const token=getCookie(event,cookie)
  if(!token||! /^[a-f0-9]{64}$/.test(token))throw createError({statusCode:401,statusMessage:'Please sign in to the employee portal.'})
  const [[account]]=await pool.execute<any[]>(`SELECT a.AccountID,a.EmployeeID,a.Email,a.ContactNumber,
    CONCAT_WS(' ',e.FirstName,e.MiddleName,e.LastName) AS EmployeeName
    FROM employee_portal_session s JOIN employee_portal_account a ON a.AccountID=s.AccountID
    JOIN employee e ON e.EmployeeID=a.EmployeeID
    WHERE s.TokenHash=? AND s.ExpiresAt>UTC_TIMESTAMP() AND a.Status='Active' AND e.Status='Active'`,[digest(token)])
  if(!account)throw createError({statusCode:401,statusMessage:'Your employee session has expired or is unavailable. Please sign in again.'})
  return account
}
export async function registerEmployee(event:any,body:any){
  portalMutation(event);await portalLimit(event,'signup','',5)
  const Email=email(body?.email),ContactNumber=contact(body?.contactNumber)
  const plain=password(body?.password,body?.confirmPassword)
  if(body?.agreementAccepted!==true||body?.agreementVersion!==portalAgreementVersion)throw createError({statusCode:400,statusMessage:'Read and accept the current privacy notice and account terms.'})
  const invalid=validateGovernmentId(body.governmentType,body.governmentNumber)
  if(invalid)throw createError({statusCode:400,statusMessage:invalid})
  for(const key of ['firstName','lastName','middleName'])if(typeof body[key]!=='string'||body[key].length>100||(['firstName','lastName'].includes(key)&&!body[key].trim()))throw createError({statusCode:400,statusMessage:'Enter your full name as recorded by HR. Leave middle name empty only if none is recorded.'})
  const identity=governmentIdIdentity(body.governmentType,body.governmentNumber)
  const hash=await hashPassword(plain),db=await pool.getConnection()
  let accountId=0
  try{
    await db.beginTransaction()
    const [matches]=await db.execute<any[]>(`SELECT e.EmployeeID,e.FirstName,e.MiddleName,e.LastName,g.GovernmentID FROM government g
      JOIN employee e ON e.EmployeeID=g.EmployeeID WHERE g.GovernmentTypeKey=? AND g.GovernmentNumberKey=? AND e.Status='Active' FOR UPDATE`,[identity.typeKey,identity.numberKey])
    const match=matches.length===1&&matches[0]
    if(!match||!['FirstName','MiddleName','LastName'].every(key=>normalizePortalName(match[key])===normalizePortalName(body[key[0].toLowerCase()+key.slice(1)])))throw createError({statusCode:400,statusMessage:'Unable to create an account with these details. Check your HR records or contact your agency HR office.'})
    const [result]=await db.execute<any>(`INSERT INTO employee_portal_account(EmployeeID,Email,ContactNumber,PasswordHash,MatchedGovernmentID,AgreementVersion,AgreementText) VALUES(?,?,?,?,?,?,?)`,[match.EmployeeID,Email,ContactNumber,hash,match.GovernmentID,portalAgreementVersion,JSON.stringify(portalPrivacySections)])
    accountId=Number(result.insertId)
    await db.execute("INSERT INTO employee_portal_event(AccountID,Action) VALUES(?,'Registered and accepted agreement')",[accountId])
    await db.commit()
  }catch(error:any){await db.rollback();if(error?.code==='ER_DUP_ENTRY')throw createError({statusCode:409,statusMessage:'An account already uses these details. Sign in or contact HR for account recovery.'});throw error}finally{db.release()}
  await startEmployeeSession(event,accountId)
  return{success:true}
}
export async function loginEmployee(event:any,body:any){
  portalMutation(event)
  const Email=email(body?.email)
  await portalLimit(event,'login',Email)
  if(typeof body?.password!=='string'||Buffer.byteLength(body.password)>72)throw createError({statusCode:401,statusMessage:'Invalid email or password.'})
  const [[account]]=await pool.execute<any[]>('SELECT a.AccountID,a.PasswordHash,a.Status,e.Status AS EmployeeStatus FROM employee_portal_account a JOIN employee e ON e.EmployeeID=a.EmployeeID WHERE a.Email=?',[Email])
  const valid=await passwordMatches(body.password,account?.PasswordHash||await dummyHash)
  if(!valid||!account||account.Status!=='Active'||account.EmployeeStatus!=='Active')throw createError({statusCode:401,statusMessage:'Invalid email or password, or account unavailable. Contact HR if needed.'})
  await startEmployeeSession(event,account.AccountID)
  await pool.execute("INSERT INTO employee_portal_event(AccountID,Action) VALUES(?,'Signed in')",[account.AccountID])
  return{success:true}
}
export async function logoutEmployee(event:any){
  portalMutation(event)
  const token=getCookie(event,cookie)
  if(token)await pool.execute('DELETE FROM employee_portal_session WHERE TokenHash=?',[digest(token)])
  setCookie(event,cookie,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:0})
  return{success:true}
}
export async function recoverEmployeeAccount(event:any,body:any){
  portalMutation(event);await portalLimit(event,'recovery','',5)
  const Email=email(body?.email)
  if(typeof body?.code!=='string'||! /^[0-9]{6}$/.test(body.code))throw createError({statusCode:400,statusMessage:'Enter the 6-digit recovery code provided by HR.'})
  const nextHash=await hashPassword(password(body.password,body.confirmPassword)),db=await pool.getConnection()
  let accountId=0,committed=false
  const invalid=()=>createError({statusCode:400,statusMessage:'Recovery details are invalid or expired. Check your login email and code, or ask HR for a new code.'})
  try{
    await db.beginTransaction()
    const [[account]]=await db.execute<any[]>(`SELECT a.AccountID,a.ResetTokenHash FROM employee_portal_account a JOIN employee e ON e.EmployeeID=a.EmployeeID
      WHERE a.Email=? AND a.ResetTokenHash IS NOT NULL AND a.ResetExpiresAt>UTC_TIMESTAMP() AND a.Status='Active' AND e.Status='Active' FOR UPDATE`,[Email])
    if(!account)throw invalid()
    accountId=Number(account.AccountID)
    const key=recoveryAttemptKey(accountId),window=Math.floor(Date.now()/900000)
    await db.execute('INSERT INTO employee_portal_attempt(LimitKey,WindowStart,Attempts) VALUES(?,?,1) ON DUPLICATE KEY UPDATE Attempts=Attempts+1',[key,window])
    const [[attempt]]=await db.execute<any[]>('SELECT SUM(Attempts) AS Attempts FROM employee_portal_attempt WHERE LimitKey=?',[key])
    const expected=portalRecoveryHash(accountId,body.code)
    const matches=/^[a-f0-9]{64}$/.test(account.ResetTokenHash)&&crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(account.ResetTokenHash,'hex'))
    if(Number(attempt.Attempts)>5||!matches){
      // Commit failed attempts as well: changing IP or crossing a rate-limit
      // time window cannot restore guesses against the same issued code.
      if(Number(attempt.Attempts)>=5){
        await db.execute('UPDATE employee_portal_account SET ResetTokenHash=NULL,ResetExpiresAt=NULL WHERE AccountID=?',[accountId])
        await db.execute("INSERT INTO employee_portal_event(AccountID,Action) VALUES(?,'Recovery code attempt limit')",[accountId])
      }
      await db.commit();committed=true;throw invalid()
    }
    await db.execute('UPDATE employee_portal_account SET PasswordHash=?,ResetTokenHash=NULL,ResetExpiresAt=NULL WHERE AccountID=?',[nextHash,accountId])
    await db.execute('DELETE FROM employee_portal_session WHERE AccountID=?',[accountId])
    await db.execute("INSERT INTO employee_portal_event(AccountID,Action) VALUES(?,'Used HR recovery code')",[accountId])
    await db.commit();committed=true
  }catch(error){if(!committed)await db.rollback();throw error}finally{db.release()}
  await startEmployeeSession(event,accountId);return{success:true}
}
export async function updateEmployeeAccount(event:any,body:any){
  const account=await requireEmployeeSession(event)
  portalMutation(event);await portalLimit(event,'profile',String(account.AccountID),10)
  const [[saved]]=await pool.execute<any[]>('SELECT PasswordHash FROM employee_portal_account WHERE AccountID=?',[account.AccountID])
  if(typeof body?.currentPassword!=='string'||Buffer.byteLength(body.currentPassword)>72||!await passwordMatches(body.currentPassword,saved.PasswordHash))throw createError({statusCode:403,statusMessage:'Enter your current password.'})
  const Email=email(body.email),ContactNumber=contact(body.contactNumber)
  const nextHash=body.password?await hashPassword(password(body.password,body.confirmPassword)):saved.PasswordHash
  const db=await pool.getConnection()
  try{
    await db.beginTransaction()
    await db.execute('UPDATE employee_portal_account SET Email=?,ContactNumber=?,PasswordHash=?,ResetTokenHash=NULL,ResetExpiresAt=NULL WHERE AccountID=?',[Email,ContactNumber,nextHash,account.AccountID])
    await db.execute('DELETE FROM employee_portal_session WHERE AccountID=?',[account.AccountID])
    await db.execute("INSERT INTO employee_portal_event(AccountID,Action) VALUES(?,'Updated login/contact details')",[account.AccountID])
    await db.commit()
  }catch(error:any){await db.rollback();if(error.code==='ER_DUP_ENTRY')throw createError({statusCode:409,statusMessage:'This email cannot be used. Contact HR if needed.'});throw error}finally{db.release()}
  await startEmployeeSession(event,account.AccountID);return{success:true}
}
