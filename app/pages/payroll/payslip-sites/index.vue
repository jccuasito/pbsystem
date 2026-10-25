<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import EmployeePayslipSheet from '../../../components/EmployeePayslipSheet.vue'
import PayslipPage from '../payslip/index.vue'

type SitePayroll={BatchID:number;AgencyName:string;SiteName:string;ClientName:string;PeriodStart:string;PeriodEnd:string;EmployeeCount:number;PayrollCount:number;PostedPayrollCount:number;PublicationStatus:string;GrossPay:number;TotalDeduction:number;NetPay:number}
type Employee={EmployeeID:number;EmployeeName:string;EmployeeNumber:string|null;AgencyName:string|null;PositionName:string|null;Status:string}
type Cutoff={key:string;periodStart:string;periodEnd:string;assignmentType:'Regular'|'Reliever';publicationStatus:string;gross:number;deductions:number;net:number;sources:Array<{batchId:number|null;siteName:string}>;[key:string]:any}
type RosterItem={employee:Employee;cutoffs:Cutoff[]}
type Roster={header:SitePayroll;items:RosterItem[];reviewToken:string;canPost:boolean}
type List={items:SitePayroll[];agencies:Array<{AgencyID:number;AgencyName:string}>;cutoffs:Array<{PeriodStart:string;PeriodEnd:string}>;canPost:boolean;pagination:{page:number;pages:number;total:number}}
const list=ref<List>({items:[],agencies:[],cutoffs:[],canPost:false,pagination:{page:1,pages:1,total:0}})
const search=ref(''),agencyId=ref(''),cutoff=ref(''),postingStatus=ref(''),page=ref(1),loading=ref(false),error=ref('')
const roster=ref<Roster|null>(null),rosterLoading=ref(false),rosterError=ref(''),notice=ref(''),busy=ref(false)
const selected=ref<number[]>([]),rosterSearch=ref(''),rosterStatus=ref(''),rosterPage=ref(1),includeCombined=ref(false)
const preview=ref<{employee:Employee;cutoff:Cutoff}|null>(null),managedEmployee=ref<Employee|null>(null),dialog=ref<HTMLElement|null>(null)
const money=(value:number)=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value||0))
const date=(value:string)=>new Date(value+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})
const period=(item:{PeriodStart:string;PeriodEnd:string})=>date(item.PeriodStart)+' - '+date(item.PeriodEnd)
const number=(employee:Employee)=>employee.EmployeeNumber||'EMP-'+String(employee.EmployeeID).padStart(4,'0')
const rowStatus=(row:RosterItem)=>row.cutoffs.every(item=>item.publicationStatus==='Posted')?'Posted':row.cutoffs.some(item=>item.publicationStatus==='Posted')?'Partially posted':'Not Posted'
const combined=(row:RosterItem)=>row.cutoffs.some(item=>item.sources.some(source=>Number(source.batchId)!==Number(roster.value?.header.BatchID)))
const sourceNames=(item:Cutoff)=>[...new Set(item.sources.map(source=>source.siteName))].join(' / ')
const filteredRoster=computed(()=>roster.value?.items.filter(row=>(!rosterStatus.value||rowStatus(row)===rosterStatus.value)&&[row.employee.EmployeeName,number(row.employee)].join(' ').toLowerCase().includes(rosterSearch.value.trim().toLowerCase()))||[])
const rosterPages=computed(()=>Math.max(1,Math.ceil(filteredRoster.value.length/25)))
watch(rosterPages,value=>{if(rosterPage.value>value)rosterPage.value=value})
const visibleRoster=computed(()=>filteredRoster.value.slice((rosterPage.value-1)*25,rosterPage.value*25))
const selectedRows=computed(()=>roster.value?.items.filter(row=>selected.value.includes(row.employee.EmployeeID))||[])
const combinedCount=computed(()=>selectedRows.value.filter(combined).length)
const postedCount=computed(()=>roster.value?.items.filter(row=>rowStatus(row)==='Posted').length||0)
const selectedPayslips=computed(()=>selectedRows.value.flatMap(row=>row.cutoffs))
const canPostSelected=computed(()=>selectedPayslips.value.some(item=>item.publicationStatus!=='Posted'))
const canWithdrawSelected=computed(()=>selectedPayslips.value.some(item=>item.publicationStatus==='Posted'))
const scopeAccepted=computed(()=>!combinedCount.value||includeCombined.value)
const allVisibleSelected=computed(()=>visibleRoster.value.length>0&&visibleRoster.value.every(row=>selected.value.includes(row.employee.EmployeeID)))
const siteTotal=(row:RosterItem,field:'gross'|'deductions'|'net')=>row.cutoffs.reduce((sum,item)=>sum+item.sources.filter(source=>Number(source.batchId)===Number(roster.value?.header.BatchID)).reduce((total,source:any)=>total+Math.round(Number(source[field]||0)*100),0),0)/100

