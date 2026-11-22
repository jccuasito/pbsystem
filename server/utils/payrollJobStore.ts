import {randomUUID} from 'node:crypto'
import {createError,getRouterParam,readBody,setResponseStatus} from 'h3'
import pool from '../connection/dbconnect'
import {requireSession} from './auth'

export type PayrollJobLease={id:string;token:string}
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
export const payrollQueueEnabled=()=>process.env.PAYROLL_QUEUE_ENABLED==='true'
const dto=(row:any)=>({id:row.JobID,batchId:Number(row.BatchID),status:row.Status,attempts:Number(row.Attempts),
  createdAt:row.CreatedAt,startedAt:row.StartedAt,finishedAt:row.FinishedAt,message:row.Message,
  result:row.ResultJson?typeof row.ResultJson==='string'?JSON.parse(row.ResultJson):row.ResultJson:null})

export async function enqueuePayrollJob(event:any){
  const session=requireSession(event)
  if(!['Admin','Supervisor'].includes(session.userType)||event.context?.moduleCanEdit===false)throw createError({statusCode:403,statusMessage:'Payroll review access is required.'})
  if(!payrollQueueEnabled())throw createError({statusCode:503,statusMessage:'The payroll queue is not enabled.'})
  const body=await readBody(event),batchId=Number(body?.batchId)
  if(!Number.isSafeInteger(batchId)||batchId<1||!uuid(body?.requestKey)||typeof body?.expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedHash))throw createError({statusCode:400,statusMessage:'Open the payroll review before submitting this job.'})
  const db=await pool.getConnection()
  try{
    await db.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
    await db.beginTransaction()
    const [[gate]]=await db.execute<any[]>('SELECT RuntimeID FROM system_runtime WHERE RuntimeID=1 FOR UPDATE')
    if(!gate)throw createError({statusCode:503,statusMessage:'The payroll queue needs its database migration.'})
    const [[existing]]=await db.execute<any[]>('SELECT * FROM payroll_job WHERE RequestedBy=? AND RequestKey=? FOR UPDATE',[session.sub,body.requestKey])
    if(existing){
      if(Number(existing.BatchID)!==batchId||existing.ExpectedHash!==body.expectedHash)throw createError({statusCode:409,statusMessage:'This request key was already used for another review.'})
      await db.commit();return{job:dto(existing)}
    }
    const [[active]]=await db.execute<any[]>('SELECT * FROM payroll_job WHERE ActiveBatchID=? FOR UPDATE',[batchId])
    if(active){
      if(Number(active.RequestedBy)!==session.sub||active.ExpectedHash!==body.expectedHash)throw createError({statusCode:409,statusMessage:'This DTR already has a pending payroll job. Wait for it to finish.'})
      await db.commit();setResponseStatus(event,202);return{job:dto(active)}
    }
    const [[count]]=await db.execute<any[]>("SELECT COUNT(*) AS Total,COALESCE(SUM(RequestedBy=?),0) AS Owned FROM payroll_job WHERE Status IN ('Queued','Running')",[session.sub])
    if(Number(count.Total)>=1000||Number(count.Owned)>=100)throw createError({statusCode:429,statusMessage:'The payroll queue is full. Wait for pending jobs to finish.'})
    const [[batch]]=await db.execute<any[]>('SELECT Status FROM attendance_dtr WHERE BatchID=? FOR UPDATE',[batchId])
    if(!batch||!['Computed to Payroll','Computed to Both'].includes(batch.Status))throw createError({statusCode:409,statusMessage:'Compute and review the current DTR before queueing payroll.'})
    const [[posted]]=await db.execute<any[]>("SELECT PayrollID FROM payroll_processing_posting WHERE BatchID=? AND Status='Active' LIMIT 1",[batchId])
    if(posted)throw createError({statusCode:409,statusMessage:'This DTR is already finalized.'})
    const jobId=randomUUID()
    await db.execute('INSERT INTO payroll_job(JobID,RequestKey,BatchID,RequestedBy,ExpectedHash) VALUES(?,?,?,?,?)',[jobId,body.requestKey,batchId,session.sub,body.expectedHash])
    const [[job]]=await db.execute<any[]>('SELECT * FROM payroll_job WHERE JobID=?',[jobId])
    await db.commit();setResponseStatus(event,202);return{job:dto(job)}
  }catch(error){await db.rollback();throw error}finally{db.release()}
}

export async function listPayrollJobs(event:any){
  const session=requireSession(event)
  if(!payrollQueueEnabled())return{enabled:false,items:[]}
  const id=getRouterParam(event,'id')
  if(id!==undefined&&!uuid(id))throw createError({statusCode:400,statusMessage:'Choose a valid payroll job.'})
  const [rows]=await pool.execute<any[]>(`SELECT * FROM payroll_job WHERE RequestedBy=?${id?' AND JobID=?':" AND (Status IN ('Queued','Running') OR CreatedAt>=DATE_SUB(NOW(),INTERVAL 1 DAY))"} ORDER BY (Status IN ('Queued','Running')) DESC,CreatedAt DESC,JobID DESC LIMIT 100`,id?[session.sub,id]:[session.sub])
  if(id&&!rows.length)throw createError({statusCode:404,statusMessage:'Payroll job not found.'})
  return id?{enabled:true,job:dto(rows[0])}:{enabled:true,items:rows.map(dto)}
}

/** Held throughout the financial transaction. Restart recovery must wait for
 * this row; job success and payroll posting either commit together or roll back. */
export async function lockPayrollJob(db:any,lease:PayrollJobLease,actorId:number,batchId:number){
  const [[job]]=await db.execute('SELECT Status,RunToken,RequestedBy,BatchID FROM payroll_job WHERE JobID=? FOR UPDATE',[lease.id])
  if(!job||job.Status!=='Running'||job.RunToken!==lease.token||Number(job.RequestedBy)!==actorId||Number(job.BatchID)!==batchId)throw createError({statusCode:409,statusMessage:'This payroll job no longer owns execution.'})
  const [[actor]]=await db.execute("SELECT UserType,Status,DeletedAt FROM `user` WHERE UserID=? FOR UPDATE",[actorId])
  if(!actor||actor.Status!=='Active'||actor.DeletedAt||!['Admin','Supervisor'].includes(actor.UserType))throw createError({statusCode:403,statusMessage:'The submitting user no longer has payroll review access.'})
  if(actor.UserType!=='Admin'){
    const [[permission]]=await db.execute("SELECT CanView,CanEdit FROM user_module_permission WHERE UserID=? AND ModuleKey='payroll' FOR UPDATE",[actorId])
    if(permission&&(!permission.CanView||!permission.CanEdit))throw createError({statusCode:403,statusMessage:'Payroll access was changed. Ask an administrator to review this job.'})
  }
}
export async function completePayrollJob(db:any,lease:PayrollJobLease,result:unknown){
  const [changed]=await db.execute("UPDATE payroll_job SET Status='Succeeded',ResultJson=?,Message='Payroll finalized.',RunToken=NULL,FinishedAt=NOW(6) WHERE JobID=? AND Status='Running' AND RunToken=?",[JSON.stringify(result),lease.id,lease.token])
  if(changed.affectedRows!==1)throw createError({statusCode:409,statusMessage:'Payroll job ownership changed.'})
}
