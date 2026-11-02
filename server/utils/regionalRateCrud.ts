import { createError, readBody, setHeader } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { todayInPhilippines } from './rateVersions'
import { regionalAmountKeys as keys, regionalAtDate, regionalAmounts, regionalOverrides, inferRegionalOverrides, rateDate } from '../../shared/utils/regionalRates'

const fail = (message: string, statusCode = 400): never => { throw createError({ statusCode, statusMessage: message }) }
function id(value: any, optional = false): number | null { if (optional && (value === '' || value == null)) return null; const n=Number(value); if(!Number.isSafeInteger(n)||n<=0)fail('Select a valid agency, region or rate.');return n }
function amount(value: any) { const n=Number(value);if(!['string','number'].includes(typeof value)||!Number.isFinite(n)||n<0||n>99999999.99||Math.abs(n*100-Math.round(n*100))>0.000001)fail('Rate amounts must be non-negative with up to two decimal places.');return n }
function date(value: any) { const d=rateDate(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)fail('Choose a valid effective date.');return d }
function reason(value: any) { const text=String(value||'').trim();if(text.length>500)fail('Reference must be 500 characters or fewer.');return text }
function overrides(value: any) { if(typeof value==='string'){try{value=JSON.parse(value)}catch{fail('Invalid custom amounts.')}}if(!value||typeof value!=='object'||Array.isArray(value))fail('Invalid custom amounts.');for(const key of Object.keys(value))if(!keys.includes(key as any))fail('Unknown custom rate field.');return Object.fromEntries(Object.entries(value).map(([key,value])=>[key,amount(value)])) }
function writable(event: any, session: any) { if(session.userType==='Viewer'||event.context?.moduleCanEdit===false)fail('You do not have permission to change rates.',403) }
function revision(parent: any, value: any) { if(value!=null&&Number(value)!==Number(parent.Revision))fail('The region rate changed. Close this form and reload before saving.',409) }
async function parentData(db: any, parentId: number, lock = false) {
  const [[base]]=await db.execute('SELECT * FROM payroll_region_rate WHERE RegionRateID = ?'+(lock?' FOR UPDATE':''),[parentId]);if(!base)fail('Region rate not found.',404)
  const [versions]=await db.execute('SELECT * FROM payroll_region_rate_version WHERE RegionRateID = ? ORDER BY EffectiveDate, RegionRateVersionID',[parentId]);return {...base,Versions:versions}
}
async function updateAmounts(db: any, table: 'payroll_rate'|'payroll_rate_version', idKey: 'PayrollRateID'|'PayrollRateVersionID', rowId: number, amounts: any) { await db.execute(`UPDATE ${table} SET ${keys.map(key=>key+' = ?').join(', ')} WHERE ${idKey} = ?`,[...keys.map(key=>amounts[key]),rowId]) }

// Materialize parent boundaries into existing position histories so all existing
// work-date pricing queries retain their IDs and date-based rate selection.
export async function syncRegionalPositions(db: any, parentId: number) {
  const parent=await parentData(db,parentId,true)
  const [children]=await db.execute('SELECT * FROM payroll_rate WHERE RegionRateID = ? ORDER BY PayrollRateID FOR UPDATE',[parentId])
  for(const child of children){
    const [versions]=await db.execute('SELECT * FROM payroll_rate_version WHERE PayrollRateID = ? ORDER BY EffectiveDate, PayrollRateVersionID FOR UPDATE',[child.PayrollRateID])
    const authored=[child,...versions.filter((v:any)=>!v.IsRegionalVersion)].sort((a:any,b:any)=>rateDate(a.EffectiveDate).localeCompare(rateDate(b.EffectiveDate)))
    const dates=[...new Set<string>([child,...versions,parent,...parent.Versions].map(row=>rateDate(row.EffectiveDate)).filter(d=>d>=rateDate(child.EffectiveDate)&&d>=rateDate(parent.EffectiveDate)))].sort()
    for(const boundary of dates){
      const source=[...authored].reverse().find((row:any)=>rateDate(row.EffectiveDate)<=boundary)||child
      const custom=regionalOverrides(source.RegionOverridesJson), base=regionalAtDate(parent,parent.Versions,boundary)
      if(!base)continue
      const values=regionalAmounts(base,custom)
      if(boundary===rateDate(child.EffectiveDate))await updateAmounts(db,'payroll_rate','PayrollRateID',child.PayrollRateID,values)
      else { const existing=versions.find((v:any)=>rateDate(v.EffectiveDate)===boundary)
        if(existing){await updateAmounts(db,'payroll_rate_version','PayrollRateVersionID',existing.PayrollRateVersionID,values);if(existing.IsRegionalVersion)await db.execute('UPDATE payroll_rate_version SET RegionOverridesJson = ? WHERE PayrollRateVersionID = ?',[JSON.stringify(custom),existing.PayrollRateVersionID])}
        else await db.execute(`INSERT INTO payroll_rate_version (PayrollRateID, EffectiveDate, ${keys.join(', ')}, Reason, RegionOverridesJson, IsRegionalVersion) VALUES (${Array(keys.length+5).fill('?').join(', ')})`,[child.PayrollRateID,boundary,...keys.map(key=>values[key]),'Regional rate update',JSON.stringify(custom),1])
      }
    }
  }
}

