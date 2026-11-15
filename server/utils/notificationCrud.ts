import { createHash } from 'node:crypto'
import { createError, getQuery, readBody, setHeader } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { currentActor, accessForUser } from './settingsAccess'
import { requireEmployeeSession } from './employeePortalAuth'
import { dailyBackupFailure } from './databaseBackup.mjs'
import { coalesceRead } from './requestCapacity'
import type { NotificationFeed, NotificationKind, NotificationTarget, SystemNotification } from '../../shared/utils/notifications'

type Db = Pick<typeof pool,'execute'>
const iso=(column:string)=>`DATE_FORMAT(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,NOW(),UTC_TIMESTAMP()),${column}),'%Y-%m-%dT%H:%i:%s.000Z')`
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const positive=(value:unknown)=>Number.isSafeInteger(Number(value))&&Number(value)>0
function notice(key:string,kind:NotificationKind,title:string,message:string,severity:SystemNotification['severity'],updatedAt:string|null,target:NotificationTarget,fingerprint:unknown):SystemNotification {
  return{key,kind,title,message,severity,updatedAt,target,revision:digest([key,fingerprint]),read:false}
}
function noQuery(event:any){if(Object.keys(getQuery(event)).length)throw createError({statusCode:400,statusMessage:'Notifications do not accept filters or account identifiers.'})}
async function source(db:Db,key:string,sql:string,args:any[]=[]) {
  const run=async()=>{const [rows]=await db.execute<any[]>(sql,args);return rows}
  return db===pool ? coalesceRead('notifications:'+key,run) : run()
}

// Same grouping and source-set validation used by payslips. This projection has
// no pay amounts or snapshots; portal queries scope finalized sources to the owner.
export function notificationPublicationCte(owned=false) {
  return `WITH finalized AS (
    SELECT py.EmployeeID,py.PayrollID,pp.BatchID,py.StartDate,py.EndDate,
      CONCAT(DATE_FORMAT(py.StartDate,'%Y-%m-%d'),':',DATE_FORMAT(py.EndDate,'%Y-%m-%d'),':',
        CASE WHEN CONVERT(COALESCE(de.AttendanceType,ed.DeploymentType,'Regular') USING utf8mb4) COLLATE utf8mb4_unicode_ci='Reliever'
          THEN CONCAT('reliever:',COALESCE(NULLIF(COALESCE(d.SiteID,ed.SiteID),0),CONCAT('payroll:',py.PayrollID))) ELSE 'regular' END) AS GroupKey
    FROM payroll py
    LEFT JOIN payroll_processing_posting pp ON pp.PayrollID=py.PayrollID AND pp.Status='Active'
    LEFT JOIN attendance_dtr d ON d.BatchID=pp.BatchID
    LEFT JOIN attendance_dtr_employee de ON de.BatchID=pp.BatchID AND de.EmployeeID=py.EmployeeID
    LEFT JOIN employee_deployment ed ON ed.DeploymentID=py.DeploymentID
    WHERE py.Status IN ('Approved','Released') ${owned?'AND py.EmployeeID=?':''}
  ), current_groups AS (
    SELECT EmployeeID,GroupKey,COUNT(*) AS SourceCount FROM finalized GROUP BY EmployeeID,GroupKey
  ), valid_publications AS (
    SELECT pub.PublicationID,pub.EmployeeID,pub.GroupKey,pub.PostedAt
    FROM payslip_publication pub
    JOIN current_groups g ON g.EmployeeID=pub.EmployeeID AND g.GroupKey=pub.GroupKey
    LEFT JOIN payslip_publication_source src ON src.PublicationID=pub.PublicationID
    LEFT JOIN finalized f ON f.PayrollID=src.PayrollID AND f.EmployeeID=pub.EmployeeID AND f.GroupKey=pub.GroupKey
    WHERE pub.Status='Posted'
    GROUP BY pub.PublicationID,pub.EmployeeID,pub.GroupKey,pub.PostedAt,g.SourceCount
    HAVING COUNT(src.PayrollID)=g.SourceCount AND COUNT(f.PayrollID)=g.SourceCount
      AND JSON_LENGTH(JSON_EXTRACT(IF(JSON_VALID(MAX(pub.SnapshotJson)),MAX(pub.SnapshotJson),'{}'),'$.cutoff.payrollIds'))=g.SourceCount
      AND SUM(CASE WHEN JSON_CONTAINS(JSON_EXTRACT(IF(JSON_VALID(pub.SnapshotJson),pub.SnapshotJson,'{}'),'$.cutoff.payrollIds'),CAST(src.PayrollID AS CHAR)) THEN 1 ELSE 0 END)=g.SourceCount
  )`
}

