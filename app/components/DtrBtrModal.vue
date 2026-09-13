<script setup lang="ts">
import { btrDate, resolveBtrEmployee, summarizeBtr } from '../../shared/utils/dtrBtr'
import type { BtrEmployee, BtrEntry } from '../../shared/utils/dtrBtr'
import { btrSheetHeaders, parseBtrSheet } from '../../shared/utils/dtrBtrSheet'
import type { BtrSheetRow } from '../../shared/utils/dtrBtrSheet'

type Dtr={BatchID:number;AgencyName:string;ClientName:string;SiteName:string;PeriodStart:string;PeriodEnd:string}
type Response={batch:{Status:string;PeriodStart:string;PeriodEnd:string};employees:BtrEmployee[];relievers:BtrEmployee[];entries:BtrEntry[]}
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
  notice.value='Edit the hours in the row above, then Save rows.'
}
async function save(){
  if(!ready.value)return
  saving.value=true;error.value='';notice.value=''
  const count=drafts.value.length
  try{
    await $fetch('/api/attendance/dtr/'+props.dtr.BatchID+'/btr',{method:'POST',body:{Rows:drafts.value.map(({key,...row})=>row)}})
    drafts.value=[];addRow();notice.value=count+' BTR row(s) saved. DTR regular and OT totals are unchanged.';emit('changed');await load()
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
    notice.value=rows.length+' row(s) loaded from '+file.name+'. Review the matched names, then Save rows.'
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
function close(){if(saving.value||reading.value)return;dialog.value?.close();emit('close')}
onMounted(()=>{dialog.value?.showModal();addRow();void load()})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="btr-dialog" aria-labelledby="btr-title" @cancel.prevent="close" @click="($event.target===dialog)&&close()">
      <header class="btr-header"><div><p class="btr-eyebrow">DTR-{{String(dtr.BatchID).padStart(4,'0')}} · BREAK TIME RELIEVER</p><h2 id="btr-title">BTR sheet</h2><p>{{dtr.ClientName}} · {{dtr.SiteName}} · {{dateLabel(start)}} – {{dateLabel(end)}}</p></div><button type="button" class="btr-close" :disabled="saving||reading" aria-label="Close BTR" @click="close">×</button></header>
      <div class="btr-body">
        <div class="btr-toolbar"><p>Use <strong>Employee ID or Employee No.</strong> Names fill automatically. REST employees can have any attendance status or hours, as long as they are in this DTR.</p><div>
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
          <form v-if="editable" @submit.prevent="save">
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
              </tr><tr v-if="(row.RelieverEmployeeID||row.ReplacedEmployeeID)&&rowError(row)"><td colspan="7" class="btr-row-error">Row {{index+1}}: {{rowError(row)}}</td></tr></template></tbody>
              <tfoot v-if="drafts.length"><tr><td colspan="3">Unsaved hours</td><td>{{hours(draftTotal)}}</td><td colspan="3"></td></tr></tfoot>
            </table></div>
            <div class="btr-row-controls"><button type="button" :disabled="saving||reading||loading||drafts.length>=1000" @click="addRow">+ Add row</button><span>New rows reuse the last employees and advance the date.</span><button type="submit" class="btr-primary" :disabled="!ready">{{saving?'Saving…':'Save rows'}}</button></div>
          </form>
          <section class="btr-saved"><div class="btr-section-title"><h3>Saved BTR <small>({{entries.length}} rows · {{hours(totals.TotalHours)}} h)</small></h3><input v-model="search" type="search" aria-label="Search saved BTR" placeholder="Search employee or date"></div>
            <p v-if="!visibleEntries.length" class="btr-empty">{{entries.length?'No matching entries.':'No saved BTR rows yet.'}}</p>
            <div v-else class="btr-table-wrap"><table class="btr-table">
              <thead><tr><th v-for="header in btrSheetHeaders" :key="header">{{header}}</th><th v-if="editable">Actions</th></tr></thead>
              <tbody><template v-for="entry in visibleEntries" :key="entry.BTRID"><tr>
                <td>{{canonicalId(entry.RelieverEmployeeID)}}<small v-if="entry.RelieverEmployeeNumber">{{entry.RelieverEmployeeNumber}}</small></td><td>{{entry.RelieverEmployeeName}}</td><td>{{dateLabel(entry.AttendanceDate)}}</td><td>{{hours(entry.Hours)}}</td><td>{{canonicalId(entry.ReplacedEmployeeID)}}<small v-if="entry.ReplacedEmployeeNumber">{{entry.ReplacedEmployeeNumber}}</small></td><td>{{entry.ReplacedEmployeeName}}</td>
                <td v-if="editable" class="btr-actions"><div><button type="button" :disabled="saving||reading||loading" @click="editEntry(entry)">Edit</button><button type="button" class="btr-remove" :disabled="saving||reading||loading" @click="remove(entry)">Remove</button></div></td>
              </tr><tr v-if="entry.Issue"><td :colspan="editable?7:6" class="btr-row-error">Needs review: {{entry.Issue}}</td></tr></template></tbody>
            </table></div>
          </section>
          <details v-if="entries.length" class="btr-summary"><summary>Totals per employee · {{hours(totals.TotalHours)}} BTR hours</summary><div class="btr-total-panels">
            <section><h3>BTR employees</h3><details v-for="employee in totals.relievers" :key="employee.EmployeeID"><summary>{{employee.EmployeeName}} <strong>{{hours(employee.Hours)}} h</strong></summary><p v-for="pair in totals.pairs.filter(item=>item.RelieverEmployeeID===employee.EmployeeID)" :key="pair.ReplacedEmployeeID">{{pair.ReplacedEmployeeName}} <strong>{{hours(pair.Hours)}} h</strong></p></details></section>
            <section><h3>REST employees · recorded deductions</h3><p v-for="employee in totals.replaced" :key="employee.EmployeeID">{{employee.EmployeeName}} <strong>{{hours(employee.Hours)}} h</strong></p></section>
          </div></details>
        </template>
      </div>
      <footer class="btr-footer"><span>BTR is saved separately. Regular / OT totals are unchanged.</span><div><button type="button" :disabled="loading||saving||reading" @click="load">Refresh</button><button type="button" :disabled="saving||reading" @click="close">Close</button></div></footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.btr-dialog{box-sizing:border-box;width:min(1420px,calc(100vw - 32px));max-height:92vh;padding:0;border:1px solid #dbe5f3;border-radius:14px;background:#f8faff;color:#19365e;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;font-size:14px}
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
