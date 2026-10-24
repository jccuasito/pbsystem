import pool from '../../connection/dbconnect'
import { requireEmployeeSession } from '../../utils/employeePortalAuth'
import { readEmployeePayslips } from '../../utils/payslipCrud'
export default defineEventHandler(async(event)=>{
  const account=await requireEmployeeSession(event)
  // Never accept an employee ID from the browser. The account fixes the owner.
  const current=await readEmployeePayslips(Number(account.EmployeeID))
  const keys=new Set(current.cutoffs.filter(row=>row.publicationStatus==='Posted').map(row=>row.key))
  const [posted]=await pool.execute<any[]>('SELECT PublicationID,GroupKey,SnapshotJson,PostedAt FROM payslip_publication WHERE EmployeeID=? AND Status=? ORDER BY PostedAt DESC',[account.EmployeeID,'Posted'])
  return{payslips:posted.filter(row=>keys.has(row.GroupKey)).map(row=>({publicationId:row.PublicationID,postedAt:row.PostedAt,...JSON.parse(row.SnapshotJson)}))}
})