export async function listRegionalRates(event: any) {
  const session=requireSession(event);void session.sub
  setHeader(event,'Cache-Control','private, no-store')
  const [[items],[versions],[agencies]]=await Promise.all([
    pool.execute<any[]>(`SELECT r.*, a.AgencyName, rg.RegionCode, rg.RegionName FROM payroll_region_rate r INNER JOIN agency a ON a.AgencyID = r.AgencyID LEFT JOIN region rg ON rg.RegionID = r.RegionID ORDER BY a.AgencyName, rg.RegionName`),
    pool.execute<any[]>('SELECT * FROM payroll_region_rate_version ORDER BY EffectiveDate, RegionRateVersionID'),
    pool.execute<any[]>("SELECT AgencyID, AgencyName FROM agency WHERE Status = 'Active' ORDER BY AgencyName")
  ])
  const today=todayInPhilippines()
  return {agencies,items:items.map(item=>{const history=versions.filter(v=>v.RegionRateID===item.RegionRateID);return {...item,Versions:history,CurrentRate:regionalAtDate(item,history,today),NextEffectiveDate:[item,...history].map(v=>rateDate(v.EffectiveDate)).filter(d=>d>today).sort()[0]||null}})}
}
export async function createRegionalRate(event: any) {
  const session=requireSession(event);writable(event,session)
  const body=await readBody(event)||{},agencyId=id(body.AgencyID),regionId=id(body.RegionID,true),sourceId=id(body.SourcePayrollRateID,true)
  const db=await pool.getConnection()
  try {await db.beginTransaction()
    const [[agency]]=await db.execute<any[]>("SELECT AgencyID FROM agency WHERE AgencyID = ? AND Status = 'Active' FOR UPDATE",[agencyId]);if(!agency)fail('Select an active agency.')
    if(regionId){const [[region]]=await db.execute<any[]>("SELECT RegionID FROM region WHERE RegionID = ? AND Status = 'Active'",[regionId]);if(!region)fail('Select an active region.')}
    const [[exists]]=await db.execute<any[]>('SELECT RegionRateID FROM payroll_region_rate WHERE AgencyID = ? AND RegionID <=> ? FOR UPDATE',[agencyId,regionId]);if(exists)fail('This agency already has a rate for this region.',409)
    let base:any=body,history:any[]=[]
    if(sourceId){const [[source]]=await db.execute<any[]>(`SELECT r.* FROM payroll_rate r INNER JOIN agency_position ap ON ap.AgencyPositionID = r.AgencyPositionID WHERE r.PayrollRateID = ? AND ap.AgencyID = ? AND r.RegionID <=> ? AND r.Status = 'Active' FOR UPDATE`,[sourceId,agencyId,regionId]);if(!source)fail('Select an active position rate in this agency and region.');base=source;[history]=await db.execute<any[]>('SELECT * FROM payroll_rate_version WHERE PayrollRateID = ? ORDER BY EffectiveDate',[sourceId])}
    const start=date(base.EffectiveDate),reference=reason(body.Reason)
    const [created]=await db.execute<any>(`INSERT INTO payroll_region_rate (AgencyID, RegionID, EffectiveDate, ${keys.join(', ')}, Reason, CreatedBy, UpdatedBy) VALUES (${Array(keys.length+6).fill('?').join(', ')})`,[agencyId,regionId,start,...keys.map(key=>amount(base[key]??0)),reference,session.sub,session.sub])
    const parentId=created.insertId
    for(const v of history)await db.execute(`INSERT INTO payroll_region_rate_version (RegionRateID, EffectiveDate, ${keys.join(', ')}, Reason, CreatedBy) VALUES (${Array(keys.length+4).fill('?').join(', ')})`,[parentId,date(v.EffectiveDate),...keys.map(key=>amount(v[key]??0)),reason(v.Reason),session.sub])
    const parent=await parentData(db,parentId)
    const [children]=await db.execute<any[]>('SELECT r.* FROM payroll_rate r INNER JOIN agency_position ap ON ap.AgencyPositionID = r.AgencyPositionID WHERE ap.AgencyID = ? AND r.RegionID <=> ? ORDER BY r.PayrollRateID FOR UPDATE',[agencyId,regionId])
    for(const child of children){
      const applicable=regionalAtDate(parent,parent.Versions,rateDate(child.EffectiveDate)||rateDate(parent.EffectiveDate))
      if(!applicable)fail('The region starting date must cover existing position history. Choose the standard position as the starting rate.')
      await db.execute('UPDATE payroll_rate SET RegionRateID = ?, RegionOverridesJson = ? WHERE PayrollRateID = ?',[parentId,JSON.stringify(inferRegionalOverrides(child,applicable)),child.PayrollRateID])
      const [childVersions]=await db.execute<any[]>('SELECT * FROM payroll_rate_version WHERE PayrollRateID = ? ORDER BY EffectiveDate',[child.PayrollRateID])
      for(const v of childVersions){const custom=inferRegionalOverrides(v,regionalAtDate(parent,parent.Versions,rateDate(v.EffectiveDate)));await db.execute('UPDATE payroll_rate_version SET RegionOverridesJson = ?, IsRegionalVersion = ? WHERE PayrollRateVersionID = ?',[JSON.stringify(custom),Object.keys(custom).length?0:1,v.PayrollRateVersionID])}
    }
    await syncRegionalPositions(db,parentId);await db.commit();return {id:parentId,linkedPositions:children.length}
  }catch(error:any){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('This agency and region already have a rate.',409);throw error}finally{db.release()}
}
export async function updateRegionalRate(event: any) {
  const session=requireSession(event);writable(event,session)
  const body=await readBody(event)||{},parentId=id(body.id)!,db=await pool.getConnection()
  try{await db.beginTransaction();const parent=await parentData(db,parentId,true);revision(parent,body.Revision);if(parent.Status!=='Active')fail('Only active region rates can be changed.',409)
    const current=regionalAtDate(parent,parent.Versions,todayInPhilippines()),isVersion=body.mode==='version'
    if(!isVersion&&body.mode!=='current')fail('Choose a current edit or dated update.')
    if(!isVersion&&!current)fail('This region rate is not effective yet.',409)
    const previous=isVersion?(parent.Versions.at(-1)||parent):current
    const effective=isVersion?date(body.EffectiveDate):rateDate(previous.EffectiveDate)
    if(isVersion&&effective<=rateDate(previous.EffectiveDate))fail('Choose an effective date after the latest region update.',409)
    const values=keys.map(key=>amount(body[key]??previous[key]??0)),reference=reason(body.Reason??previous.Reason)
    if(isVersion)await db.execute(`INSERT INTO payroll_region_rate_version (RegionRateID, EffectiveDate, ${keys.join(', ')}, Reason, CreatedBy) VALUES (${Array(keys.length+4).fill('?').join(', ')})`,[parentId,effective,...values,reference,session.sub])
    else if(current.RegionRateVersionID)await db.execute(`UPDATE payroll_region_rate_version SET ${keys.map(key=>key+' = ?').join(', ')}, Reason = ? WHERE RegionRateVersionID = ?`,[...values,reference,current.RegionRateVersionID])
    else await db.execute(`UPDATE payroll_region_rate SET ${keys.map(key=>key+' = ?').join(', ')}, Reason = ? WHERE RegionRateID = ?`,[...values,reference,parentId])
    await db.execute('UPDATE payroll_region_rate SET Revision = Revision + 1, UpdatedBy = ? WHERE RegionRateID = ?',[session.sub,parentId])
    await syncRegionalPositions(db,parentId);await db.commit();return {success:true,effectiveDate:effective}
  }catch(error){await db.rollback();throw error}finally{db.release()}
}

