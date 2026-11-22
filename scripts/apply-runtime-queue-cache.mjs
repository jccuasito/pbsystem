import fs from 'node:fs/promises'
import mysql from 'mysql2/promise'
import {createDatabaseBackup} from '../server/utils/databaseBackup.mjs'

// This feature is being developed locally. Never infer permission to migrate a host.
if(!['localhost','127.0.0.1','::1'].includes(process.env.DB_HOST||'127.0.0.1'))throw Error('Local database only')
const sql=await fs.readFile(new URL('../database/runtime-queue-cache.sql',import.meta.url),'utf8')
if(!process.argv.includes('--apply')){console.log(sql);console.log('Preview only. --apply creates a verified backup before adding the tables.');process.exit(0)}
await createDatabaseBackup('manual')
const db=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME})
try{for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);console.log('Local queue/cache schema ready.')}finally{await db.end()}
