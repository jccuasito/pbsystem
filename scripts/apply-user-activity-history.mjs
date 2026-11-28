import fs from 'node:fs/promises'
import mysql from 'mysql2/promise'
import {createDatabaseBackup} from '../server/utils/databaseBackup.mjs'
import {ensureActivityHistoryIndexes} from './helpers/activity-history-schema.mjs'

if(!['localhost','127.0.0.1','::1'].includes(process.env.DB_HOST||'127.0.0.1'))throw Error('Local database only')
const sql=await fs.readFile(new URL('../database/user-activity-history.sql',import.meta.url),'utf8')
if(!process.argv.includes('--apply')){console.log(sql);console.log('Preview only. --apply creates a verified backup, adds the history table if missing, and upgrades its time/cursor indexes. No history is removed.');process.exit(0)}
await createDatabaseBackup('manual')
const db=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME})
try{await db.query(sql);await ensureActivityHistoryIndexes(db);console.log('Local user activity history and time/cursor indexes ready.')}finally{await db.end()}