export async function insertRegionalPosition(db: any, body: any) {
  const positionId=id(body.AgencyPositionID),regionId=id(body.RegionID,true)
  const [[ap]]=await db.execute('SELECT AgencyID FROM agency_position WHERE AgencyPositionID = ?',[positionId]);if(!ap)fail('Position not found.')
  await db.execute('SELECT AgencyID FROM agency WHERE AgencyID = ? FOR UPDATE',[ap.AgencyID])
  const [[match]]=await db.execute('SELECT RegionRateID FROM payroll_region_rate WHERE AgencyID = ? AND RegionID <=> ? FOR UPDATE',[ap.AgencyID,regionId])
  if(!match){if(body.RegionRateID)fail('Region rate does not match this position.');return null}
  if(body.RegionRateID&&Number(body.RegionRateID)!==Number(match.RegionRateID))fail('Region rate does not match this position.')
  const parent=await parentData(db,match.RegionRateID,true);revision(parent,body.RegionalRevision);if(parent.Status!=='Active')fail('Region rate is inactive.',409)
  const [[active]]=await db.execute(`SELECT ap.AgencyPositionID FROM agency_position ap INNER JOIN agency a ON a.AgencyID = ap.AgencyID INNER JOIN \`position\` p ON p.PositionID = ap.PositionID WHERE ap.AgencyPositionID = ? AND ap.Status = 'Active' AND a.Status = 'Active' AND p.Status = 'Active'`,[positionId]);if(!active)fail('Choose an active agency position.')
  const current=regionalAtDate(parent,parent.Versions,todayInPhilippines())||parent,start=date(body.EffectiveDate||current.EffectiveDate),base=regionalAtDate(parent,parent.Versions,start);if(!base)fail('Position cannot start before the region rate.')
  const custom=Object.hasOwn(body,'RegionOverrides')?overrides(body.RegionOverrides):inferRegionalOverrides(body,base),values=regionalAmounts(base,custom)
  if(body.Status&& !['Active','Inactive'].includes(body.Status))fail('Invalid status.')
  const [result]=await db.execute(`INSERT INTO payroll_rate (AgencyPositionID, RegionID, EffectiveDate, ${keys.join(', ')}, Status, RegionRateID, RegionOverridesJson) VALUES (${Array(keys.length+6).fill('?').join(', ')})`,[positionId,regionId,start,...keys.map(key=>values[key]),body.Status||'Active',parent.RegionRateID,JSON.stringify(custom)])
  await syncRegionalPositions(db,parent.RegionRateID);return result.insertId
}
export async function changeRegionalPosition(db: any, body: any, mode: 'current'|'version') {
  const rateId=id(body.id)
  const [[link]]=await db.execute('SELECT RegionRateID FROM payroll_rate WHERE PayrollRateID = ?',[rateId]);if(!link?.RegionRateID)return null
  const parent=await parentData(db,link.RegionRateID,true);revision(parent,body.RegionalRevision)
  const [[child]]=await db.execute('SELECT * FROM payroll_rate WHERE PayrollRateID = ? FOR UPDATE',[rateId]);if(child.Status!=='Active')fail('Only active rates can be changed.',409)
  const [versions]=await db.execute('SELECT * FROM payroll_rate_version WHERE PayrollRateID = ? ORDER BY EffectiveDate FOR UPDATE',[rateId])
  const current=regionalAtDate(child,versions,todayInPhilippines()),authored=[child,...versions.filter((v:any)=>!v.IsRegionalVersion)]
  if(mode==='current'&&!current)fail('This position rate is not effective yet.',409)
  const effective=mode==='version'?date(body.EffectiveDate):rateDate(current.EffectiveDate)
  if(mode==='version'&&effective<=rateDate(authored.at(-1).EffectiveDate))fail('Choose a date after the latest position update.',409)
  const base=regionalAtDate(parent,parent.Versions,effective);if(!base)fail('Position cannot start before the region rate.')
  const existing=versions.find((v:any)=>rateDate(v.EffectiveDate)===effective)
  const prior=regionalAtDate(child,versions,effective)||child
  const custom=Object.hasOwn(body,'RegionOverrides')?overrides(body.RegionOverrides):{...regionalOverrides(prior.RegionOverridesJson),...Object.fromEntries(keys.filter(key=>Object.hasOwn(body,key)&&Number(body[key])!==Number(prior[key])).map(key=>[key,amount(body[key])]))}
  const values=regionalAmounts(base,custom)
  if(effective===rateDate(child.EffectiveDate)){await updateAmounts(db,'payroll_rate','PayrollRateID',rateId!,values);await db.execute('UPDATE payroll_rate SET RegionOverridesJson = ? WHERE PayrollRateID = ?',[JSON.stringify(custom),rateId])}
  else if(existing){await updateAmounts(db,'payroll_rate_version','PayrollRateVersionID',existing.PayrollRateVersionID,values);await db.execute('UPDATE payroll_rate_version SET RegionOverridesJson = ?, IsRegionalVersion = 0, Reason = ? WHERE PayrollRateVersionID = ?',[JSON.stringify(custom),reason(body.Reason??existing.Reason),existing.PayrollRateVersionID])}
  else await db.execute(`INSERT INTO payroll_rate_version (PayrollRateID, EffectiveDate, ${keys.join(', ')}, RegionOverridesJson, IsRegionalVersion, Reason) VALUES (${Array(keys.length+5).fill('?').join(', ')})`,[rateId,effective,...keys.map(key=>values[key]),JSON.stringify(custom),0,reason(body.Reason)])
  await syncRegionalPositions(db,parent.RegionRateID);return {success:true,effectiveDate:effective}
}
