import { createError } from 'h3'
import { dateOnly } from './rateVersions'
const fail=(message:string,code=400):never=>{throw createError({statusCode:code,statusMessage:message})}
const id=(value:any)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)fail('Select a valid record.');return n}
const money=(value:any,zero=false)=>{const n=Number(value);if(!['number','string'].includes(typeof value)||!Number.isFinite(n)||n<(zero?0:0.01)||n>99999999.99||Math.abs(n*100-Math.round(n*100))>0.000001)fail('Enter a valid amount with up to two decimal places.');return Math.round(n*100)/100}
const cents=(value:any)=>Math.round(Number(value||0)*100)
export async function cashBondPreviewData(db:any,scope?:{employeeIds:number[];agencyIds:number[];start:string;end:string}){
 if(scope&&(!scope.employeeIds.length||!scope.agencyIds.length))return {plans:[],overrides:[],posted:[]}
 const agencyMarks=scope?.agencyIds.map(()=>'?').join(','),employeeMarks=scope?.employeeIds.map(()=>'?').join(',')
 const [[overrides],[posted]]=await Promise.all([
  db.execute(`SELECT * FROM cash_bond_cutoff_override WHERE RemovedAt IS NULL ${scope?`AND EmployeeID IN (${employeeMarks}) AND AgencyID IN (${agencyMarks}) AND PeriodStart=? AND PeriodEnd=?`:''}`,scope?[...scope.employeeIds,...scope.agencyIds,scope.start,scope.end]:[]),
  db.execute(`SELECT a.EmployeeID,a.AgencyID,a.DeductionTypeID,l.PeriodStart,l.PeriodEnd,l.PayrollID FROM cash_bond_ledger l INNER JOIN cash_bond_account a ON a.AccountID=l.AccountID WHERE l.EntryType='Collection' AND l.Status='Posted' ${scope?`AND a.EmployeeID IN (${employeeMarks}) AND a.AgencyID IN (${agencyMarks}) AND l.PeriodStart=? AND l.PeriodEnd=?`:''}`,scope?[...scope.employeeIds,...scope.agencyIds,scope.start,scope.end]:[])
 ])
 return {overrides,posted}
}
export function cashBondDue(data:any,person:any,batch:any,item:any){
 const start=dateOnly(batch.PeriodStart),end=dateOnly(batch.PeriodEnd),typeId=Number(item.accountTypeId)
 const override=data.overrides.find((p:any)=>Number(p.EmployeeID)===Number(person.EmployeeID)&&Number(p.AgencyID)===Number(batch.AgencyID)&&Number(p.DeductionTypeID)===typeId&&dateOnly(p.PeriodStart)===start&&dateOnly(p.PeriodEnd)===end)
 const collected=data.posted.some((p:any)=>Number(p.EmployeeID)===Number(person.EmployeeID)&&Number(p.AgencyID)===Number(batch.AgencyID)&&Number(p.DeductionTypeID)===typeId&&dateOnly(p.PeriodStart)===start&&dateOnly(p.PeriodEnd)===end)
 return {...item,entryType:'CashBond',standardAmount:item.amount,amount:collected?0:override?Number(override.Amount):item.amount,
 cashBondOverride:override?{id:override.OverrideID,amount:Number(override.Amount),reason:override.Reason}:null,alreadyCollected:collected}
}
async function account(db:any,employeeId:number,agencyId:number,typeId:number){
 await db.execute('INSERT INTO cash_bond_account(EmployeeID,AgencyID,DeductionTypeID) VALUES(?,?,?) ON DUPLICATE KEY UPDATE AccountID=AccountID',[employeeId,agencyId,typeId])
 const [[row]]=await db.execute('SELECT * FROM cash_bond_account WHERE EmployeeID=? AND AgencyID=? AND DeductionTypeID=? FOR UPDATE',[employeeId,agencyId,typeId]);return row
}
export async function postCashBondCollection(db:any,input:any){
 const a=await account(db,id(input.employeeId),id(input.agencyId),id(input.typeId)),amount=money(input.amount),payrollId=id(input.payrollId)
 const [[py]]=await db.execute(`SELECT EmployeeID,Status,StartDate,EndDate FROM payroll WHERE PayrollID=? FOR UPDATE`,[payrollId])
 if(!py||Number(py.EmployeeID)!==Number(a.EmployeeID)||py.Status!=='Approved'||dateOnly(py.StartDate)!==input.start||dateOnly(py.EndDate)!==input.end)fail('Refundable collection must match the finalized employee payroll.',409)
 const before=cents(a.Balance),after=before+cents(amount)
 await db.execute(`INSERT INTO cash_bond_ledger(AccountID,PayrollID,EntryType,TransactionDate,PeriodStart,PeriodEnd,Amount,BalanceBefore,BalanceAfter,Reference,Reason,CreatedBy) VALUES(?,?,'Collection',?,?,?,?,?,?,?,?,?)`,[a.AccountID,payrollId,input.end,input.start,input.end,amount,before/100,after/100,'Payroll #'+payrollId,String(input.reason||'Scheduled refundable deduction').slice(0,500),input.actorId])
 await db.execute('UPDATE cash_bond_account SET Balance=?,Revision=Revision+1 WHERE AccountID=?',[after/100,a.AccountID])
}
export async function voidCashBondCollection(db:any,payrollId:number,actorId:number){
 const [links]=await db.execute("SELECT AccountID FROM cash_bond_ledger WHERE PayrollID=? AND EntryType='Collection' AND Status='Posted' ORDER BY AccountID",[payrollId]);
 for(const link of links){
 const [[a]]=await db.execute('SELECT * FROM cash_bond_account WHERE AccountID=? FOR UPDATE',[link.AccountID])
 const [[row]]=await db.execute("SELECT * FROM cash_bond_ledger WHERE PayrollID=? AND AccountID=? AND EntryType='Collection' AND Status='Posted' FOR UPDATE",[payrollId,link.AccountID])
 if(!row||row.Status!=='Posted')fail('The refundable deduction collection has already changed.',409)
 const [[later]]=await db.execute(`SELECT l.EntryID FROM cash_bond_ledger l WHERE l.AccountID=? AND l.EntryID>? AND l.Status='Posted' AND (l.EntryType='Collection' OR (l.EntryType='Refund' AND NOT EXISTS(SELECT 1 FROM cash_bond_ledger reversal WHERE reversal.SourceRefundID=l.EntryID AND reversal.Status='Posted'))) LIMIT 1`,[a.AccountID,row.EntryID])
 if(later||cents(a.Balance)!==cents(row.BalanceAfter))fail('Later refundable deduction collections or refunds exist. Reverse later transactions before cancelling this payroll.',409)
 await db.execute("UPDATE cash_bond_ledger SET Status='Voided',VoidedBy=?,VoidedAt=NOW() WHERE EntryID=?",[actorId,row.EntryID])
 await db.execute('UPDATE cash_bond_account SET Balance=?,Revision=Revision+1 WHERE AccountID=?',[(cents(a.Balance)-cents(row.Amount))/100,a.AccountID])
}
}