async function load(){
 loading.value=true;error.value=''
 try{const [periodStart,periodEnd]=cutoff.value.split('|');list.value=await $fetch<List>('/api/payroll/payslips/sites',{query:{search:search.value.trim(),agencyId:agencyId.value||undefined,periodStart,periodEnd,postingStatus:postingStatus.value||undefined,page:page.value}});page.value=list.value.pagination.page}
 catch(cause:any){error.value=cause?.data?.statusMessage||'Unable to load finalized site payrolls.'}
 finally{loading.value=false}
}
function applyFilters(){page.value=1;void load()}
async function openRoster(batchId:number,refresh=false){
 rosterLoading.value=true;rosterError.value='';error.value=''
 try{
  const result=await $fetch<Roster>('/api/payroll/payslips/sites',{query:{batchId}})
  roster.value=result;selected.value=[];includeCombined.value=false
  if(!refresh){rosterSearch.value='';rosterStatus.value='';rosterPage.value=1;notice.value=''}
  await nextTick();dialog.value?.focus()
 }catch(cause:any){const message=cause?.data?.statusMessage||'Unable to load this site payroll.';if(roster.value)rosterError.value=message;else error.value=message}
 finally{rosterLoading.value=false}
}
function closeRoster(){if(busy.value||rosterLoading.value)return;roster.value=null;preview.value=null;managedEmployee.value=null;notice.value=''}
function toggle(employeeId:number){selected.value=selected.value.includes(employeeId)?selected.value.filter(id=>id!==employeeId):[...selected.value,employeeId];includeCombined.value=false}
function selectVisible(){const ids=visibleRoster.value.map(row=>row.employee.EmployeeID);selected.value=allVisibleSelected.value?selected.value.filter(id=>!ids.includes(id)):[...new Set([...selected.value,...ids])];includeCombined.value=false}
function selectFiltered(){selected.value=filteredRoster.value.map(row=>row.employee.EmployeeID);includeCombined.value=false}
async function publish(action:'post'|'withdraw'){
 if(!roster.value||busy.value||!selected.value.length||!scopeAccepted.value)return
 const changed=selectedPayslips.value.filter(item=>action==='post'?item.publicationStatus!=='Posted':item.publicationStatus==='Posted').length
 if(!changed)return
 const verb=action==='post'?'Post':'Withdraw'
 if(!confirm(verb+' '+changed+' payslip(s) for '+selected.value.length+' selected employee(s)?'+(combinedCount.value?' Combined payslips include payroll from other sites.':'')+(action==='post'?' Employees with active portal accounts can view posted payslips.':' These payslips will be removed from the employee portal.')))return
 busy.value=true;rosterError.value='';notice.value=''
 try{
  const result=await $fetch<{changed:number;unchanged:number}>('/api/payroll/payslips/sites',{method:'POST',body:{batchId:roster.value.header.BatchID,employeeIds:selected.value,reviewToken:roster.value.reviewToken,action,includeCombined:includeCombined.value}})
  notice.value=result.changed+' payslip(s) '+(action==='post'?'posted.':'withdrawn.')+(result.unchanged?' '+result.unchanged+' already had this status.':'')
  await openRoster(roster.value.header.BatchID,true);await load()
 }catch(cause:any){rosterError.value=cause?.data?.statusMessage||'Unable to change payslip posting status. Refresh and try again.'}
 finally{busy.value=false}
}
async function closeEmployee(){managedEmployee.value=null;if(roster.value)await openRoster(roster.value.header.BatchID,true);await load()}
let previousOverflow='',lastFocus:HTMLElement|null=null
watch(roster,async(value,old)=>{
 if(value&&!old){previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';lastFocus=document.activeElement as HTMLElement;await nextTick();dialog.value?.focus()}
 if(!value&&old){document.body.style.overflow=previousOverflow;lastFocus?.focus()}
})
onBeforeUnmount(()=>{if(roster.value)document.body.style.overflow=previousOverflow})
onMounted(load)
let wasDeactivated=false
onDeactivated(()=>{wasDeactivated=true;closeRoster()})
onActivated(()=>{if(wasDeactivated)void load();wasDeactivated=false})
</script>

<template>
 <section class="site-payslips">
  <header class="page-head"><div><p class="eyebrow">PAYROLL</p><h1>Payslip List by Site</h1><p>Review finalized site payrolls and post payslips for employee access.</p></div><button class="secondary" :disabled="loading" @click="load">Refresh</button></header>
  <form class="filters" @submit.prevent="applyFilters">
   <label>Search site<input v-model="search" type="search" placeholder="Site, client, agency, or DTR number"></label>
   <label>Agency<select v-model="agencyId"><option value="">All agencies</option><option v-for="agency in list.agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option></select></label>
   <label>Payroll cutoff<select v-model="cutoff"><option value="">All cutoffs</option><option v-for="item in list.cutoffs" :key="item.PeriodStart+'|'+item.PeriodEnd" :value="item.PeriodStart+'|'+item.PeriodEnd">{{ period(item) }}</option></select></label>
   <label>Posting status<select v-model="postingStatus"><option value="">All statuses</option><option value="posted">Posted</option><option value="not-posted">Not fully posted</option><option value="partial">Partially posted</option></select></label>
   <button class="primary" :disabled="loading">Search</button>
  </form>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <div class="results"><span>{{ list.pagination.total }} finalized site payrolls</span><span>Posting here also updates each employee’s Payslip profile.</span></div>
  <div class="table-wrap"><table><thead><tr><th>Site / Client</th><th>Agency</th><th>Payroll cutoff</th><th>Employees</th><th>Gross pay</th><th>Deductions</th><th>Net pay</th><th>Posting status</th><th>Action</th></tr></thead><tbody>
   <tr v-for="item in list.items" :key="item.BatchID"><td><strong>{{ item.SiteName }}</strong><small>{{ item.ClientName }} - DTR-{{ String(item.BatchID).padStart(4,'0') }}</small></td><td>{{ item.AgencyName }}</td><td class="nowrap">{{ period(item) }}</td><td>{{ item.EmployeeCount }}</td><td class="amount">{{ money(item.GrossPay) }}</td><td class="amount">{{ money(item.TotalDeduction) }}</td><td class="amount"><strong>{{ money(item.NetPay) }}</strong></td><td><span class="badge" :class="{posted:item.PublicationStatus==='Posted',partial:item.PublicationStatus==='Partially posted'}">{{ item.PublicationStatus }}</span><small>{{ item.PostedPayrollCount }} / {{ item.PayrollCount }} payroll records posted</small></td><td><button class="secondary" :disabled="rosterLoading" @click="openRoster(item.BatchID)">Review employees</button></td></tr>
   <tr v-if="!list.items.length"><td colspan="9" class="empty">{{ loading?'Loading finalized payrolls...':'No finalized site payrolls match your filters.' }}</td></tr>
  </tbody></table></div>
  <div class="pagination"><button class="secondary" :disabled="loading||page<=1" @click="page--;load()">Previous</button><span>Page {{ list.pagination.page }} of {{ list.pagination.pages }}</span><button class="secondary" :disabled="loading||page>=list.pagination.pages" @click="page++;load()">Next</button></div>

  <div v-if="roster" class="backdrop" @click.self="closeRoster">
   <section ref="dialog" class="review-modal" role="dialog" aria-modal="true" aria-labelledby="site-review-title" tabindex="-1" @keydown.esc.stop="!preview&&!managedEmployee&&closeRoster()">
    <header class="modal-head"><div><p class="eyebrow">FINALIZED SITE PAYROLL</p><h2 id="site-review-title">{{ roster.header.SiteName }}</h2><p>{{ roster.header.AgencyName }}</p><small>{{ period(roster.header) }} - DTR-{{ String(roster.header.BatchID).padStart(4,'0') }}</small></div><button class="close" aria-label="Close site payroll" :disabled="busy||rosterLoading" @click="closeRoster">&times;</button></header>
    <div class="modal-body" :aria-busy="busy||rosterLoading">
     <div class="review-summary"><div><strong>{{ roster.items.length }}</strong><span>Employees</span></div><div><strong>{{ postedCount }}</strong><span>Fully posted</span></div><div><strong>{{ roster.items.length-postedCount }}</strong><span>Not fully posted</span></div><div><strong>{{ selected.length }}</strong><span>Selected</span></div></div>
     <p class="hint">Amounts below belong to this site payroll. View each payslip to review the full employee cutoff. Portal access and recovery codes are available through Employee profile.</p>
     <p v-if="rosterError" class="error" role="alert">{{ rosterError }}</p><p v-if="notice" class="success" role="status">{{ notice }}</p>
     <form class="roster-filters" @submit.prevent><label>Search employee<input v-model="rosterSearch" type="search" placeholder="Employee name or number" @input="rosterPage=1"></label><label>Posting status<select v-model="rosterStatus" @change="rosterPage=1"><option value="">All statuses</option><option>Posted</option><option>Not Posted</option><option>Partially posted</option></select></label><button class="secondary" type="button" :disabled="busy||rosterLoading" @click="openRoster(roster.header.BatchID,true)">Refresh review</button></form>
     <div v-if="roster.canPost" class="selection-tools"><button class="text-button" :disabled="busy||rosterLoading" @click="selectFiltered">Select all filtered ({{ filteredRoster.length }})</button><button class="text-button" :disabled="busy||rosterLoading||!selected.length" @click="selected=[];includeCombined=false">Clear selection</button><span>{{ selected.length }} selected across all pages</span></div>
     <div class="table-wrap roster-table"><table><thead><tr><th v-if="roster.canPost"><input type="checkbox" aria-label="Select visible employees" :checked="allVisibleSelected" :disabled="busy||rosterLoading||!visibleRoster.length" @change="selectVisible"></th><th>Employee</th><th>Site gross</th><th>Site deductions</th><th>Site net pay</th><th>Payslips / Posting status</th><th>Action</th></tr></thead><tbody>
      <tr v-for="row in visibleRoster" :key="row.employee.EmployeeID"><td v-if="roster.canPost"><input type="checkbox" :aria-label="'Select '+row.employee.EmployeeName" :checked="selected.includes(row.employee.EmployeeID)" :disabled="busy||rosterLoading" @change="toggle(row.employee.EmployeeID)"></td><td><strong>{{ row.employee.EmployeeName }}</strong><small>{{ number(row.employee) }} - {{ row.employee.PositionName }}</small></td><td class="amount">{{ money(siteTotal(row,'gross')) }}</td><td class="amount">{{ money(siteTotal(row,'deductions')) }}</td><td class="amount"><strong>{{ money(siteTotal(row,'net')) }}</strong></td><td><div v-for="item in row.cutoffs" :key="item.key" class="payslip-status"><span class="badge" :class="{posted:item.publicationStatus==='Posted'}">{{ item.publicationStatus }}</span><small>{{ item.assignmentType }} - {{ sourceNames(item) }}</small><strong v-if="combined(row)" class="combined-label">Includes other site payroll</strong></div></td><td><div class="row-actions"><button v-for="item in row.cutoffs" :key="item.key" class="secondary" :disabled="busy||rosterLoading" @click="preview={employee:row.employee,cutoff:item}">View payslip{{ row.cutoffs.length>1?' - '+item.assignmentType:'' }}</button><button class="text-button" :disabled="busy||rosterLoading" @click="managedEmployee=row.employee">Employee profile</button></div></td></tr>
      <tr v-if="!visibleRoster.length"><td :colspan="roster.canPost?7:6" class="empty">No employees match your filters.</td></tr>
     </tbody></table></div>
     <div v-if="rosterPages>1" class="pagination"><button class="secondary" :disabled="rosterPage<=1" @click="rosterPage--">Previous</button><span>Page {{ rosterPage }} of {{ rosterPages }}</span><button class="secondary" :disabled="rosterPage>=rosterPages" @click="rosterPage++">Next</button></div>
     <label v-if="combinedCount" class="combined-notice"><input v-model="includeCombined" type="checkbox" :disabled="busy||rosterLoading"><span>{{ combinedCount }} selected employee(s) have a combined payslip. I understand that posting or withdrawing affects the entire payslip, including payroll from other sites shown above.</span></label>
    </div>
    <footer class="modal-footer"><span>{{ selected.length }} employee(s) - {{ selectedPayslips.length }} payslip(s) selected</span><div><button class="secondary" :disabled="busy||rosterLoading" @click="closeRoster">Close</button><template v-if="roster.canPost"><button class="secondary" :disabled="busy||rosterLoading||!canWithdrawSelected||!scopeAccepted" @click="publish('withdraw')">Withdraw selected</button><button class="primary" :disabled="busy||rosterLoading||!canPostSelected||!scopeAccepted" @click="publish('post')">{{ busy?'Saving...':'Post selected payslips' }}</button></template></div></footer>
   </section>
  </div>
  <div v-if="preview" class="backdrop preview-backdrop" @click.self="preview=null"><section class="preview-modal" role="dialog" aria-modal="true" aria-label="Payslip preview" @keydown.esc.stop="preview=null"><header class="modal-head"><div><p class="eyebrow">PAYSLIP PREVIEW</p><h2>{{ preview.employee.EmployeeName }}</h2></div><button class="close" aria-label="Close payslip preview" @click="preview=null">&times;</button></header><div class="modal-body"><EmployeePayslipSheet :employee="preview.employee" :cutoff="preview.cutoff" /></div></section></div>
  <PayslipPage v-if="managedEmployee" :employee="managedEmployee" embedded @close="closeEmployee" />
 </section>
</template>

<style scoped>
.site-payslips{--ink:#112b53;--muted:#657d9f;--line:#d5e1f2;color:var(--ink);padding:34px 36px 48px;font-family:Inter,'Segoe UI',sans-serif}.site-payslips *{box-sizing:border-box}.page-head,.modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.eyebrow{margin:0;color:#2863db;font-size:.72rem;font-weight:800;letter-spacing:.09em}h1{margin:6px 0;font-size:2rem}h2{margin:6px 0;font-size:1.5rem;overflow-wrap:anywhere}.page-head p:not(.eyebrow),.modal-head p:not(.eyebrow){color:var(--muted);margin:4px 0}.primary,.secondary,.text-button,.close{font:inherit;font-weight:700;cursor:pointer}.primary,.secondary{min-height:44px;padding:10px 15px;border-radius:9px;white-space:nowrap}.primary{border:1px solid #2864e8;background:#2864e8;color:#fff}.secondary{border:1px solid #c8d7ed;background:#fff;color:#1b4b91}.text-button{border:0;background:transparent;color:#235fd1;padding:8px 0;text-align:left;font-size:.78rem}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #a9c3ff;outline-offset:2px}label{display:grid;gap:7px;font-weight:650;font-size:.78rem;color:#3b5478;min-width:0}input:not([type=checkbox]),select{font:inherit;font-size:.85rem;width:100%;min-height:46px;border:1px solid #cbd9ee;border-radius:9px;padding:10px 12px;background:#fff;color:var(--ink);min-width:0}input[type=checkbox]{width:18px;height:18px;accent-color:#2864e8;cursor:pointer;flex:none}.filters{display:grid;grid-template-columns:minmax(200px,1.4fr) minmax(160px,1fr) minmax(200px,1.1fr) minmax(150px,.8fr) auto;gap:12px;align-items:end;margin:26px 0 18px}.results{display:flex;justify-content:space-between;gap:12px;margin:14px 0;color:var(--muted);font-size:.78rem}.table-wrap{max-width:100%;overflow:auto;background:#fff;border:1px solid var(--line);border-radius:13px}table{border-collapse:collapse;width:100%}th,td{padding:15px 16px;text-align:left;border-bottom:1px solid #e5edf8;font-size:.8rem}th{background:#f3f7fc;color:#526c92;font-size:.66rem;text-transform:uppercase;letter-spacing:.025em}td strong,td small{display:block}td small{color:var(--muted);font-size:.72rem;margin-top:5px;line-height:1.5}tbody tr:last-child td{border-bottom:0}.amount{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}.nowrap{white-space:nowrap}.badge{display:inline-block;border-radius:24px;background:#fff0d5;color:#8c5c00;padding:6px 10px;font-size:.72rem;font-weight:750;white-space:nowrap}.badge.posted{background:#ddf8ea;color:#137844}.badge.partial{background:#e9f0ff;color:#2054b2}.pagination{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:16px;font-size:.78rem;color:var(--muted)}.error,.success{padding:12px;border-radius:9px;font-size:.84rem;line-height:1.5}.error{background:#fff1f1;border:1px solid #fecaca;color:#9c2525}.success{background:#eafaf1;border:1px solid #b2e0c4;color:#14653b}.empty{text-align:center;padding:32px;color:var(--muted)}.backdrop{position:fixed;inset:0;z-index:1100;background:rgba(20,36,64,.52);display:flex;align-items:center;justify-content:center;padding:24px}.review-modal,.preview-modal{display:flex;flex-direction:column;width:min(1480px,100%);max-height:calc(100dvh - 48px);background:#fff;border:1px solid var(--line);border-radius:20px;box-shadow:0 25px 75px rgba(9,31,75,.28);overflow:hidden;outline:none}.modal-head{padding:24px 28px;border-bottom:1px solid var(--line);flex-shrink:0}.modal-head small{color:var(--muted);font-size:.8rem}.close{display:grid;place-items:center;flex:none;width:38px;height:38px;border:1px solid var(--line);border-radius:50%;background:#fff;color:#526c92;font-size:1.4rem}.modal-body{padding:24px 28px;overflow:auto;min-height:0;background:#f8faff}.review-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.review-summary>div{padding:16px 18px;background:#fff;border:1px solid var(--line);border-radius:12px}.review-summary strong{display:block;font-size:1.5rem}.review-summary span{display:block;margin-top:4px;color:var(--muted);font-size:.75rem}.hint{color:var(--muted);font-size:.8rem;line-height:1.6;margin:16px 0}.roster-filters{display:grid;grid-template-columns:1fr 230px auto;gap:12px;align-items:end;margin:20px 0 10px}.selection-tools{display:flex;flex-wrap:wrap;align-items:center;gap:18px;margin:10px 0}.selection-tools span{font-size:.76rem;color:var(--muted)}.row-actions{display:grid;gap:6px;justify-items:start}.payslip-status+.payslip-status{margin-top:12px}.combined-label{color:#986000;font-size:.69rem;margin-top:5px}.combined-notice{display:flex;align-items:flex-start;gap:10px;line-height:1.7;padding:16px;background:#fff7e5;border:1px solid #efd7a3;border-radius:10px;margin-top:18px;color:#80530b;font-size:.8rem}.modal-footer{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:18px 28px;background:#fff;border-top:1px solid var(--line);flex-shrink:0}.modal-footer>span{font-size:.8rem;color:var(--muted)}.modal-footer>div{display:flex;gap:10px;flex-wrap:wrap}.preview-backdrop{z-index:1150}.preview-modal{width:min(1320px,100%)}
@media(max-width:1200px){.filters{grid-template-columns:1fr 1fr}.filters>.primary{justify-self:start}.results{flex-direction:column;gap:6px}}@media(max-width:700px){.site-payslips{padding:22px 16px 36px}.page-head{gap:12px}h1{font-size:1.5rem}.page-head p:not(.eyebrow){font-size:.85rem;line-height:1.5}.filters,.roster-filters{grid-template-columns:1fr}.backdrop{padding:8px}.review-modal,.preview-modal{max-height:calc(100dvh - 16px);border-radius:14px}.modal-head,.modal-body{padding:18px 14px}.review-summary{grid-template-columns:1fr 1fr;gap:8px}.review-summary>div{padding:12px}.modal-footer{padding:14px;flex-direction:column;align-items:stretch;gap:10px}.modal-footer>div{display:grid;grid-template-columns:1fr 1fr}.modal-footer .primary{grid-column:1/-1}.modal-footer .secondary{padding:10px 7px;font-size:.76rem}.pagination{justify-content:center;font-size:.73rem;gap:8px}.pagination .secondary{padding:10px}.preview-modal h2{font-size:1.15rem}}@media(prefers-reduced-motion:no-preference){button{transition:background-color .15s,opacity .15s}}
</style>
