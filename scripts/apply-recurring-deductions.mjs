import fs from 'node:fs/promises'
import mysql from 'mysql2/promise'
import migrate from './lib/recurring-catalog-migration.cjs'
const db=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'pbsystem'})
try {
 await db.query(await fs.readFile(new URL('../database/recurring-deductions.sql',import.meta.url),'utf8'))
 const result=await migrate(db)
 console.log(`Recurring Deduction catalog ready; ${result.moved} existing catalog item(s) moved. Financial IDs and balances retained.`)
}finally{await db.end()}