export async function staffNotificationItems(actor:{UserID:number;UserType:string},access:Record<string,{canView:boolean;canEdit?:boolean}>,db:Db=pool,day=today(),backup=dailyBackupFailure) {
  const tasks:Promise<SystemNotification[]>[]=[]
  if(actor.UserType==='Admin')tasks.push((async()=>{
    // Team access writes permissions on initial activation. Previously configured
    // or previously signed-in accounts must not be treated as new registrations.
    const [row]=await source(db,'staff-account-setup',`SELECT COUNT(*) AS Total,
      SUM(CRC32(CONCAT(u.UserID,':',u.CreatedAt))) AS Fingerprint,${iso('MAX(u.CreatedAt)')} AS ChangedAt
      FROM \`user\` u WHERE u.Status=?
      AND NOT EXISTS(SELECT 1 FROM user_module_permission p WHERE p.UserID=u.UserID)
      AND NOT EXISTS(SELECT 1 FROM user_history h WHERE h.UserID=u.UserID)`,['Inactive'])
    return positive(row?.Total)?[notice('staff-account-setup','staff-account-setup','Staff accounts awaiting setup',`${row.Total} staff account(s) await initial activation and access setup. Review their department, role and module permissions in Team access.`,'info',row.ChangedAt,{view:'settings',section:'users'},[row.Total,row.Fingerprint])]:[]
  })())
  if(access.attendance?.canView)tasks.push((async()=>{
    const [row]=await source(db,'dtr:'+day,`SELECT COUNT(*) AS Total,MAX(d.BatchID) AS Latest,
      ${iso('MAX(d.CreatedAt)')} AS ChangedAt,
      SUM((SELECT COUNT(*) FROM attendance at WHERE at.BatchID=d.BatchID AND ((at.TimeIn IS NULL AND at.TimeOut IS NOT NULL) OR (at.TimeIn IS NOT NULL AND at.TimeOut IS NULL)))) AS MissingPunches
      FROM attendance_dtr d WHERE d.Status='Draft' AND d.PeriodEnd>=DATE_SUB(?,INTERVAL 90 DAY) AND d.PeriodStart<=?`,[day,day])
    return positive(row?.Total)?[notice('dtr-review','dtr-review','DTRs need review',`${row.Total} draft DTR(s) in recent cutoffs need review.${positive(row.MissingPunches)?` ${row.MissingPunches} attendance row(s) have an incomplete time-in/time-out pair.`:''}`,'warning',row.ChangedAt,{view:'attendance-dtr'},[row.Total,row.Latest,row.MissingPunches])]:[]
  })())
  if(access.payroll?.canView)tasks.push((async()=>{
    const [row]=await source(db,'payroll:'+day,`SELECT COUNT(*) AS Total,MAX(d.BatchID) AS Latest,${iso('MAX(d.CreatedAt)')} AS ChangedAt
      FROM attendance_dtr d WHERE d.Status IN ('Computed to Payroll','Computed to Both')
      AND d.PeriodEnd>=DATE_SUB(?,INTERVAL 90 DAY) AND d.PeriodStart<=?
      AND NOT EXISTS(SELECT 1 FROM payroll_processing_posting p WHERE p.BatchID=d.BatchID AND p.Status='Active')`,[day,day])
    return positive(row?.Total)?[notice('payroll-review','payroll-review','Payroll ready for review',`${row.Total} computed site payroll(s) in recent cutoffs await review and finalization.`,'warning',row.ChangedAt,{view:'payroll-processing'},[row.Total,row.Latest])]:[]
  })())
  if(access.payslips?.canView)tasks.push((async()=>{
    const [row]=await source(db,'payslips:'+day,notificationPublicationCte()+` SELECT COUNT(DISTINCT f.EmployeeID,f.GroupKey) AS Total,MAX(f.PayrollID) AS Latest
      FROM finalized f WHERE f.EndDate>=DATE_SUB(?,INTERVAL 90 DAY) AND f.StartDate<=?
      AND NOT EXISTS(SELECT 1 FROM valid_publications v WHERE v.EmployeeID=f.EmployeeID AND v.GroupKey=f.GroupKey)`,[day,day])
    return positive(row?.Total)?[notice('payslip-posting','payslip-posting','Payslips awaiting posting',`${row.Total} finalized employee payslip group(s) in recent cutoffs are not fully posted. Review the sources before posting.`,'info',null,{view:'payslip-sites'},[row.Total,row.Latest])]:[]
  })())
  const managesRequests=['Admin','Supervisor'].includes(actor.UserType)&&access.employees?.canView&&access.employees?.canEdit
  if(managesRequests)tasks.push((async()=>{
    const [row]=await source(db,'requests',`SELECT COUNT(*) AS Total,MAX(m.MessageID) AS Latest,${iso('MAX(m.CreatedAt)')} AS ChangedAt
      FROM employee_information_request r JOIN employee_information_message m ON m.RequestID=r.RequestID
      WHERE r.Status IN ('Pending','In review') AND m.Sender='Employee'
      AND m.MessageID=(SELECT MAX(last.MessageID) FROM employee_information_message last WHERE last.RequestID=r.RequestID)`)
    return positive(row?.Total)?[notice('portal-requests','portal-requests','Employee requests need a response',`${row.Total} open information request(s) have an employee message awaiting HR review.`,'info',row.ChangedAt,{view:'employees-portal-accounts',section:'requests'},[row.Total,row.Latest])]:[]
  })())
  if(access.employees?.canView)tasks.push((async()=>{
    const [row]=await source(db,'expiry:'+day,`SELECT COUNT(*) AS Total,MIN(x.ExpiryDate) AS Earliest,SUM(CRC32(CONCAT(x.Kind,':',x.RecordID,':',x.ExpiryDate))) AS Fingerprint
      FROM (SELECT 'license' AS Kind,LicenseID AS RecordID,EmployeeID,ExpiryDate FROM license
        UNION ALL SELECT 'clearance',ClearanceID,EmployeeID,ExpiryDate FROM clearance) x
      JOIN employee e ON e.EmployeeID=x.EmployeeID
      WHERE e.Status='Active' AND x.ExpiryDate BETWEEN ? AND DATE_ADD(?,INTERVAL 30 DAY)`,[day,day])
    return positive(row?.Total)?[notice('document-expiry','document-expiry','Documents expiring within 30 days',`${row.Total} employee license/clearance record(s) expire today or within the next 30 days. Check their recorded expiry dates.`,'warning',null,{view:'employees-documents'},[row.Total,row.Fingerprint])]:[]
  })())
  if(actor.UserType==='Admin'&&process.env.DB_AUTO_BACKUP!=='false')tasks.push((async()=>{
    const failure=await backup()
    return failure?[notice('backup-failed','backup-failed','Scheduled backup failed','The latest scheduled database backup did not complete. Open Backups and review its status.','danger',failure.failedAt,{view:'settings',section:'backups'},failure.failedAt)]:[]
  })())
  return (await Promise.all(tasks)).flat()
}

