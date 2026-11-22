import {createHash,randomUUID} from 'node:crypto'
import pool from '../connection/dbconnect'
import {acquireBackgroundCapacity} from './requestCapacity'
import {executePayrollReview} from './payrollProcessingCrud'
import {payrollQueueEnabled} from './payrollJobStore'
import {isDatabaseRestoring} from './databaseBackup.mjs'
let stopWorker:()=>Promise<void>=async()=>{}
export function registerPayrollQueueStop(stop:()=>Promise<void>){stopWorker=stop}
export async function stopPayrollQueue(){await stopWorker()}

/** One database-wide worker (including across Node processes), with durable jobs.
 * The advisory lock is held on its own connection, never returned to the pool. */
export async function runPayrollQueueTick(){
  if(!payrollQueueEnabled()||isDatabaseRestoring())return
  const releaseCapacity=acquireBackgroundCapacity()
  if(!releaseCapacity)return
  let db:any,owned=false,lockName=''
  try{
    db=await pool.getConnection()
    const [[schema]]=await db.execute('SELECT DATABASE() AS name')
    lockName='pbs:payroll:'+createHash('sha256').update(String(schema.name)).digest('hex').slice(0,32)
    const [[lock]]=await db.execute('SELECT GET_LOCK(?,0) AS owned',[lockName])
    if(Number(lock.owned)!==1)return
    owned=true
    // A prior process may have died after claiming a job. Recovery updates wait
    // for any surviving financial transaction's job-row lock. If it committed,
    // its Succeeded row no longer matches; no uncertain posting is replayed.
    await db.execute("UPDATE payroll_job SET Status='Queued',RunToken=NULL,Message='Resumed after worker restart.' WHERE Status='Running'")
    const [[job]]=await db.execute("SELECT JobID,BatchID,RequestedBy,ExpectedHash FROM payroll_job WHERE Status='Queued' ORDER BY CreatedAt,JobID LIMIT 1")
    if(!job||isDatabaseRestoring())return
    const token=randomUUID()
    const [claimed]=await db.execute("UPDATE payroll_job SET Status='Running',RunToken=?,Attempts=Attempts+1,StartedAt=NOW(6),Message='Processing reviewed payroll.' WHERE JobID=? AND Status='Queued'",[token,job.JobID])
    if(claimed.affectedRows!==1)return
    try{
      await executePayrollReview({sub:Number(job.RequestedBy),userType:'Supervisor'},Number(job.BatchID),{action:'finalize',expectedHash:job.ExpectedHash},{id:job.JobID,token})
    }catch(error:any){
      // A lost commit acknowledgement may already have committed the success
      // row. Never change it or automatically retry an uncertain financial POST.
      const code=Number(error?.statusCode)||500
      const message=code>=400&&code<500?String(error.statusMessage||'Review this payroll again.').slice(0,300):'Payroll could not finish. Review its status before submitting again.'
      await db.execute("UPDATE payroll_job SET Status=?,ErrorCode=?,Message=?,RunToken=NULL,FinishedAt=NOW(6) WHERE JobID=? AND Status='Running' AND RunToken=?",[code===409?'NeedsReview':'Failed',code,message,job.JobID,token])
    }
  }finally{
    // Destroy a connection if release cannot be confirmed: a pooled connection
    // must never retain the database-wide worker lock.
    if(db){try{if(owned)await db.execute('SELECT RELEASE_LOCK(?)',[lockName]);db.release()}catch{db.destroy()}}
    releaseCapacity()
  }
}
