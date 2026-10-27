import mysql from 'mysql2/promise'
import { readFile } from 'node:fs/promises'
import { createDatabaseBackup } from '../server/utils/databaseBackup.mjs'
const db=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'pbsystem'})
try{
 const names=['employee_information_request','employee_information_message','payslip_archive','payslip_archive_event']
 const [rows]=await db.execute('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?,?)',names)
 const [columns]=await db.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payslip_archive' AND COLUMN_NAME IN ('SiteID','AgencyID')")
 if(rows.length!==names.length||columns.length!==2){
  const backup=await createDatabaseBackup('before-portal-history-requests');console.log('Safety SQL backup: '+backup.name)
  const schema=await readFile(new URL('../database/payslip-portal-history-requests.sql',import.meta.url),'utf8')
  for(const statement of schema.split(';').map(value=>value.trim()).filter(Boolean))await db.query(statement)
  const [current]=await db.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payslip_archive'")
  const present=new Set(current.map(row=>row.COLUMN_NAME));for(const name of ['SiteID','AgencyID'])if(!present.has(name))await db.query('ALTER TABLE payslip_archive ADD COLUMN `'+name+'` INT NULL')
  const [indexes]=await db.query("SHOW INDEX FROM payslip_archive WHERE Key_name='idx_archive_site_cutoff'");if(!indexes.length)await db.query('ALTER TABLE payslip_archive ADD KEY idx_archive_site_cutoff(SiteID,AgencyID,PeriodStart,PeriodEnd)')
 }
 console.log('Historical PDF and information-request tables ready. No payslips imported or employee records changed.')
}finally{await db.end()}