export async function employeeNotificationItems(account:{AccountID:number;EmployeeID:number},db:Db=pool) {
  const [[posted],[archived],[replies]]=await Promise.all([
    db.execute<any[]>(notificationPublicationCte(true)+` SELECT v.PublicationID,${iso('v.PostedAt')} AS ChangedAt
      FROM valid_publications v WHERE v.EmployeeID=? AND v.PostedAt>=DATE_SUB(NOW(),INTERVAL 90 DAY)
      ORDER BY v.PostedAt DESC,v.PublicationID DESC LIMIT 10`,[account.EmployeeID,account.EmployeeID]),
    db.execute<any[]>(`SELECT ArchiveID,${iso('PostedAt')} AS ChangedAt FROM payslip_archive
      WHERE EmployeeID=? AND Status='Posted' AND PostedAt>=DATE_SUB(NOW(),INTERVAL 90 DAY) ORDER BY PostedAt DESC,ArchiveID DESC LIMIT 10`,[account.EmployeeID]),
    db.execute<any[]>(`SELECT r.RequestID,MAX(m.MessageID) AS Latest,${iso('MAX(m.CreatedAt)')} AS ChangedAt
      FROM employee_information_request r JOIN employee_information_message m ON m.RequestID=r.RequestID
      WHERE r.EmployeeID=? AND r.AccountID=? AND m.Sender='Staff' AND m.CreatedAt>=DATE_SUB(NOW(),INTERVAL 90 DAY)
      GROUP BY r.RequestID ORDER BY MAX(m.MessageID) DESC LIMIT 10`,[account.EmployeeID,account.AccountID])
  ])
  return [
    ...posted.map(row=>notice('own-payslip:'+row.PublicationID,'own-payslip','A payslip is available','A posted payslip is available in your account. Open your payslips to review it.','info',row.ChangedAt,{view:'payslips'},row.ChangedAt)),
    ...archived.map(row=>notice('own-archive:'+row.ArchiveID,'own-payslip','An archived payslip is available','A posted PDF payslip is available in your account. Open your payslips and review Previous payslips.','info',row.ChangedAt,{view:'payslips'},row.ChangedAt)),
    ...replies.map(row=>notice('own-request:'+row.RequestID,'own-request','HR replied to your information request',`Your information request #${row.RequestID} has a staff response. Open My information to read it.`,'info',row.ChangedAt,{view:'information'},row.Latest))
  ]
}

