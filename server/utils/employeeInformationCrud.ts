import { createError,getQuery,readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { requireEmployeeSession,portalMutation,portalNoStore } from './employeePortalAuth'
import { informationFields,correctionFields,informationRequestStatuses } from '../../shared/utils/employeeInformation'
const id=(value:unknown)=>{const result=Number(value);if(!Number.isSafeInteger(result)||result<1)throw createError({statusCode:400,statusMessage:'Choose a valid request or employee.'});return result}
const text=(value:unknown,max=2000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw createError({statusCode:400,statusMessage:'Enter a message or correction of 1-'+max+' characters.'});return value.trim()}
const iso=(column:string)=>`DATE_FORMAT(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,NOW(),UTC_TIMESTAMP()),${column}),'%Y-%m-%dT%H:%i:%s.000Z')`
function manage(event:any,session:any){if(!['Admin','Supervisor'].includes(session.userType)||event.context?.moduleCanEdit===false)throw createError({statusCode:403,statusMessage:'An authorized Admin or Supervisor must review employee information requests.'})}
export async function readOwnInformation(employeeId:number,db:Pick<typeof pool,'execute'>=pool){
 const [[row]]=await db.execute<any[]>(`SELECT e.FirstName,e.MiddleName,e.LastName,e.Nickname,DATE_FORMAT(e.Birthday,'%Y-%m-%d') AS Birthday,e.Gender,e.CivilStatus,e.Email,e.ContactNumber,e.Address,e.EmployeeNumber,e.Status,DATE_FORMAT(e.DateHired,'%Y-%m-%d') AS DateHired,
 e.PresentUnitHouseNumber,e.PresentStreet,e.PresentSubdivision,e.PresentBarangay,e.PresentCityMunicipality,e.PresentProvince,e.PresentRegion,e.PresentPostalCode,
 e.PermanentUnitHouseNumber,e.PermanentStreet,e.PermanentSubdivision,e.PermanentBarangay,e.PermanentCityMunicipality,e.PermanentProvince,e.PermanentRegion,e.PermanentPostalCode,
 e.EmergencyName,e.EmergencyRelationship,e.EmergencyContactNo,e.EmergencyAddress,a.AgencyName,p.PositionName
 FROM employee e LEFT JOIN agency_position ap ON ap.AgencyPositionID=e.AgencyPositionID LEFT JOIN agency a ON a.AgencyID=ap.AgencyID LEFT JOIN \`position\` p ON p.PositionID=ap.PositionID WHERE e.EmployeeID=?`,[employeeId])
 if(!row)throw createError({statusCode:404,statusMessage:'Employee information is unavailable.'})
 for(const prefix of ['Present','Permanent'])row[prefix+'Address']=['UnitHouseNumber','Street','Subdivision','Barangay','CityMunicipality','Province','Region','PostalCode'].map(key=>row[prefix+key]).filter(Boolean).join(', ')||(prefix==='Present'?row.Address:null)
 return informationFields.map(field=>({...field,value:row[field.key]==null?'':String(row[field.key])}))
}
async function requestList(where:string,params:any[],pageValue:unknown,db:Pick<typeof pool,'execute'>=pool){
 const [[count]]=await db.execute<any[]>('SELECT COUNT(*) AS Total FROM employee_information_request r JOIN employee e ON e.EmployeeID=r.EmployeeID '+where,params)
 const total=Number(count.Total),pages=Math.max(1,Math.ceil(total/20)),page=Math.max(1,Math.min(pages,Math.floor(Number(pageValue)||1)))
 const [items]=await db.execute<any[]>(`SELECT r.RequestID,r.EmployeeID,r.FieldKey,r.FieldLabel,r.RecordedValue,r.ProposedValue,r.Message,r.Status,r.Version,${iso('r.CreatedAt')} AS CreatedAt,${iso('r.UpdatedAt')} AS UpdatedAt,e.EmployeeNumber,CONCAT_WS(', ',e.LastName,CONCAT_WS(' ',e.FirstName,e.MiddleName)) AS EmployeeName,a.AgencyName
 FROM employee_information_request r JOIN employee e ON e.EmployeeID=r.EmployeeID LEFT JOIN agency_position ap ON ap.AgencyPositionID=e.AgencyPositionID LEFT JOIN agency a ON a.AgencyID=ap.AgencyID ${where} ORDER BY r.RequestID DESC LIMIT ? OFFSET ?`,[...params,20,(page-1)*20])
 if(items.length){const ids=items.map((item:any)=>item.RequestID);const [messages]=await db.execute<any[]>(`SELECT m.MessageID,m.RequestID,m.Sender,m.Message,m.Status,${iso('m.CreatedAt')} AS CreatedAt,CONCAT_WS(' ',u.FirstName,u.LastName) AS StaffName,u.UserType AS StaffRole,d.DepartmentName AS StaffDepartment FROM employee_information_message m LEFT JOIN \`user\` u ON u.UserID=m.ActorUserID LEFT JOIN department d ON d.DepartmentID=u.DepartmentID WHERE m.RequestID IN (${ids.map(()=>'?').join(',')}) ORDER BY m.MessageID`,ids);for(const item of items)item.messages=messages.filter((message:any)=>message.RequestID===item.RequestID)}
 return{items,pagination:{page,pages,total}}
}
export async function employeeInformation(event:any){
 const account=await requireEmployeeSession(event);portalNoStore(event)
 return{fields:await readOwnInformation(account.EmployeeID),requests:await requestList('WHERE r.EmployeeID=?',[account.EmployeeID],getQuery(event).page),requestFields:correctionFields}
}
export async function submitInformationRequest(event:any){
 const account=await requireEmployeeSession(event);portalMutation(event);const body=await readBody(event),action=body?.action||'create'
 if(!['create','message','cancel'].includes(action))throw createError({statusCode:400,statusMessage:'Choose a request action.'})
 const db=await pool.getConnection()
 try{
  await db.beginTransaction();await db.execute('SELECT EmployeeID FROM employee WHERE EmployeeID=? FOR UPDATE',[account.EmployeeID])
  const [[recent]]=await db.execute<any[]>("SELECT COUNT(*) AS Total FROM employee_information_message m JOIN employee_information_request r ON r.RequestID=m.RequestID WHERE r.EmployeeID=? AND m.Sender='Employee' AND m.CreatedAt>DATE_SUB(NOW(),INTERVAL 15 MINUTE)",[account.EmployeeID])
  if(Number(recent.Total)>=10)throw createError({statusCode:429,statusMessage:'Please wait before sending another request or message.'})
  let requestId:number
  if(action==='create'){
   const field=correctionFields.find(item=>item.key===body?.fieldKey);if(!field)throw createError({statusCode:400,statusMessage:'Select the information you want corrected.'})
   const proposed=text(body.proposedValue),message=text(body.message)
   const [[open]]=await db.execute<any[]>("SELECT COUNT(*) AS Total FROM employee_information_request WHERE EmployeeID=? AND Status IN ('Pending','In review')",[account.EmployeeID])
   if(Number(open.Total)>=5)throw createError({statusCode:409,statusMessage:'You already have five open requests. Follow up on an existing request.'})
   const fields=await readOwnInformation(account.EmployeeID,db),recorded=fields.find(item=>item.key===field.key)?.value||''
   const [created]=await db.execute<any>('INSERT INTO employee_information_request(EmployeeID,AccountID,FieldKey,FieldLabel,RecordedValue,ProposedValue,Message) VALUES(?,?,?,?,?,?,?)',[account.EmployeeID,account.AccountID,field.key,field.label,recorded,proposed,message]);requestId=created.insertId
   await db.execute("INSERT INTO employee_information_message(RequestID,Sender,Message,Status) VALUES(?,'Employee',?,'Pending')",[requestId,message])
  }else{
   requestId=id(body.requestId);const [[current]]=await db.execute<any[]>('SELECT Status,Version FROM employee_information_request WHERE RequestID=? AND EmployeeID=? FOR UPDATE',[requestId,account.EmployeeID])
   if(!current)throw createError({statusCode:404,statusMessage:'Request not found.'})
   if(current.Version!==id(body.version)||!['Pending','In review'].includes(current.Status))throw createError({statusCode:409,statusMessage:'This request changed or is already closed. Reload it before continuing.'})
   const status=action==='cancel'?'Cancelled':current.Status,message=action==='cancel'?'Employee cancelled this request.':text(body.message)
   await db.execute('UPDATE employee_information_request SET Status=?,Version=Version+1 WHERE RequestID=?',[status,requestId])
   await db.execute("INSERT INTO employee_information_message(RequestID,Sender,Message,Status) VALUES(?,'Employee',?,?)",[requestId,message,status])
  }
  await db.commit();return{success:true,requestId}
 }catch(error){await db.rollback();throw error}finally{db.release()}
}
export async function listInformationRequests(event:any){
 const session=requireSession(event);manage(event,session);portalNoStore(event);const query=getQuery(event),params:any[]=[],where=['1=1']
 if(query.employeeId!==undefined){where.push('r.EmployeeID=?');params.push(id(query.employeeId))}
 const status=String(query.status||'');if(status){if(!informationRequestStatuses.includes(status as any))throw createError({statusCode:400,statusMessage:'Choose a valid request status.'});where.push('r.Status=?');params.push(status)}
 const search=String(query.search||'').trim().slice(0,190);if(search){where.push("CONVERT(CONCAT_WS(' ',e.EmployeeNumber,e.FirstName,e.LastName,r.FieldLabel) USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE ?");params.push('%'+search+'%')}
 return requestList('WHERE '+where.join(' AND '),params,query.page)
}
export async function reviewInformationRequest(event:any){
 const session=requireSession(event);manage(event,session);portalNoStore(event);const body=await readBody(event),requestId=id(body?.requestId),message=text(body?.message)
 if(!['In review','Resolved','Declined'].includes(body?.status))throw createError({statusCode:400,statusMessage:'Choose In review, Resolved or Declined.'})
 const db=await pool.getConnection();try{
  await db.beginTransaction();const [[current]]=await db.execute<any[]>('SELECT Version,Status FROM employee_information_request WHERE RequestID=? FOR UPDATE',[requestId])
  if(!current)throw createError({statusCode:404,statusMessage:'Request not found.'})
  if(!['Pending','In review'].includes(current.Status))throw createError({statusCode:409,statusMessage:'This request is closed. Replies and status changes are no longer allowed.'})
  if(current.Version!==id(body.version))throw createError({statusCode:409,statusMessage:'This request changed. Reload before replying.'})
  await db.execute('UPDATE employee_information_request SET Status=?,Version=Version+1 WHERE RequestID=?',[body.status,requestId])
  await db.execute("INSERT INTO employee_information_message(RequestID,Sender,ActorUserID,Message,Status) VALUES(?,'Staff',?,?,?)",[requestId,session.sub,message,body.status])
  await db.commit();return{success:true}
 }catch(error){await db.rollback();throw error}finally{db.release()}
}
