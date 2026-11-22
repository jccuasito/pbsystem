import pool from '../../connection/dbconnect'
import { requireEmployeeSession } from '../../utils/employeePortalAuth'
import { readEmployeePayslips } from '../../utils/payslipCrud'
export default defineEventHandler(async(event)=>{
  const account=await requireEmployeeSession(event)
  // Never accept an employee ID from the browser. The account fixes the owner.
  // One admitted portal read owns one pool lease. The profile's internal
  // parallel lookups queue on this connection instead of multiplying 100
  // portal requests into hundreds of competing pool acquisitions.
  const connection=await pool.getConnection()
  try{
  const current=await readEmployeePayslips(Number(account.EmployeeID),connection)
  const keys=new Set(current.cutoffs.filter(row=>row.publicationStatus==='Posted').map(row=>row.key))
  // PostedAt is a database-local DATETIME. Convert it before mysql2 (configured
  // for UTC Dates) can reinterpret the local clock as a UTC instant.
  const [posted]=await connection.execute<any[]>(`SELECT PublicationID,GroupKey,SnapshotJson,
    DATE_FORMAT(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,NOW(),UTC_TIMESTAMP()),PostedAt),'%Y-%m-%dT%H:%i:%s.000Z') AS PostedAt
    FROM payslip_publication WHERE EmployeeID=? AND Status=? ORDER BY payslip_publication.PostedAt DESC`,[account.EmployeeID,'Posted'])
  return{payslips:posted.filter(row=>keys.has(row.GroupKey)).map(row=>({publicationId:row.PublicationID,postedAt:row.PostedAt,...JSON.parse(row.SnapshotJson)}))}
  }finally{connection.release()}
})
