import mysql from 'mysql2/promise'
import { readFile } from 'node:fs/promises'
import { createDatabaseBackup } from '../server/utils/databaseBackup.mjs'
const db=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'pbsystem'})
try{
 const [[table]]=await db.execute("SELECT COUNT(*) AS total FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='site_account'")
 const [[column]]=await db.execute("SELECT COUNT(*) AS total FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='site' AND COLUMN_NAME='SiteAccountID'")
 const [[foreign]]=await db.execute("SELECT COUNT(*) AS total FROM information_schema.table_constraints WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='site' AND CONSTRAINT_NAME='fk_site_account'")
 if(!Number(table.total)||!Number(column.total)||!Number(foreign.total)){
  const backup=await createDatabaseBackup('before-site-accounts');console.log('Safety SQL backup: '+backup.name)
  const schema=await readFile(new URL('../database/site-accounts.sql',import.meta.url),'utf8')
  await db.query(schema.split('ALTER TABLE site')[0])
  if(!Number(column.total))await db.execute('ALTER TABLE site ADD COLUMN SiteAccountID INT NULL, ADD KEY idx_site_account (SiteAccountID)')
  if(!Number(foreign.total))await db.execute('ALTER TABLE site ADD CONSTRAINT fk_site_account FOREIGN KEY (SiteAccountID) REFERENCES site_account (SiteAccountID) ON DELETE RESTRICT ON UPDATE CASCADE')
 }
 console.log('Site Accounts are ready. Existing sites and payroll records retained; no agency link or assignments were added.')
}finally{await db.end()}
