import mysql from 'mysql2/promise'
import { readFile } from 'node:fs/promises'
import { createDatabaseBackup } from '../server/utils/databaseBackup.mjs'
const db=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'pbsystem'})
try {
 const names=['employee_portal_account','employee_portal_session','employee_portal_attempt','employee_portal_event','payslip_publication','payslip_publication_source','payslip_publication_event']
 const [rows]=await db.execute(`SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(()=>'?').join(',')})`,names)
 const [[agreement]]=await db.execute("SELECT COUNT(*) AS total FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employee_portal_account' AND COLUMN_NAME='AgreementText'")
 if(rows.length!==names.length||!Number(agreement.total)){
  const backup=await createDatabaseBackup('before-employee-portal');console.log('Safety SQL backup: '+backup.name)
  const schema=await readFile(new URL('../database/employee-portal.sql',import.meta.url),'utf8')
  for(const statement of schema.split(';').map(value=>value.trim()).filter(Boolean))await db.query(statement)
  const [[updated]]=await db.execute("SELECT COUNT(*) AS total FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employee_portal_account' AND COLUMN_NAME='AgreementText'")
  if(!Number(updated.total))await db.execute('ALTER TABLE employee_portal_account ADD COLUMN AgreementText LONGTEXT NULL AFTER AgreementVersion')
 }
 console.log('Employee portal and payslip posting tables ready. No accounts created or payslips posted.')
}finally{await db.end()}
