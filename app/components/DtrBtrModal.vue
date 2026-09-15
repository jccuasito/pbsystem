<script setup lang="ts">
import { btrAttendanceWarning, btrDate, resolveBtrEmployee, summarizeBtr } from '../../shared/utils/dtrBtr'
import type { BtrAttendanceDay, BtrEmployee, BtrEntry } from '../../shared/utils/dtrBtr'
import { btrSheetHeaders, parseBtrSheet } from '../../shared/utils/dtrBtrSheet'
import type { BtrSheetRow } from '../../shared/utils/dtrBtrSheet'

type Dtr={BatchID:number;AgencyName:string;ClientName:string;SiteName:string;PeriodStart:string;PeriodEnd:string}
type Response={batch:{Status:string;PeriodStart:string;PeriodEnd:string};employees:BtrEmployee[];relievers:BtrEmployee[];attendance:BtrAttendanceDay[];entries:BtrEntry[]}
type Draft=BtrSheetRow&{key:number}
const props=defineProps<{dtr:Dtr}>(),emit=defineEmits<{close:[];changed:[]}>()
const dialog=ref<HTMLDialogElement|null>(null),fileInput=ref<HTMLInputElement|null>(null)
const loading=ref(true),saving=ref(false),reading=ref(false),error=ref(''),notice=ref(''),data=ref<Response|null>(null)
let nextKey=1
const drafts=ref<Draft[]>([]),search=ref('')
const editable=computed(()=>data.value?.batch.Status==='Draft')
const start=computed(()=>btrDate(data.value?.batch.PeriodStart||props.dtr.PeriodStart)),end=computed(()=>btrDate(data.value?.batch.PeriodEnd||props.dtr.PeriodEnd))
const entries=computed(()=>data.value?.entries||[]),totals=computed(()=>summarizeBtr(entries.value))
const employees=computed(()=>data.value?.employees||[]),relievers=computed(()=>data.value?.relievers||[])
const visibleEntries=computed(()=>entries.value.filter(row=>(row.RelieverEmployeeName+' '+row.ReplacedEmployeeName+' '+row.AttendanceDate).toLowerCase().includes(search.value.toLowerCase().trim())))
const canonicalId=(id:number)=>'EMP-'+String(id).padStart(4,'0')
const hours=(value:number|string)=>Number(value||0).toFixed(2)
const dateLabel=(date:string)=>new Date(date+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})
const resolve=(row:Draft,role:'btr'|'rest')=>resolveBtrEmployee(role==='btr'?row.RelieverEmployeeID:row.ReplacedEmployeeID,role==='btr'?relievers.value:employees.value)
const gridSearch=ref(''),cellDialog=ref<HTMLDialogElement|null>(null)
const selectedCell=ref<{employee:BtrEmployee;date:string}|null>(null)
const cellReliever=ref(''),cellHours=ref<number|string>(1),cellError=ref('')
const cutoffDays=computed(()=>{
  const days:string[]=[],date=new Date(start.value+'T00:00:00')
  while(Number.isFinite(date.getTime())&&btrDate(date)<=end.value&&days.length<366){days.push(btrDate(date));date.setDate(date.getDate()+1)}
  return days
})
type GridEntry={key:string;employeeId:number;date:string;name:string;hours:number|string;draft?:Draft;saved?:BtrEntry}
const gridEntries=computed<GridEntry[]>(()=>{
  const rows:GridEntry[]=entries.value.map(saved=>({key:'saved-'+saved.BTRID,employeeId:Number(saved.ReplacedEmployeeID),date:saved.AttendanceDate,name:saved.RelieverEmployeeName,hours:saved.Hours,saved}))
  for(const draft of drafts.value){
    const rest=resolve(draft,'rest'),btr=resolve(draft,'btr')
    if(!rest||!btr)continue
    const item:GridEntry={key:draft.BTRID?'saved-'+draft.BTRID:'draft-'+draft.key,employeeId:Number(rest.EmployeeID),date:draft.AttendanceDate,name:btr.EmployeeName,hours:draft.Hours,draft,saved:entries.value.find(row=>row.BTRID===draft.BTRID)}
    const index=draft.BTRID?rows.findIndex(row=>row.saved?.BTRID===draft.BTRID):-1
    if(index>=0)rows[index]=item;else rows.push(item)
  }
  return rows
})
const gridPeople=computed(()=>{
  const people=new Map(employees.value.map(employee=>[Number(employee.EmployeeID),employee]))
  for(const entry of entries.value)if(!people.has(Number(entry.ReplacedEmployeeID)))people.set(Number(entry.ReplacedEmployeeID),{EmployeeID:Number(entry.ReplacedEmployeeID),EmployeeName:entry.ReplacedEmployeeName,EmployeeNumber:entry.ReplacedEmployeeNumber||null})
  const query=gridSearch.value.trim().toLowerCase()
  return [...people.values()].filter(employee=>(employee.EmployeeName+' '+canonicalId(employee.EmployeeID)+' '+(employee.EmployeeNumber||'')).toLowerCase().includes(query))
})
const gridCells=computed(()=>{
  const cells=new Map<string,{rows:GridEntry[];units:number;pending:boolean}>()
  for(const row of gridEntries.value){
    const key=row.employeeId+':'+row.date,cell=cells.get(key)||{rows:[],units:0,pending:false}
    cell.rows.push(row);cell.units+=Number.isFinite(Number(row.hours))?Math.round(Number(row.hours)*100):0;cell.pending ||= !!row.draft;cells.set(key,cell)
  }
  return cells
})
const gridCell=(employeeId:number,date:string)=>gridCells.value.get(employeeId+':'+date)
const personTotal=(employeeId:number)=>cutoffDays.value.reduce((sum,date)=>sum+(gridCell(employeeId,date)?.units||0),0)/100
const dateTotal=(date:string)=>gridPeople.value.reduce((sum,employee)=>sum+(gridCell(employee.EmployeeID,date)?.units||0),0)/100
const gridTotal=computed(()=>gridPeople.value.reduce((sum,employee)=>sum+Math.round(personTotal(employee.EmployeeID)*100),0)/100)
// Use the same saved-plus-pending rows as the REST grid, grouped by the reliever.
const relieverRoster=computed(()=>{
  type Day={date:string;units:number;pending:boolean}
  type Coverage={employee:BtrEmployee;units:number;days:Map<string,Day>}
  type Reliever={employee:BtrEmployee;units:number;pending:boolean;coverage:Map<number,Coverage>}
  const people=new Map<number,Reliever>(),dates=new Set(cutoffDays.value)
  for(const row of gridEntries.value){
    if(!dates.has(row.date))continue
    const id=Number(row.draft?resolve(row.draft,'btr')?.EmployeeID:row.saved?.RelieverEmployeeID)
    if(!id)continue
    const employee=relievers.value.find(item=>Number(item.EmployeeID)===id)||{EmployeeID:id,EmployeeName:row.name,EmployeeNumber:row.saved?.RelieverEmployeeNumber||null}
    const reliever=people.get(id)||{employee,units:0,pending:false,coverage:new Map<number,Coverage>()}
    const rest=employees.value.find(item=>Number(item.EmployeeID)===row.employeeId)||{EmployeeID:row.employeeId,EmployeeName:row.saved?.ReplacedEmployeeName||canonicalId(row.employeeId),EmployeeNumber:row.saved?.ReplacedEmployeeNumber||null}
    const coverage=reliever.coverage.get(row.employeeId)||{employee:rest,units:0,days:new Map<string,Day>()}
    const day=coverage.days.get(row.date)||{date:row.date,units:0,pending:false}
    const units=Number.isFinite(Number(row.hours))?Math.round(Number(row.hours)*100):0
    reliever.units+=units;coverage.units+=units;day.units+=units
    reliever.pending ||= !!row.draft;day.pending ||= !!row.draft
    coverage.days.set(row.date,day);reliever.coverage.set(row.employeeId,coverage);people.set(id,reliever)
  }
  return [...people.values()].map(person=>({...person,coverage:[...person.coverage.values()].map(item=>({...item,days:[...item.days.values()].sort((a,b)=>a.date.localeCompare(b.date))})).sort((a,b)=>a.employee.EmployeeName.localeCompare(b.employee.EmployeeName))})).sort((a,b)=>a.employee.EmployeeName.localeCompare(b.employee.EmployeeName))
})
const relieverRosterTotal=computed(()=>relieverRoster.value.reduce((sum,person)=>sum+person.units,0)/100)
const relieverDayCells=computed(()=>{
  const cells=new Map<string,{units:number;pending:boolean;coverage:{employee:BtrEmployee;units:number}[]}>()
  for(const person of relieverRoster.value)for(const coverage of person.coverage)for(const day of coverage.days){
    const key=person.employee.EmployeeID+':'+day.date,cell=cells.get(key)||{units:0,pending:false,coverage:[]}
    cell.units+=day.units;cell.pending ||= day.pending;cell.coverage.push({employee:coverage.employee,units:day.units});cells.set(key,cell)
  }
  return cells
})
const relieverDay=(employeeId:number,date:string)=>relieverDayCells.value.get(employeeId+':'+date)
const relieverDateTotal=(date:string)=>relieverRoster.value.reduce((sum,person)=>sum+(relieverDay(person.employee.EmployeeID,date)?.units||0),0)/100
const relieverDayTitle=(employee:BtrEmployee,date:string)=>employee.EmployeeName+' — '+dateLabel(date)+': '+hours((relieverDay(employee.EmployeeID,date)?.units||0)/100)+' BTR hours'+(relieverDay(employee.EmployeeID,date)?.coverage.map(item=>' · '+item.employee.EmployeeName+': '+hours(item.units/100)+' h').join('')||'')
const relieverDayWarning=(employeeId:number,date:string)=>relieverDay(employeeId,date)?.coverage.some(item=>!!attendanceWarning(item.employee.EmployeeID,date))||false
const isBtrDay=(employeeId:number,date:string)=>(relieverDay(employeeId,date)?.units||0)>0
// Each employee appears once, even when they cover breaks and take breaks in the same cutoff.
const sheetPeople=computed(()=>{
  const people=new Map<number,BtrEmployee>()
  for(const employee of gridPeople.value)people.set(Number(employee.EmployeeID),employee)
  const query=gridSearch.value.trim().toLowerCase()
  for(const person of relieverRoster.value){
    const employee=person.employee
    if((employee.EmployeeName+' '+canonicalId(employee.EmployeeID)+' '+(employee.EmployeeNumber||'')).toLowerCase().includes(query))people.set(Number(employee.EmployeeID),employee)
  }
  const btrIds=new Set(relieverRoster.value.filter(person=>cutoffDays.value.some(date=>isBtrDay(person.employee.EmployeeID,date))).map(person=>Number(person.employee.EmployeeID)))
  return [...people.values()].sort((a,b)=>Number(btrIds.has(Number(b.EmployeeID)))-Number(btrIds.has(Number(a.EmployeeID)))||a.EmployeeName.localeCompare(b.EmployeeName))
})
const employeeBtrTotal=(employeeId:number)=>cutoffDays.value.reduce((sum,date)=>sum+(relieverDay(employeeId,date)?.units||0),0)/100
const sheetBtrDateTotal=(date:string)=>sheetPeople.value.reduce((sum,employee)=>sum+(relieverDay(employee.EmployeeID,date)?.units||0),0)/100
const sheetBtrTotal=computed(()=>sheetPeople.value.reduce((sum,employee)=>sum+Math.round(employeeBtrTotal(employee.EmployeeID)*100),0)/100)
const sheetCellTitle=(employee:BtrEmployee,date:string)=>relieverDayTitle(employee,date)+' · Breaks taken: '+hours((gridCell(employee.EmployeeID,date)?.units||0)/100)+' h'
const canReceiveCoverage=computed(()=>employees.value.some(employee=>Number(employee.EmployeeID)===Number(selectedCell.value?.employee.EmployeeID)))
const coveredEmployees=computed(()=>selectedCell.value?relieverDay(selectedCell.value.employee.EmployeeID,selectedCell.value.date)?.coverage||[]:[])
const cellRows=computed(()=>selectedCell.value?gridCell(selectedCell.value.employee.EmployeeID,selectedCell.value.date)?.rows||[]:[])
const cellCandidates=computed(()=>relievers.value.filter(employee=>Number(employee.EmployeeID)!==Number(selectedCell.value?.employee.EmployeeID)))
async function openCell(employee:BtrEmployee,date:string){
  selectedCell.value={employee,date};cellError.value=''
  if(Number(resolveBtrEmployee(cellReliever.value,relievers.value)?.EmployeeID)===Number(employee.EmployeeID))cellReliever.value=''
  await nextTick();cellDialog.value?.showModal()
}
function addCoverage(){
  if(!selectedCell.value||!canReceiveCoverage.value||!editable.value||saving.value||reading.value)return
  const row:Draft={key:nextKey++,ReplacedEmployeeID:canonicalId(selectedCell.value.employee.EmployeeID),RelieverEmployeeID:cellReliever.value,AttendanceDate:selectedCell.value.date,Hours:cellHours.value}
  cellError.value=rowError(row)
  if(cellError.value)return
  const btrId=Number(resolve(row,'btr')?.EmployeeID)
  if(cellRows.value.some(item=>Number(item.saved?.RelieverEmployeeID||resolve(item.draft!,'btr')?.EmployeeID)===btrId)){cellError.value='This reliever is already listed for this day. Edit their hours below.';return}
  if(drafts.value.length>=1000){cellError.value='Save the pending changes before adding more.';return}
  drafts.value.push(row)
}
function updateCoverage(item:GridEntry,value:string){
  if(!editable.value||saving.value||reading.value)return
  if(item.draft){item.draft.Hours=value;return}
  if(item.saved){editEntry(item.saved);const draft=drafts.value.find(row=>row.BTRID===item.saved!.BTRID);if(draft)draft.Hours=value}
}
async function removeCoverage(item:GridEntry){
  if(item.saved)await remove(item.saved)
  else if(item.draft)drafts.value=drafts.value.filter(row=>row.key!==item.draft!.key)
}
function closeCell(){if(!saving.value&&!reading.value)cellDialog.value?.close()}
const cellTitle=(employee:BtrEmployee,date:string)=>employee.EmployeeName+' — '+dateLabel(date)+': '+hours((gridCell(employee.EmployeeID,date)?.units||0)/100)+' BTR hours'+(gridCell(employee.EmployeeID,date)?.rows.map(row=>' · '+row.name+': '+hours(row.hours)+' h').join('')||'')
function attendanceWarning(employeeId:number|undefined,date:string){
  if(!employeeId||loading.value||!data.value?.attendance||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<start.value||date>end.value)return ''
  return btrAttendanceWarning(employeeId,date,data.value.attendance)
}
function rowError(row:Draft){
  const btr=resolve(row,'btr'),rest=resolve(row,'rest')
  if(!btr)return 'Enter a valid BTR Employee ID or Employee No.'
  if(!rest)return 'REST employee must be enrolled in this DTR. Enter their Employee ID or Employee No.'
  if(Number(btr.EmployeeID)===Number(rest.EmployeeID))return 'BTR and REST employees must be different.'
  const date=new Date(row.AttendanceDate+'T00:00:00Z')
  if(!/^\d{4}-\d{2}-\d{2}$/.test(row.AttendanceDate)||Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==row.AttendanceDate||row.AttendanceDate<start.value||row.AttendanceDate>end.value)return 'Choose a valid date within this cutoff.'
  const value=Number(row.Hours)
  if(!Number.isFinite(value)||value<=0||value>24||Math.abs(value*100-Math.round(value*100))>0.000001)return 'Hours must be 0.01–24, with up to two decimal places.'
  return ''
}
const ready=computed(()=>editable.value&&!loading.value&&!saving.value&&!reading.value&&drafts.value.length>0&&drafts.value.every(row=>!rowError(row)))
const draftTotal=computed(()=>drafts.value.reduce((sum,row)=>sum+(Number.isFinite(Number(row.Hours))?Math.round(Number(row.Hours)*100):0),0)/100)
const message=(e:any)=>e?.data?.statusMessage||e?.message||'Unable to load BTR.'
async function load(){
  loading.value=true;error.value=''
  try{data.value=await $fetch<Response>('/api/attendance/dtr/'+props.dtr.BatchID+'/btr')}
  catch(e){error.value=message(e)}
  finally{loading.value=false}
}
function addRow(){
  if(drafts.value.length>=1000){error.value='Save up to 1,000 rows at a time.';return}
  const last=drafts.value[drafts.value.length-1]
  let date=last?.AttendanceDate||start.value
  if(last){const next=new Date(date+'T00:00:00');next.setDate(next.getDate()+1);const formatted=btrDate(next);if(formatted<=end.value)date=formatted}
  drafts.value.push({key:nextKey++,RelieverEmployeeID:last?.RelieverEmployeeID||'',ReplacedEmployeeID:last?.ReplacedEmployeeID||'',AttendanceDate:date,Hours:last?.Hours||1})
}
function editEntry(entry:BtrEntry){
  if(drafts.value.some(row=>row.BTRID===entry.BTRID))return
  drafts.value=drafts.value.filter(row=>row.RelieverEmployeeID||row.ReplacedEmployeeID)
  drafts.value.push({key:nextKey++,BTRID:entry.BTRID,Revision:entry.Revision,RelieverEmployeeID:canonicalId(entry.RelieverEmployeeID),ReplacedEmployeeID:canonicalId(entry.ReplacedEmployeeID),AttendanceDate:entry.AttendanceDate,Hours:Number(entry.Hours)})
  notice.value='Edit the pending hours, then Save BTR.'
}
async function save(){
  if(!ready.value)return
  saving.value=true;error.value='';notice.value=''
  const count=drafts.value.length
  try{
    await $fetch('/api/attendance/dtr/'+props.dtr.BatchID+'/btr',{method:'POST',body:{Rows:drafts.value.map(({key,...row})=>row)}})
    drafts.value=[];notice.value=count+' BTR row(s) saved. DTR regular and OT totals are unchanged.';emit('changed');await load()
  }catch(e){error.value=message(e)}finally{saving.value=false}
}
async function remove(entry:BtrEntry){
  if(!confirm('Remove '+hours(entry.Hours)+' BTR hour(s) for '+entry.RelieverEmployeeName+' on '+dateLabel(entry.AttendanceDate)+'?'))return
  saving.value=true;error.value='';notice.value=''
  try{
    await $fetch('/api/attendance/dtr/'+props.dtr.BatchID+'/btr',{method:'DELETE',query:{btrId:entry.BTRID,revision:entry.Revision}})
    drafts.value=drafts.value.filter(row=>row.BTRID!==entry.BTRID)
    notice.value='BTR entry removed.';emit('changed');await load()
  }catch(e){error.value=message(e)}finally{saving.value=false}
}
async function readFile(file?:File){
  if(!file)return
  reading.value=true;error.value='';notice.value=''
  try{
    const XLSX=await import('xlsx')
    const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false})
    const sheet=workbook.Sheets[workbook.SheetNames[0]||'']
    if(!sheet)throw new Error('The file has no worksheet.')
    const rows=parseBtrSheet(XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',raw:true}),(serial)=>{
      const date=XLSX.SSF.parse_date_code(serial,{date1904:!!workbook.Workbook?.WBProps?.date1904})
      return date?String(date.y).padStart(4,'0')+'-'+String(date.m).padStart(2,'0')+'-'+String(date.d).padStart(2,'0'):''
    })
    const existing=drafts.value.filter(row=>row.RelieverEmployeeID||row.ReplacedEmployeeID)
    if(existing.length+rows.length>1000)throw new Error('Save up to 1,000 rows at a time.')
    drafts.value=[...existing,...rows.map(row=>({...row,key:nextKey++}))]
    notice.value=rows.length+' row(s) loaded from '+file.name+'. Review pending changes, then Save BTR.'
  }catch(e){error.value=message(e)}finally{reading.value=false;if(fileInput.value)fileInput.value.value=''}
}
async function download(template=false){
  error.value=''
  try{
    const XLSX=await import('xlsx')
    const rows=template?[]:entries.value.map(row=>[canonicalId(row.RelieverEmployeeID),row.RelieverEmployeeName,new Date(row.AttendanceDate+'T00:00:00'),Number(row.Hours),canonicalId(row.ReplacedEmployeeID),row.ReplacedEmployeeName])
    const sheet=XLSX.utils.aoa_to_sheet([btrSheetHeaders,...rows])
    sheet['!cols']=[{wch:20},{wch:32},{wch:16},{wch:10},{wch:20},{wch:32}]
    for(let r=1;r<=rows.length;r++){const cell=sheet[XLSX.utils.encode_cell({r,c:2})];if(cell)cell.z='d-mmm-yy'}
    const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,sheet,'BTR')
    XLSX.writeFile(workbook,template?'BTR_TEMPLATE.xlsx':'BTR_'+start.value+'_to_'+end.value+'.xlsx')
  }catch(e){error.value=message(e)}
}
function close(){if(saving.value||reading.value)return;if(drafts.value.length&&!confirm('Close without saving the pending BTR changes?'))return;dialog.value?.close();emit('close')}
onMounted(()=>{dialog.value?.showModal();void load()})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="btr-dialog" aria-labelledby="btr-title" @cancel.prevent="close" @click="($event.target===dialog)&&close()">
      <header class="btr-header"><div><p class="btr-eyebrow">DTR-{{String(dtr.BatchID).padStart(4,'0')}} · BREAK TIME RELIEVER</p><h2 id="btr-title">BTR sheet</h2><p>{{dtr.ClientName}} · {{dtr.SiteName}} · {{dateLabel(start)}} – {{dateLabel(end)}}</p></div><button type="button" class="btr-close" :disabled="saving||reading" aria-label="Close BTR" @click="close">×</button></header>
      <div class="btr-body">
        <div class="btr-toolbar"><p>Click an employee's day cell to assign a <strong>break time reliever</strong>. Dates follow this cutoff automatically. Enter the hours, then Save BTR.</p><div>
          <button type="button" :disabled="saving||reading" @click="download(true)">Template</button><button type="button" :disabled="!entries.length||saving||reading" @click="download(false)">Export</button>
          <button v-if="editable" type="button" :disabled="saving||reading||loading" @click="fileInput?.click()">{{reading?'Reading…':'Import Excel'}}</button>
          <input ref="fileInput" class="btr-file" type="file" accept=".xlsx,.xls,.xlsm,.xlsb,.csv" @change="readFile(($event.target as HTMLInputElement).files?.[0])">
        </div></div>
        <p v-if="error" class="btr-error" role="alert">{{error}}</p><p v-if="notice" class="btr-success" role="status">{{notice}}</p>
        <p v-if="loading" role="status">Loading BTR records…</p>
        <template v-if="data">
          <p v-if="!editable" class="btr-note">This DTR is {{data.batch.Status}}. Saved BTR is view-only.</p>
          <datalist id="btr-employee-options"><option v-for="employee in relievers" :key="employee.EmployeeID" :value="canonicalId(employee.EmployeeID)">{{employee.EmployeeName}}{{employee.EmployeeNumber?' / '+employee.EmployeeNumber:''}}</option></datalist>
          <datalist id="btr-rest-options"><option v-for="employee in employees" :key="employee.EmployeeID" :value="canonicalId(employee.EmployeeID)">{{employee.EmployeeName}}{{employee.EmployeeNumber?' / '+employee.EmployeeNumber:''}}</option></datalist>
          <div class="btr-section-title"><h3>BTR / REST employees</h3><input v-model="gridSearch" type="search" aria-label="Search employees" placeholder="Search employee name or ID"></div>
          <p class="btr-grid-hint">Assign a reliever on the REST employee's day. Those hours automatically total under the reliever, with BTR shown below the hours on that date. One row per employee; relievers appear first.</p>
          <div class="btr-grid-legend"><span><i class="btr-legend-filled"></i>Recorded BTR</span><span><i class="btr-legend-pending"></i>Unsaved change</span><span><i class="btr-legend-warning"></i>Check attendance</span></div>
          <div class="btr-grid-wrap" tabindex="0" aria-label="BTR and REST cutoff grid, scroll to see all days">
            <table class="btr-grid"><colgroup><col class="btr-person-col"><col v-for="date in cutoffDays" :key="date" class="btr-day-col"><col class="btr-total-col"></colgroup>
              <thead><tr><th scope="col" rowspan="2" class="btr-grid-person">Name of personnel / E-ID</th><th v-for="date in cutoffDays" :key="date" scope="col" :title="dateLabel(date)">{{Number(date.slice(8))}}</th><th scope="col" rowspan="2" class="btr-grid-total">Total<br>hours</th></tr><tr><th v-for="date in cutoffDays" :key="date" scope="col" class="btr-hours-head">HRS</th></tr></thead>
              <tbody><tr v-for="employee in sheetPeople" :key="employee.EmployeeID">
                <th scope="row" class="btr-grid-person"><strong>{{employee.EmployeeName}}</strong><small>{{canonicalId(employee.EmployeeID)}}<template v-if="employee.EmployeeNumber"> / {{employee.EmployeeNumber}}</template></small></th>
                <td v-for="date in cutoffDays" :key="date" class="btr-grid-day">
                  <button type="button" :disabled="loading||saving||reading" :class="{'has-btr':!!relieverDay(employee.EmployeeID,date)||!!gridCell(employee.EmployeeID,date),'is-pending':relieverDay(employee.EmployeeID,date)?.pending||gridCell(employee.EmployeeID,date)?.pending,'has-warning':relieverDayWarning(employee.EmployeeID,date)||(!!gridCell(employee.EmployeeID,date)&&!!attendanceWarning(employee.EmployeeID,date))}" :aria-label="sheetCellTitle(employee,date)" :title="sheetCellTitle(employee,date)" @click="openCell(employee,date)">
                    <template v-if="relieverDay(employee.EmployeeID,date)">
                      <strong>{{hours(relieverDay(employee.EmployeeID,date)!.units/100)}}</strong>
                      <small v-if="isBtrDay(employee.EmployeeID,date)" class="btr-cell-label">BTR</small>
                    </template>
                    <template v-if="gridCell(employee.EmployeeID,date)">
                      <strong>{{hours(gridCell(employee.EmployeeID,date)!.units/100)}}</strong>
                      <small v-if="relieverDay(employee.EmployeeID,date)" class="btr-rest-label">REST</small>
                    </template>
                    <template v-if="!relieverDay(employee.EmployeeID,date)&&!gridCell(employee.EmployeeID,date)"><strong>–</strong><small v-if="editable">+</small></template>
                    <small v-if="relieverDay(employee.EmployeeID,date)?.pending||gridCell(employee.EmployeeID,date)?.pending" aria-label="Unsaved change">●</small>
                  </button>
                </td>
                <td class="btr-grid-total"><template v-if="employeeBtrTotal(employee.EmployeeID)">{{hours(employeeBtrTotal(employee.EmployeeID))}}<small>BTR</small></template><template v-if="personTotal(employee.EmployeeID)">{{hours(personTotal(employee.EmployeeID))}}<small>REST</small></template><template v-if="!employeeBtrTotal(employee.EmployeeID)&&!personTotal(employee.EmployeeID)">0.00</template></td>
              </tr><tr v-if="!sheetPeople.length"><td :colspan="cutoffDays.length+2" class="btr-empty">No matching employees.</td></tr></tbody>
              <tfoot><tr><th class="btr-grid-person">{{gridSearch.trim()?'FILTERED BTR TOTAL':'BTR TOTAL'}}</th><td v-for="date in cutoffDays" :key="date">{{hours(sheetBtrDateTotal(date))}}</td><th class="btr-grid-total">{{hours(sheetBtrTotal)}}</th></tr><tr><th class="btr-grid-person">{{gridSearch.trim()?'FILTERED REST TOTAL':'REST TOTAL'}}</th><td v-for="date in cutoffDays" :key="date">{{hours(dateTotal(date))}}</td><th class="btr-grid-total">{{hours(gridTotal)}}</th></tr></tfoot>
            </table>
          </div>
          <p class="btr-grid-hint">Grid totals include pending changes. BTR hours are separate from regular and OT attendance totals.</p>
          <details v-if="editable&&drafts.length" class="btr-summary" :open="drafts.some(row=>!!rowError(row))"><summary>Review pending changes · {{drafts.length}} rows · {{hours(draftTotal)}} h</summary>
          <form @submit.prevent="save">
            <div class="btr-section-title"><h3>{{drafts.some(row=>row.BTRID)?'New / edited rows':'New rows'}}</h3><span>BTR employee = reliever · REST employee = employee being relieved</span></div>
            <div class="btr-table-wrap"><table class="btr-table"><colgroup><col style="width:17%"><col style="width:20%"><col style="width:140px"><col style="width:80px"><col style="width:17%"><col style="width:20%"><col style="width:52px"></colgroup>
              <thead><tr><th v-for="header in btrSheetHeaders" :key="header">{{header}}</th><th> </th></tr></thead>
              <tbody><template v-for="(row,index) in drafts" :key="row.key"><tr>
                <td><input v-model.trim="row.RelieverEmployeeID" list="btr-employee-options" :aria-label="'BTR employee ID, row '+(index+1)" placeholder="EMP-0002 / Employee No" :disabled="saving||reading||!!row.BTRID" required></td>
                <td><span class="btr-name">{{resolve(row,'btr')?.EmployeeName||'—'}}</span></td>
                <td><input v-model="row.AttendanceDate" type="date" :min="start" :max="end" :aria-label="'Date, row '+(index+1)" :disabled="saving||reading||!!row.BTRID" required></td>
                <td><input v-model="row.Hours" type="number" min="0.01" max="24" step="0.01" :aria-label="'Hours, row '+(index+1)" :disabled="saving||reading" required></td>
                <td><input v-model.trim="row.ReplacedEmployeeID" list="btr-rest-options" :aria-label="'REST employee ID, row '+(index+1)" placeholder="EMP-0001 / Employee No" :disabled="saving||reading||!!row.BTRID" required></td>
                <td><span class="btr-name">{{resolve(row,'rest')?.EmployeeName||'—'}}</span></td>
                <td class="btr-actions"><button type="button" :disabled="saving||reading" :aria-label="'Remove unsaved row '+(index+1)" @click="drafts.splice(index,1)">×</button></td>
              </tr><tr v-if="(row.RelieverEmployeeID||row.ReplacedEmployeeID)&&rowError(row)"><td colspan="7" class="btr-row-error">Row {{index+1}}: {{rowError(row)}}</td></tr>
              <tr v-if="attendanceWarning(resolve(row,'rest')?.EmployeeID,row.AttendanceDate)"><td colspan="7" class="btr-row-error" role="alert">Warning — Row {{index+1}}: {{attendanceWarning(resolve(row,'rest')?.EmployeeID,row.AttendanceDate)}}</td></tr></template></tbody>
              <tfoot v-if="drafts.length"><tr><td colspan="3">Unsaved hours</td><td>{{hours(draftTotal)}}</td><td colspan="3"></td></tr></tfoot>
            </table></div>
            <div class="btr-row-controls"><span>Review imported rows or pending cell edits, then save.</span><button type="submit" class="btr-primary" :disabled="!ready">{{saving?'Saving…':'Save BTR'}}</button></div>
          </form>
          </details>
          <details class="btr-summary"><summary>Saved BTR details · {{entries.length}} rows · {{hours(totals.TotalHours)}} h</summary><section class="btr-saved"><div class="btr-section-title"><h3>Saved BTR <small>({{entries.length}} rows · {{hours(totals.TotalHours)}} h)</small></h3><input v-model="search" type="search" aria-label="Search saved BTR" placeholder="Search employee or date"></div>
            <p v-if="!visibleEntries.length" class="btr-empty">{{entries.length?'No matching entries.':'No saved BTR rows yet.'}}</p>
            <div v-else class="btr-table-wrap"><table class="btr-table">
              <thead><tr><th v-for="header in btrSheetHeaders" :key="header">{{header}}</th><th v-if="editable">Actions</th></tr></thead>
              <tbody><template v-for="entry in visibleEntries" :key="entry.BTRID"><tr>
                <td>{{canonicalId(entry.RelieverEmployeeID)}}<small v-if="entry.RelieverEmployeeNumber">{{entry.RelieverEmployeeNumber}}</small></td><td>{{entry.RelieverEmployeeName}}</td><td>{{dateLabel(entry.AttendanceDate)}}</td><td>{{hours(entry.Hours)}}</td><td>{{canonicalId(entry.ReplacedEmployeeID)}}<small v-if="entry.ReplacedEmployeeNumber">{{entry.ReplacedEmployeeNumber}}</small></td><td>{{entry.ReplacedEmployeeName}}</td>
                <td v-if="editable" class="btr-actions"><div><button type="button" :disabled="saving||reading||loading" @click="openCell({EmployeeID:entry.ReplacedEmployeeID,EmployeeName:entry.ReplacedEmployeeName,EmployeeNumber:entry.ReplacedEmployeeNumber||null},entry.AttendanceDate)">Edit</button><button type="button" class="btr-remove" :disabled="saving||reading||loading" @click="remove(entry)">Remove</button></div></td>
              </tr><tr v-if="entry.Issue"><td :colspan="editable?7:6" class="btr-row-error">Needs review: {{entry.Issue}}</td></tr>
              <tr v-if="attendanceWarning(entry.ReplacedEmployeeID,entry.AttendanceDate)"><td :colspan="editable?7:6" class="btr-row-error" role="status">Warning: {{attendanceWarning(entry.ReplacedEmployeeID,entry.AttendanceDate)}}</td></tr></template></tbody>
            </table></div>
          </section></details>
          <details v-if="entries.length" class="btr-summary"><summary>Totals per employee · {{hours(totals.TotalHours)}} BTR hours</summary><div class="btr-total-panels">
            <section><h3>BTR employees</h3><details v-for="employee in totals.relievers" :key="employee.EmployeeID"><summary>{{employee.EmployeeName}} <strong>{{hours(employee.Hours)}} h</strong></summary><p v-for="pair in totals.pairs.filter(item=>item.RelieverEmployeeID===employee.EmployeeID)" :key="pair.ReplacedEmployeeID">{{pair.ReplacedEmployeeName}} <strong>{{hours(pair.Hours)}} h</strong></p></details></section>
            <section><h3>REST employees · recorded deductions</h3><p v-for="employee in totals.replaced" :key="employee.EmployeeID">{{employee.EmployeeName}} <strong>{{hours(employee.Hours)}} h</strong></p></section>
          </div></details>
        </template>
      </div>
      <footer class="btr-footer"><span>{{drafts.length?drafts.length+' pending change(s) · Save BTR to keep your edits.':'BTR is saved separately. Regular / OT totals are unchanged.'}}</span><div><button type="button" :disabled="loading||saving||reading" @click="load">Refresh</button><button type="button" :disabled="saving||reading" @click="close">Close</button><button v-if="editable" type="button" class="btr-primary" :disabled="!ready" @click="save">{{saving?'Saving…':'Save BTR'}}</button></div></footer>
      <dialog ref="cellDialog" class="btr-dialog btr-cell-dialog" aria-labelledby="btr-cell-title" @cancel.stop.prevent="closeCell" @click.stop="($event.target===cellDialog)&&closeCell()">
        <template v-if="selectedCell">
          <header class="btr-header"><div><p class="btr-eyebrow">BREAK TIME RELIEVER</p><h2 id="btr-cell-title">{{dateLabel(selectedCell.date)}}</h2><p><strong>{{selectedCell.employee.EmployeeName}}</strong><br>{{canonicalId(selectedCell.employee.EmployeeID)}} · REST employee</p></div><button type="button" class="btr-close" aria-label="Close day editor" :disabled="saving||reading" @click="closeCell">×</button></header>
          <div class="btr-body">
            <section v-if="coveredEmployees.length" class="btr-covered-list"><h3>Breaks covered on this day · {{hours((relieverDay(selectedCell.employee.EmployeeID,selectedCell.date)?.units||0)/100)}} h</h3><p v-for="coverage in coveredEmployees" :key="coverage.employee.EmployeeID"><span>{{coverage.employee.EmployeeName}} · {{hours(coverage.units/100)}} h</span><button type="button" :disabled="saving||reading" @click="openCell(coverage.employee,selectedCell.date)">View / edit</button></p></section>
            <h3 v-if="canReceiveCoverage">This employee's own break</h3>
            <p v-else class="btr-grid-hint">This employee is not enrolled in this DTR. Their recorded break coverage is shown above.</p>
            <p v-if="attendanceWarning(selectedCell.employee.EmployeeID,selectedCell.date)" class="btr-cell-warning" role="alert">{{attendanceWarning(selectedCell.employee.EmployeeID,selectedCell.date)}} You can still record BTR after reviewing.</p>
            <form v-if="editable&&canReceiveCoverage" class="btr-cell-form" @submit.prevent="addCoverage"><label>Break time reliever<select v-model="cellReliever" :disabled="saving||reading" required><option value="">Select employee</option><option v-for="employee in cellCandidates" :key="employee.EmployeeID" :value="canonicalId(employee.EmployeeID)">{{employee.EmployeeName}} — {{canonicalId(employee.EmployeeID)}}{{employee.EmployeeNumber?' / '+employee.EmployeeNumber:''}}</option></select></label><label>Hours<input v-model="cellHours" type="number" min="0.01" max="24" step="0.01" :disabled="saving||reading" required></label><button type="submit" :disabled="saving||reading">+ Add coverage</button></form>
            <p v-if="cellError" class="btr-error" role="alert">{{cellError}}</p>
            <p v-if="!cellRows.length" class="btr-empty">No BTR recorded for this day.</p>
            <div v-for="item in cellRows" :key="item.key" class="btr-coverage"><div><strong>{{item.name}}</strong><small>{{item.draft?'Unsaved change':'Saved'}}</small><p v-if="item.saved?.Issue" class="btr-error">{{item.saved.Issue}}</p><p v-if="item.draft&&rowError(item.draft)" class="btr-error" role="alert">{{rowError(item.draft)}}</p></div><input :value="item.hours" type="number" min="0.01" max="24" step="0.01" :aria-label="'BTR hours for '+item.name" :disabled="!editable||saving||reading" @input="updateCoverage(item,($event.target as HTMLInputElement).value)"><button v-if="editable" type="button" class="btr-remove" :disabled="saving||reading" @click="removeCoverage(item)">Remove</button></div>
            <p class="btr-cell-total">Total for this day <strong>{{hours((gridCell(selectedCell.employee.EmployeeID,selectedCell.date)?.units||0)/100)}} h</strong></p>
            <p v-if="error" class="btr-error" role="alert">{{error}}</p>
          </div>
          <footer class="btr-footer"><span>Changes appear in the grid. Save BTR to keep them.</span><div><button type="button" :disabled="saving||reading" @click="closeCell">Done</button><button v-if="editable" type="button" class="btr-primary" :disabled="!ready" @click="save">{{saving?'Saving…':'Save BTR'}}</button></div></footer>
        </template>
      </dialog>
    </dialog>
  </Teleport>
