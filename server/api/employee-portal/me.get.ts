import { requireEmployeeSession } from '../../utils/employeePortalAuth'
import pool from '../../connection/dbconnect'
export default defineEventHandler(async(event)=>{
  const account=await requireEmployeeSession(event)
  const [[profile]]=await pool.execute<any[]>(`SELECT e.EmployeeNumber,a.AgencyName,p.PositionName
    FROM employee e LEFT JOIN agency_position ap ON ap.AgencyPositionID=e.AgencyPositionID
    LEFT JOIN agency a ON a.AgencyID=ap.AgencyID LEFT JOIN \`position\` p ON p.PositionID=ap.PositionID
    WHERE e.EmployeeID=?`,[account.EmployeeID])
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  const [sites]=await pool.execute<any[]>(`SELECT DISTINCT s.SiteID,s.SiteName,c.ClientName,ed.DeploymentType,ed.IsPermanentSite
    FROM employee_deployment ed JOIN site s ON s.SiteID=ed.SiteID
    JOIN client c ON c.ClientID=s.ClientID
    WHERE ed.EmployeeID=? AND ed.StartDate<=? AND (ed.EndDate IS NULL OR ed.EndDate>=?) AND s.Status='Active'
    ORDER BY ed.IsPermanentSite DESC,s.SiteName`,[account.EmployeeID,today,today])
  return{account:{...account,EmployeeNumber:profile?.EmployeeNumber||null,AgencyName:profile?.AgencyName||null,PositionName:profile?.PositionName||null,CurrentSites:sites}}
})
