import { createError, getQuery, readBody, setHeader } from 'h3'
import { createHash } from 'node:crypto'
import pool from '../connection/dbconnect'
import { payrollProcessingData } from './payrollProcessingCrud'
import { requireSession } from './auth'
import { dateOnly, todayInPhilippines } from './rateVersions'
const fail=(message:string,code=400):never=>{throw createError({statusCode:code,statusMessage:message})}
const id=(value:any)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)fail('Select a valid record.');return n}
const money=(value:any,zero=false)=>{if(value===''||value==null)fail('Enter an amount.');const n=Number(value);if(!['number','string'].includes(typeof value)||!Number.isFinite(n)||n<(zero?0:0.01)||n>99999999.99||Math.abs(n*100-Math.round(n*100))>0.000001)fail('Enter a valid amount with up to two decimal places.');return Math.round(n*100)/100}
const cents=(value:any)=>Math.round(Number(value||0)*100)
function date(value:any){const text=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(Date.parse(text+'T00:00:00Z'))||new Date(text+'T00:00:00Z').toISOString().slice(0,10)!==text)fail('Choose a valid date.');return text}
function text(value:any,max=500){const s=String(value||'').trim();if(s.length<5||s.length>max)fail('Enter a reference or reason of at least 5 characters.');return s}
function writable(event:any,session:any){if(!['Admin','Supervisor'].includes(session.userType)||event.context?.moduleCanEdit===false)fail('Only an Admin or Supervisor with edit access can change refundable deductions.',403)}
export async function listCashBonds(event:any){
 const session=requireSession(event);setHeader(event,'Cache-Control','private, no-store');const query=getQuery(event),employeeId=query.employeeId?id(query.employeeId):null,historyEmployeeId=query.historyEmployeeId?id(query.historyEmployeeId):employeeId
 const [[accounts],[entries]]=await Promise.all([
 pool.execute<any[]>(`SELECT a.*,e.EmployeeNumber,CONCAT_WS(', ',e.LastName,CONCAT_WS(' ',e.FirstName,e.MiddleName)) EmployeeName,ag.AgencyName,dt.DeductionName,c.ClassificationName,COALESCE(SUM(CASE WHEN l.EntryType='Collection' AND l.Status='Posted' THEN l.Amount ELSE 0 END),0) TotalCollected,COALESCE(SUM(CASE WHEN l.EntryType='Refund' AND l.Status='Posted' THEN l.Amount WHEN l.EntryType='RefundReversal' AND l.Status='Posted' THEN -l.Amount ELSE 0 END),0) TotalRefunded FROM cash_bond_account a INNER JOIN employee e ON e.EmployeeID=a.EmployeeID INNER JOIN agency ag ON ag.AgencyID=a.AgencyID INNER JOIN deduction_type dt ON dt.DeductionTypeID=a.DeductionTypeID INNER JOIN deduction_loan_classification c ON c.ClassificationID=dt.ClassificationID LEFT JOIN cash_bond_ledger l ON l.AccountID=a.AccountID ${employeeId?'WHERE a.EmployeeID=?':''} GROUP BY a.AccountID ORDER BY e.LastName,e.FirstName`,employeeId?[employeeId]:[]),
 historyEmployeeId?pool.execute<any[]>(`SELECT l.*,a.EmployeeID,a.AgencyID,ag.AgencyName,CONCAT_WS(' ',u.FirstName,u.LastName) ActorName,EXISTS(SELECT 1 FROM cash_bond_ledger r WHERE r.SourceRefundID=l.EntryID AND r.Status='Posted') IsReversed FROM cash_bond_ledger l INNER JOIN cash_bond_account a ON a.AccountID=l.AccountID INNER JOIN agency ag ON ag.AgencyID=a.AgencyID LEFT JOIN \`user\` u ON u.UserID=l.CreatedBy WHERE a.EmployeeID=? ORDER BY l.EntryID DESC LIMIT 500`,[historyEmployeeId]):Promise.resolve([[]])])
 return {accounts,entries,canEdit:['Admin','Supervisor'].includes(session.userType)&&event.context?.moduleCanEdit!==false}
}
export async function changeCashBondCutoff(event:any){
 const session=requireSession(event);writable(event,session)
 const body=await readBody(event)||{};if(!['set','reset'].includes(body.Action))fail('Choose set or reset for this cutoff.');const batchId=id(body.BatchID),employeeId=id(body.EmployeeID),typeId=id(body.DeductionTypeID),reset=body.Action==='reset',amount=reset?0:money(body.Amount,true),reason=reset?'Restore standard amount':text(body.Reason)
 const db=await pool.getConnection()
 try{await db.beginTransaction()
  const [[batch]]=await db.execute<any[]>(`SELECT BatchID,AgencyID,Status,DATE_FORMAT(PeriodStart,'%Y-%m-%d') PeriodStart,DATE_FORMAT(PeriodEnd,'%Y-%m-%d') PeriodEnd FROM attendance_dtr WHERE BatchID=? FOR UPDATE`,[batchId])
  if(!batch||!['Computed to Payroll','Computed to Both'].includes(batch.Status))fail('Compute this DTR to payroll before setting a cutoff amount.',409)
  const [[posted]]=await db.execute<any[]>("SELECT PayrollID FROM payroll_processing_posting WHERE BatchID=? AND Status='Active' LIMIT 1",[batchId]);if(posted)fail('Finalized payroll cannot be changed.',409)
  const preview=await payrollProcessingData(batch.PeriodStart,batch.PeriodEnd,db),person=preview.sites.find((s:any)=>Number(s.BatchID)===batchId)?.employees.find((p:any)=>Number(p.EmployeeID)===employeeId)
  const due=person?.dueDeductions.find((d:any)=>d.entryType==='CashBond'&&Number(d.accountTypeId)===typeId)
  if(!due||due.alreadyCollected)fail('Refundable deduction is unavailable on this employee fixed-site cutoff.',409)
  await db.execute(`UPDATE cash_bond_cutoff_override SET RemovedBy=?,RemovedAt=NOW() WHERE EmployeeID=? AND AgencyID=? AND DeductionTypeID=? AND PeriodStart=? AND PeriodEnd=? AND RemovedAt IS NULL`,[session.sub,employeeId,batch.AgencyID,typeId,batch.PeriodStart,batch.PeriodEnd])
  if(!reset)await db.execute('INSERT INTO cash_bond_cutoff_override(EmployeeID,AgencyID,DeductionTypeID,PeriodStart,PeriodEnd,Amount,Reason,CreatedBy) VALUES(?,?,?,?,?,?,?,?)',[employeeId,batch.AgencyID,typeId,batch.PeriodStart,batch.PeriodEnd,amount,reason,session.sub])
  await db.commit();return {success:true}
 }catch(error){await db.rollback();throw error}finally{db.release()}
}
export async function cashBondRefund(event:any){
 const session=requireSession(event);writable(event,session)
 const body=await readBody(event)||{},accountId=id(body.AccountID),reversal=body.Action==='reverse-refund',refundId=reversal?id(body.SourceRefundID):null,when=date(body.TransactionDate),reference=text(body.Reference,150),reason=text(body.Reason),key=String(body.RequestKey||'')
 if(!/^[a-zA-Z0-9-]{16,64}$/.test(key))fail('A unique request reference is required.')
 if(when>todayInPhilippines())fail('A refund cannot be recorded on a future date.')
 if(!['refund','reverse-refund'].includes(body.Action))fail('Choose refund or reverse-refund.');
 const amount=reversal?null:money(body.Amount),hash=createHash('sha256').update(JSON.stringify([accountId,reversal,refundId,when,reference,reason,amount])).digest('hex'),db=await pool.getConnection()
 try{await db.beginTransaction()
  const [[a]]=await db.execute<any[]>('SELECT * FROM cash_bond_account WHERE AccountID=? FOR UPDATE',[accountId]);if(!a)fail('Refundable deduction account not found.',404)
  const [[retry]]=await db.execute<any[]>('SELECT EntryID,RequestHash FROM cash_bond_ledger WHERE RequestKey=?',[key]);if(retry){if(retry.RequestHash!==hash)fail('This request reference was used for different details.',409);await db.commit();return {id:retry.EntryID,duplicate:true}}
  const [[latest]]=await db.execute<any[]>("SELECT TransactionDate FROM cash_bond_ledger WHERE AccountID=? AND Status='Posted' ORDER BY TransactionDate DESC,EntryID DESC LIMIT 1",[accountId]);if(latest&&when<dateOnly(latest.TransactionDate))fail('Use a date on or after the latest refundable deduction transaction.',409)
  let value=amount!
  if(reversal){const [[source]]=await db.execute<any[]>("SELECT Amount FROM cash_bond_ledger WHERE EntryID=? AND AccountID=? AND EntryType='Refund' AND Status='Posted' FOR UPDATE",[refundId,accountId]);if(!source)fail('Posted refund not found.',404);const [[existing]]=await db.execute<any[]>('SELECT EntryID FROM cash_bond_ledger WHERE SourceRefundID=?',[refundId]);if(existing)fail('This refund is already reversed.',409);value=Number(source.Amount)}
  const before=cents(a.Balance),after=before+(reversal?cents(value):-cents(value));if(after<0)fail('Refund exceeds the available refundable deduction balance.',409)
  if(Number(body.Revision)!==Number(a.Revision))fail('The refundable deduction balance changed. Reload this account before recording the refund.',409)
  const [entry]=await db.execute<any>(`INSERT INTO cash_bond_ledger(AccountID,SourceRefundID,EntryType,TransactionDate,Amount,BalanceBefore,BalanceAfter,Reference,Reason,RequestKey,RequestHash,CreatedBy) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[accountId,refundId,reversal?'RefundReversal':'Refund',when,value,before/100,after/100,reference,reason,key,hash,session.sub])
  await db.execute('UPDATE cash_bond_account SET Balance=?,Revision=Revision+1 WHERE AccountID=?',[after/100,accountId]);await db.commit();return {id:entry.insertId,balance:after/100}
 }catch(error:any){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('This refundable deduction request was already recorded. Reload the account.',409);throw error}finally{db.release()}
}
