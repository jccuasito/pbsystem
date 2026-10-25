import pool from '../../connection/dbconnect'
import { requireEmployeeSession } from '../../utils/employeePortalAuth'
import { readEmployeePayslips } from '../../utils/payslipCrud'
export default defineEventHandler(async(event)=>{
  const account=await requireEmployeeSession(event)
  // Never accept an employee ID from the browser. The account fixes the owner.
  const current=await readEmployeePayslips(Number(account.EmployeeID))
  const keys=new Set(current.cutoffs.filter(row=>row.publicationStatus==='Posted').map(row=>row.key))
  // PostedAt is a database-local DATETIME. Convert it before mysql2 (configured
  // for UTC Dates) can reinterpret the local clock as a UTC instant.
  const [posted]=await pool.execute<any[]>(`SELECT PublicationID,GroupKey,SnapshotJson,
    DATE_FORMAT(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,NOW(),UTC_TIMESTAMP()),PostedAt),'%Y-%m-%dT%H:%i:%s.000Z') AS PostedAt
    FROM payslip_publication WHERE EmployeeID=? AND Status=? ORDER BY payslip_publication.PostedAt DESC`,[account.EmployeeID,'Posted'])
  return{payslips:posted.filter(row=>keys.has(row.GroupKey)).map(row=>({publicationId:row.PublicationID,postedAt:row.PostedAt,...JSON.parse(row.SnapshotJson)}))}
})
