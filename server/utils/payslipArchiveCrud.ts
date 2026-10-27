import { createError,getQuery,getRouterParam,readBody,setHeader,getRequestHeader } from 'h3'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { requireEmployeeSession,portalNoStore } from './employeePortalAuth'
export const archiveMaxBytes=5*1024*1024
const directory=()=>path.resolve(process.env.PAYSLIP_ARCHIVE_STORAGE_DIR||path.join(process.cwd(),'.data','payslip-archive'))
const id=(value:unknown)=>{const number=Number(value);if(!Number.isSafeInteger(number)||number<1)throw createError({statusCode:400,statusMessage:'Choose a valid employee or PDF record.'});return number}
const iso=(column:string)=>`DATE_FORMAT(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,NOW(),UTC_TIMESTAMP()),${column}),'%Y-%m-%dT%H:%i:%s.000Z')`
const columns=`ArchiveID,EmployeeID,SiteID,AgencyID,DATE_FORMAT(PeriodStart,'%Y-%m-%d') AS PeriodStart,DATE_FORMAT(PeriodEnd,'%Y-%m-%d') AS PeriodEnd,AgencyName,SiteLabel,Notes,FileName,FileSize,PageCount,Status,${iso('PostedAt')} AS PostedAt,${iso('CreatedAt')} AS CreatedAt`
function mayEdit(session:any,event:any){return session.userType!=='Viewer'&&event.context?.moduleCanEdit!==false}
function date(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw createError({statusCode:400,statusMessage:'Enter a valid payroll cutoff.'});return value}
function note(value:unknown,max:number){if(value==null||value==='')return null;if(typeof value!=='string'||value.length>max)throw createError({statusCode:400,statusMessage:'The PDF details are too long.'});return value.trim()||null}
export async function validateArchivedPdf(data:Buffer){
 if(!data.length||data.length>archiveMaxBytes||data.subarray(0,5).toString()!=='%PDF-')throw createError({statusCode:400,statusMessage:'Upload a PDF of 5 MB or less.'})
 try{const pdf=await PDFDocument.load(data,{updateMetadata:false});const pages=pdf.getPageCount();if(pdf.isEncrypted||pages<1||pages>30)throw Error();return pages}catch{throw createError({statusCode:400,statusMessage:'Use a readable, unencrypted payslip PDF with 1-30 pages.'})}
}
export async function listPayslipArchive(event:any){
 const session=requireSession(event);portalNoStore(event);const employeeId=id(getQuery(event).employeeId)
 const [items]=await pool.execute<any[]>(`SELECT ${columns} FROM payslip_archive WHERE EmployeeID=? AND Status<>'Removed' ORDER BY PeriodEnd DESC,ArchiveID DESC`,[employeeId])
 return{items,canManage:mayEdit(session,event)}
}
export async function employeePayslipArchive(event:any){
 const account=await requireEmployeeSession(event);portalNoStore(event)
 const [items]=await pool.execute<any[]>(`SELECT ${columns} FROM payslip_archive WHERE EmployeeID=? AND Status='Posted' ORDER BY PeriodEnd DESC,ArchiveID DESC`,[account.EmployeeID]);return{items,canManage:false}
}
export async function managePayslipArchive(event:any){
 const session=requireSession(event);if(!mayEdit(session,event))throw createError({statusCode:403,statusMessage:'Payslips edit access is required.'});portalNoStore(event)
 if(Number(getRequestHeader(event,'content-length')||0)>Math.ceil(archiveMaxBytes/3)*4+8192)throw createError({statusCode:413,statusMessage:'Upload a PDF of 5 MB or less.'})
 const body=await readBody(event),action=body?.action||'import'
 if(!['import','post','withdraw','remove','restore'].includes(action))throw createError({statusCode:400,statusMessage:'Choose a valid PDF action.'})
 let filePath:string|null=null,duplicateKey:any=null
 const db=await pool.getConnection()
 try{
  if(action==='import'){
   const employeeId=id(body.employeeId),start=date(body.periodStart),end=date(body.periodEnd)
   if(start>end||body.employeeOnly!==true)throw createError({statusCode:400,statusMessage:'Confirm that this PDF contains only the selected employee and cutoff.'})
   if(typeof body.pdfData!=='string'||body.pdfData.length>Math.ceil(archiveMaxBytes/3)*4+50)throw createError({statusCode:400,statusMessage:'Upload a PDF of 5 MB or less.'})
   const match=/^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.pdfData)
   if(!match)throw createError({statusCode:400,statusMessage:'Upload a PDF file.'})
   const data=Buffer.from(match[1]!,'base64');if(data.toString('base64')!==match[1])throw createError({statusCode:400,statusMessage:'Invalid PDF encoding.'})
   const pages=await validateArchivedPdf(data),hash=crypto.createHash('sha256').update(data).digest('hex');duplicateKey={employeeId,start,end,hash}
   const name=String(body.fileName||'Payslip.pdf').split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g,'').slice(0,255)
   const context=body.siteId!==undefined?await archiveSite(id(body.siteId),id(body.agencyId)):null
   const agency=context?.AgencyName||note(body.agencyName,200),site=context?.SiteName||note(body.siteLabel,255),notes=note(body.notes,1000)
   await db.beginTransaction();const [[employee]]=await db.execute<any[]>('SELECT EmployeeID FROM employee WHERE EmployeeID=? FOR UPDATE',[employeeId]);if(!employee)throw createError({statusCode:404,statusMessage:'Employee not found.'})
   const stored=crypto.randomBytes(16).toString('hex')+'.pdf';await fs.mkdir(directory(),{recursive:true,mode:0o700});filePath=path.join(directory(),stored);await fs.writeFile(filePath,data,{flag:'wx',mode:0o600})
   const [result]=await db.execute<any>(`INSERT INTO payslip_archive(EmployeeID,SiteID,AgencyID,PeriodStart,PeriodEnd,AgencyName,SiteLabel,Notes,FilePath,FileName,FileSHA256,FileSize,PageCount,UploadedBy) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[employeeId,context?.SiteID||null,context?.AgencyID||null,start,end,agency,site,notes,stored,name,hash,data.length,pages,session.sub])
   await db.execute("INSERT INTO payslip_archive_event(ArchiveID,Action,ActorUserID) VALUES(?,'Imported',?)",[result.insertId,session.sub]);await db.commit();filePath=null;return{success:true,archiveId:result.insertId}
  }
  const archiveId=id(body.archiveId),employeeId=id(body.employeeId)
  await db.beginTransaction();const [[record]]=await db.execute<any[]>('SELECT Status,FileSHA256,FilePath,FileSize FROM payslip_archive WHERE ArchiveID=? AND EmployeeID=? FOR UPDATE',[archiveId,employeeId]);if(!record)throw createError({statusCode:404,statusMessage:'Historical payslip not found.'})
  if(record.Status!==body.expectedStatus)throw createError({statusCode:409,statusMessage:'The PDF status changed. Reload before continuing.'})
  const transitions:Record<string,string>={post:'Posted',withdraw:'Withdrawn',remove:'Removed',restore:'Draft'},status=transitions[action]!
  if((action==='post'&&!['Draft','Withdrawn'].includes(record.Status))||(action==='withdraw'&&record.Status!=='Posted')||(action==='remove'&&!['Draft','Withdrawn'].includes(record.Status))||(action==='restore'&&record.Status!=='Removed'))throw createError({statusCode:409,statusMessage:'This PDF action is not available for the current status.'})
  if(action==='post')await readStoredPdf(record)
  await db.execute(`UPDATE payslip_archive SET Status=?,PostedAt=${action==='post'?'NOW()':'PostedAt'} WHERE ArchiveID=?`,[status,archiveId])
  await db.execute('INSERT INTO payslip_archive_event(ArchiveID,Action,ActorUserID) VALUES(?,?,?)',[archiveId,status,session.sub]);await db.commit();return{success:true,status}
 }catch(error:any){await db.rollback();if(filePath)await fs.unlink(filePath).catch(()=>{});if(error?.code==='ER_DUP_ENTRY'&&duplicateKey){const [[existing]]=await pool.execute<any[]>('SELECT ArchiveID,Status,SiteID,AgencyID FROM payslip_archive WHERE EmployeeID=? AND PeriodStart=? AND PeriodEnd=? AND FileSHA256=?',[duplicateKey.employeeId,duplicateKey.start,duplicateKey.end,duplicateKey.hash]);throw createError({statusCode:409,statusMessage:'This PDF already exists for this employee and cutoff. Use the existing record.',data:{code:'ARCHIVE_DUPLICATE',archiveId:existing?.ArchiveID,status:existing?.Status,siteId:existing?.SiteID,agencyId:existing?.AgencyID}})};throw error}finally{db.release()}
}
async function readStoredPdf(record:any){
 if(!/^[a-f0-9]{32}\.pdf$/.test(record.FilePath))throw createError({statusCode:404,statusMessage:'Payslip PDF not found.'})
 let data:Buffer;try{data=await fs.readFile(path.join(directory(),record.FilePath))}catch{throw createError({statusCode:404,statusMessage:'Payslip PDF is unavailable. Contact payroll.'})}
 if(data.length!==record.FileSize||crypto.createHash('sha256').update(data).digest('hex')!==record.FileSHA256)throw createError({statusCode:409,statusMessage:'PDF integrity check failed. Contact payroll.'})
 return data
}
async function pdfFile(event:any,employeeId?:number){
 portalNoStore(event);const archiveId=id(getRouterParam(event,'id'))
 const [[record]]=await pool.execute<any[]>(`SELECT FilePath,FileSHA256,FileSize,EmployeeID,DATE_FORMAT(PeriodStart,'%Y-%m-%d') AS PeriodStart,DATE_FORMAT(PeriodEnd,'%Y-%m-%d') AS PeriodEnd FROM payslip_archive WHERE ArchiveID=?`+(employeeId?' AND EmployeeID=? AND Status=\'Posted\'':' AND Status<>\'Removed\''),employeeId?[archiveId,employeeId]:[archiveId])
 if(!record||!/^[a-f0-9]{32}\.pdf$/.test(record.FilePath))throw createError({statusCode:404,statusMessage:'Payslip PDF not found.'})
 const data=await readStoredPdf(record)
 setHeader(event,'Content-Type','application/pdf');setHeader(event,'X-Content-Type-Options','nosniff');setHeader(event,'Content-Security-Policy',"sandbox; default-src 'none'")
 setHeader(event,'Content-Disposition',(getQuery(event).download==='1'?'attachment':'inline')+'; filename="Payslip-'+record.EmployeeID+'-'+String(record.PeriodStart).slice(0,10)+'-'+String(record.PeriodEnd).slice(0,10)+'.pdf"');return data
}
export async function staffArchivePdf(event:any){const session=requireSession(event);void session.sub;return pdfFile(event)}
export async function employeeArchivePdf(event:any){const account=await requireEmployeeSession(event);return pdfFile(event,account.EmployeeID)}

async function archiveSite(siteId:number,agencyId:number){
 const [[site]]=await pool.execute<any[]>(`SELECT s.SiteID,s.SiteName,a.AgencyID,a.AgencyName FROM site s JOIN site_agency sa ON sa.SiteID=s.SiteID JOIN agency a ON a.AgencyID=sa.AgencyID WHERE s.SiteID=? AND a.AgencyID=?`,[siteId,agencyId])
 if(!site)throw createError({statusCode:404,statusMessage:'The selected site and agency no longer exist together. Reload the site list.'})
 return site
}
