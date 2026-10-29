import { createError,getQuery,setHeader } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

export async function listPortalAccounts(event:any){
 const session=requireSession(event)
 setHeader(event,'Cache-Control','private, no-store')
 const canManageAccounts=['Admin','Supervisor'].includes(session.userType)&&event.context?.moduleCanEdit!==false
 const query=getQuery(event),search=String(query.search||'').trim().slice(0,190),agencyId=Number(query.agencyId||0),status=String(query.accountStatus||'')
 if(query.agencyId&&(!Number.isSafeInteger(agencyId)||agencyId<1))throw createError({statusCode:400,statusMessage:'Select a valid agency.'})
 const statuses:Record<string,string>={'':'1=1',active:"portal.Status='Active'",inactive:"portal.Status='Inactive'",unregistered:'portal.AccountID IS NULL'}
 if(!Object.hasOwn(statuses,status))throw createError({statusCode:400,statusMessage:'Select a valid portal account status.'})
 const joins='FROM employee e LEFT JOIN agency_position ap ON ap.AgencyPositionID=e.AgencyPositionID LEFT JOIN employee_portal_account portal ON portal.EmployeeID=e.EmployeeID'
 const where=`WHERE (?=0 OR ap.AgencyID=?) AND (?='' OR CONVERT(CONCAT_WS(' ',e.EmployeeNumber,e.FirstName,e.MiddleName,e.LastName${canManageAccounts?',portal.Email':''}) USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE ?)`
 const params=[agencyId,agencyId,search,'%'+search+'%']
 const [[counts]]=await pool.execute<any[]>(`SELECT COUNT(*) AS Total,COALESCE(SUM(portal.Status='Active'),0) AS Active,COALESCE(SUM(portal.Status='Inactive'),0) AS Inactive,COALESCE(SUM(portal.AccountID IS NULL),0) AS Unregistered ${joins} ${where}`,params)
 const accountSummary={total:Number(counts.Total),active:Number(counts.Active),inactive:Number(counts.Inactive),unregistered:Number(counts.Unregistered)}
 const total=status?accountSummary[status as 'active'|'inactive'|'unregistered']:accountSummary.total,pageSize=25,pages=Math.max(1,Math.ceil(total/pageSize)),page=Math.max(1,Math.min(pages,Math.floor(Number(query.page)||1)))
 const iso=(expression:string)=>`DATE_FORMAT(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,NOW(),UTC_TIMESTAMP()),${expression}),'%Y-%m-%dT%H:%i:%s.000Z')`
 const privateFields=canManageAccounts?`portal.Email AS PortalEmail,portal.ContactNumber AS PortalContactNumber,${iso('portal.CreatedAt')} AS PortalCreatedAt,
 ${iso("(SELECT MAX(login.CreatedAt) FROM employee_portal_event login WHERE login.AccountID=portal.AccountID AND login.Action='Signed in')")} AS PortalLastSignInAt,
 (SELECT COUNT(*) FROM employee_portal_session ps WHERE ps.AccountID=portal.AccountID AND ps.ExpiresAt>UTC_TIMESTAMP()) AS PortalActiveSessions`:'NULL AS PortalEmail,NULL AS PortalContactNumber,NULL AS PortalCreatedAt,NULL AS PortalLastSignInAt,NULL AS PortalActiveSessions'
 const [items]=await pool.execute<any[]>(`SELECT e.EmployeeID,e.EmployeeNumber,CONCAT_WS(', ',e.LastName,CONCAT_WS(' ',e.FirstName,e.MiddleName)) AS EmployeeName,e.Status,a.AgencyName,p.PositionName,
 CASE WHEN portal.AccountID IS NULL THEN 'Not registered' ELSE portal.Status END AS PortalStatus,${privateFields}
 ${joins} LEFT JOIN agency a ON a.AgencyID=ap.AgencyID LEFT JOIN \`position\` p ON p.PositionID=ap.PositionID ${where} AND (${statuses[status]}) ORDER BY e.LastName,e.FirstName,e.EmployeeID LIMIT ? OFFSET ?`,[...params,pageSize,(page-1)*pageSize])
 const [agencies]=await pool.execute<any[]>("SELECT AgencyID,AgencyName FROM agency WHERE Status='Active' ORDER BY AgencyName")
 return{items,agencies,canManageAccounts,accountSummary,pagination:{page,pageSize,pages,total}}
}