const receiptTables={staff:{table:'staff_notification_read',owner:'UserID'},employee:{table:'employee_notification_read',owner:'AccountID'}} as const
async function feed(items:SystemNotification[],kind:keyof typeof receiptTables,owner:number,db:Db=pool):Promise<NotificationFeed> {
  const config=receiptTables[kind]
  if(items.length){
    const [receipts]=await db.execute<any[]>(`SELECT NotificationKey,Revision FROM ${config.table} WHERE ${config.owner}=? AND NotificationKey IN (${items.map(()=>'?').join(',')})`,[owner,...items.map(item=>item.key)])
    const read=new Map(receipts.map(row=>[row.NotificationKey,row.Revision]))
    items=items.map(item=>({...item,read:read.get(item.key)===item.revision}))
  }
  items.sort((a,b)=>Number(a.read)-Number(b.read)||Number(b.severity==='danger')-Number(a.severity==='danger')||(b.updatedAt||'').localeCompare(a.updatedAt||''))
  return{items,unreadCount:items.filter(item=>!item.read).length,generatedAt:new Date().toISOString()}
}
async function mark(event:any,items:SystemNotification[],kind:keyof typeof receiptTables,owner:number,db:typeof pool=pool) {
  const body=await readBody(event)
  if(!body||Object.keys(body).some(key=>key!=='items')||!Array.isArray(body.items)||!body.items.length||body.items.length>50)throw createError({statusCode:400,statusMessage:'Choose up to 50 notifications to mark as read.'})
  const current=new Map(items.map(item=>[item.key,item.revision])),seen=new Set<string>()
  for(const item of body.items){
    if(!item||Object.keys(item).some(key=>!['key','revision'].includes(key))||typeof item.key!=='string'||typeof item.revision!=='string'||!/^[a-z0-9:-]{1,100}$/.test(item.key)||!/^[a-f0-9]{64}$/.test(item.revision)||seen.has(item.key))throw createError({statusCode:400,statusMessage:'Choose a valid notification.'})
    seen.add(item.key)
    if(current.get(item.key)!==item.revision)throw createError({statusCode:409,statusMessage:'Notifications changed. Refresh the list and try again.'})
  }
  const config=receiptTables[kind],connection=await db.getConnection()
  try {
    await connection.beginTransaction()
    await connection.execute(`INSERT INTO ${config.table} (${config.owner},NotificationKey,Revision,ReadAt) VALUES ${body.items.map(()=>'(?,?,?,UTC_TIMESTAMP())').join(',')}
      ON DUPLICATE KEY UPDATE Revision=VALUES(Revision),ReadAt=UTC_TIMESTAMP()`,body.items.flatMap((item:any)=>[owner,item.key,item.revision]))
    await connection.commit()
    return{success:true}
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}
export async function listStaffNotifications(event:any) {
  const session=requireSession(event);setHeader(event,'Cache-Control','private, no-store');noQuery(event)
  const actor=await currentActor(event),access=await accessForUser(actor.UserID,actor.UserType)
  return feed(await staffNotificationItems(actor,access),'staff',session.sub)
}
export async function readStaffNotifications(event:any) {
  const session=requireSession(event);setHeader(event,'Cache-Control','private, no-store');noQuery(event)
  const actor=await currentActor(event),access=await accessForUser(actor.UserID,actor.UserType)
  return mark(event,await staffNotificationItems(actor,access),'staff',session.sub)
}
export async function listEmployeeNotifications(event:any) {
  const account=await requireEmployeeSession(event);noQuery(event)
  return feed(await employeeNotificationItems(account),'employee',account.AccountID)
}
export async function readEmployeeNotifications(event:any) {
  const account=await requireEmployeeSession(event);noQuery(event)
  return mark(event,await employeeNotificationItems(account),'employee',account.AccountID)
}
