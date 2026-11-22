import {createHash} from 'node:crypto'

function canonical(value:any):any{
  if(value instanceof Date)return value.toJSON()
  if(Array.isArray(value))return value.map(canonical)
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])]))
  return value
}
/** Bind queued approval to the exact employee/financial preview the user saw. */
export function payrollReviewHash(site:any){
  return createHash('sha256').update(JSON.stringify(canonical({
    batchId:Number(site.BatchID),agencyId:site.AgencyID,clientId:site.ClientID,siteId:site.SiteID,
    start:site.PeriodStart,end:site.PeriodEnd,status:site.Status,
    employees:[...(site.employees||[])].sort((a,b)=>Number(a.EmployeeID)-Number(b.EmployeeID)),
    siteWarnings:site.siteWarnings||[],gross:site.gross,deductions:site.deductions,net:site.netPreview,
  }))).digest('hex')
}