</template>

<style scoped>
.btr-grid .btr-grid-day button .btr-cell-label{color:#000;font-weight:700}.btr-grid .btr-grid-day button .btr-rest-label{color:#60718d}.btr-grid-total small{display:block;font-size:9px;font-weight:400;margin:2px 0 4px}.btr-covered-list{margin-bottom:16px;padding:12px;border:1px solid #dce5f2;border-radius:8px}.btr-covered-list p{display:flex;justify-content:space-between;align-items:center;gap:10px}
.btr-grid-wrap{overflow:auto;max-height:55vh;border:1px solid #b9c0c7;border-radius:10px;background:#fff}.btr-grid{width:100%;min-width:1020px;table-layout:fixed;border-collapse:separate;border-spacing:0;font-size:12px}.btr-person-col{width:235px}.btr-day-col{width:44px}.btr-total-col{width:78px}.btr-grid th,.btr-grid td{border-right:1px solid #b9c0c7;border-bottom:1px solid #b9c0c7;text-align:center;padding:7px 3px}.btr-grid thead th{background:#fff700;color:#101820;font-size:11px;text-transform:uppercase;position:sticky;top:0;z-index:2;height:29px}.btr-grid thead tr:nth-child(2) th{top:29px;height:25px;font-size:10px}.btr-grid .btr-grid-person{position:sticky;left:0;z-index:3;text-align:left;padding:10px 12px;background:white;white-space:normal}.btr-grid-person strong{display:block;font-size:12px}.btr-grid-person small{display:block;color:#63738d;font-size:10px;margin-top:5px;font-weight:400}.btr-grid .btr-grid-total{position:sticky;right:0;z-index:3;background:#f4f8ee;font-weight:700}.btr-grid thead .btr-grid-person,.btr-grid thead .btr-grid-total{z-index:4;background:#fff700}.btr-grid .btr-grid-day{padding:0}.btr-grid .btr-grid-day button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:53px;width:100%;padding:4px 1px;border:0;border-radius:0;font-size:11px;background:#fff;color:#60718d}.btr-grid .btr-grid-day button small{font-size:10px;line-height:10px}.btr-grid .btr-grid-day button.has-btr{background:#eaf2ff;color:#1f4d8b}.btr-grid .btr-grid-day button.is-pending{background:#fff4ce;color:#765200}.btr-grid .btr-grid-day button.has-warning{box-shadow:inset 0 -3px #f97316}.btr-grid .btr-grid-day button:hover{background:#dce9ff}.btr-grid tfoot th,.btr-grid tfoot td,.btr-grid tfoot .btr-grid-person,.btr-grid tfoot .btr-grid-total{background:#c6dfb5;color:#132919;font-weight:700}.btr-grid-legend{display:flex;flex-wrap:wrap;gap:16px;margin:10px 0;color:#60718d;font-size:11px}.btr-grid-legend span{display:flex;gap:6px;align-items:center}.btr-grid-legend i{display:inline-block;width:16px;height:10px;border:1px solid #c9d7e8}.btr-legend-filled{background:#eaf2ff}.btr-legend-pending{background:#fff4ce}.btr-grid-legend .btr-legend-warning{height:3px;background:#f97316;border:0}.btr-grid-hint{font-size:12px;color:#60718d;margin:10px 0 0}
.btr-dialog.btr-cell-dialog{width:min(720px,calc(100vw - 24px));max-height:88vh}.btr-cell-dialog::backdrop{background:rgba(14,28,55,.45)}.btr-cell-form{display:grid;grid-template-columns:minmax(0,1fr) 85px;gap:12px;align-items:end}.btr-cell-form label{font-size:12px;font-weight:700;display:grid;gap:6px}.btr-cell-form select{width:100%;min-width:0;min-height:38px;padding:7px;border:1px solid #ccd9ec;border-radius:6px;background:#fff;color:#19365e;font:inherit}.btr-cell-form>button{grid-column:1/-1;justify-self:end}.btr-cell-warning{padding:12px;background:#fff5e8;border-left:3px solid #f97316;color:#924312;font-size:12px;line-height:1.6;margin:0 0 16px}.btr-coverage{display:grid;grid-template-columns:minmax(0,1fr) 85px auto;gap:12px;align-items:center;padding:14px 0;border-bottom:1px solid #dce5f2}.btr-coverage strong{font-size:13px}.btr-coverage small{display:block;font-size:11px;color:#718098;margin-top:5px}.btr-cell-total{display:flex;justify-content:space-between;font-size:14px;font-weight:700;margin:18px 0 0}.btr-cell-dialog .btr-footer{flex-wrap:wrap}.btr-cell-dialog .btr-footer>div{margin-left:auto}
@media(max-width:650px){.btr-person-col{width:160px}.btr-grid{min-width:960px}.btr-grid-person strong{font-size:11px}.btr-grid-person small{font-size:9px}.btr-footer{flex-wrap:wrap}.btr-coverage{gap:6px;grid-template-columns:minmax(0,1fr) 65px auto}}
.btr-dialog{box-sizing:border-box;width:min(1700px,calc(100vw - 32px));max-height:92vh;padding:0;border:1px solid #dbe5f3;border-radius:14px;background:#f8faff;color:#19365e;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;font-size:14px}
.btr-dialog[open]{display:flex;flex-direction:column}.btr-dialog::backdrop{background:rgba(14,28,55,.55)}.btr-dialog *{box-sizing:border-box}
.btr-header{display:flex;justify-content:space-between;gap:16px;padding:18px 22px;border-bottom:1px solid #dfe7f2;background:white;flex-shrink:0}.btr-dialog h2,.btr-dialog h3,.btr-header p{margin:0}.btr-dialog h2{font-size:23px}.btr-dialog h3{font-size:14px}.btr-header p:not(.btr-eyebrow){margin-top:6px;color:#60718d;font-size:13px}.btr-eyebrow{font-size:11px;color:#4778bf;font-weight:800;letter-spacing:.05em;margin-bottom:6px!important}.btr-dialog .btr-close{align-self:flex-start;border:0;font-size:26px;background:transparent}
.btr-body{overflow-y:auto;min-height:0;padding:18px 22px}.btr-toolbar{display:flex;gap:18px;align-items:center;justify-content:space-between;margin-bottom:18px}.btr-toolbar p{max-width:720px;margin:0;font-size:13px;color:#60718d;line-height:1.5}.btr-toolbar>div,.btr-footer>div{display:flex;gap:8px}.btr-dialog .btr-file{display:none}
.btr-dialog button{border:1px solid #cfdbec;border-radius:7px;min-height:36px;padding:8px 12px;font:inherit;font-size:13px;font-weight:600;background:white;color:#2054bc;cursor:pointer;white-space:nowrap}.btr-dialog button:disabled,.btr-dialog input:disabled{opacity:.5;cursor:not-allowed}.btr-dialog :focus-visible{outline:2px solid #2867d8;outline-offset:2px}.btr-dialog .btr-primary{background:#2867d8;color:white;border-color:#2867d8}
.btr-dialog input{width:100%;min-width:0;min-height:36px;padding:7px 8px;border:1px solid #ccd9ec;border-radius:6px;background:white;color:#19365e;font:inherit;font-size:13px}.btr-section-title{display:flex;justify-content:space-between;align-items:center;gap:14px;margin:12px 0 10px}.btr-section-title>span,.btr-section-title small{font-size:12px;color:#64738d}.btr-section-title input{width:min(280px,50%)}
.btr-table-wrap{overflow-x:auto;border:1px solid #dce5f2;border-radius:9px;background:#fff}.btr-table{border-collapse:collapse;table-layout:fixed;width:100%;min-width:960px;font-size:13px}.btr-table th{font-size:10px;color:#5a7090;font-weight:700;background:#f0f5fd;letter-spacing:.02em;text-align:left;padding:11px 9px}.btr-table td{border-top:1px solid #e3ebf6;padding:8px 9px;overflow-wrap:anywhere;vertical-align:middle}.btr-table small{display:block;color:#73839a;font-size:11px;margin-top:4px}.btr-table tfoot{background:#f1f6fd;font-weight:700}.btr-name{font-size:12px;line-height:1.5}.btr-table .btr-actions{position:sticky;right:0;background:#fff;box-shadow:-1px 0 #e3ebf6}.btr-actions>div{display:flex;gap:5px}.btr-actions button{padding:6px 8px;min-height:32px;font-size:12px}.btr-dialog .btr-remove{color:#b42318}.btr-table .btr-row-error{color:#a64d17;background:#fff5e8;font-size:12px;padding:8px 12px}
.btr-row-controls{display:flex;align-items:center;gap:12px;margin-top:10px}.btr-row-controls span{flex:1;color:#718098;font-size:12px}.btr-error{color:#b42318;font-size:13px}.btr-success{color:#176843;font-size:13px}.btr-empty{color:#718098;font-size:13px;padding:14px 0}.btr-saved{margin-top:24px}
.btr-summary{margin-top:20px;border:1px solid #dce5f2;border-radius:9px;padding:13px;background:white}.btr-summary summary{cursor:pointer;font-size:13px}.btr-total-panels{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:18px}.btr-total-panels p,.btr-total-panels details{border-top:1px solid #e5edf6;padding-top:10px;font-size:12px;line-height:1.7}.btr-total-panels strong{float:right;margin-left:12px}.btr-total-panels details p{margin-left:15px;color:#64738d}
.btr-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 22px;border-top:1px solid #dfe7f2;background:#fff;flex-shrink:0}.btr-footer span{font-size:12px;color:#667894}
@media(max-width:850px){.btr-toolbar{align-items:flex-start;flex-direction:column;gap:10px}.btr-body,.btr-header{padding:16px}.btr-total-panels{grid-template-columns:1fr}.btr-section-title{flex-wrap:wrap}.btr-row-controls{flex-wrap:wrap}.btr-row-controls span{flex-basis:50%}}
@media(max-width:480px){.btr-dialog{width:calc(100vw - 12px);max-height:96vh}.btr-footer{align-items:flex-end;padding:12px 16px}.btr-section-title input{width:100%}.btr-row-controls span{display:none}.btr-row-controls{justify-content:space-between}}
</style>
