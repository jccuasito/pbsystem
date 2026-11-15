import fs from 'node:fs'
import { parseEnv } from 'node:util'
import mysql from 'mysql2/promise'
import { createDatabaseBackup } from '../server/utils/databaseBackup.mjs'

const env={...parseEnv(fs.readFileSync('.env','utf8')),...process.env}
for(const key of ['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME','MYSQLDUMP_BIN','DB_BACKUP_DIR'])if(env[key]!==undefined)process.env[key]=env[key]
const db=await mysql.createConnection({host:env.DB_HOST||'127.0.0.1',port:Number(env.DB_PORT||3306),user:env.DB_USER||'root',password:env.DB_PASSWORD,database:env.DB_NAME||'pbsystem'})
try {
  const [[row]]=await db.execute("SELECT COUNT(*) AS Total FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('staff_notification_read','employee_notification_read')")
  if(Number(row.Total)<2){
    const backup=await createDatabaseBackup('before-notifications')
    console.log('Pre-migration backup:',backup.name)
    for(const sql of fs.readFileSync('database/notifications.sql','utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.query(sql)
  }
  console.log('Notification read-state tables ready. No payroll, attendance or employee records were changed.')
}finally{await db.end()}
