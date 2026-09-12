<script setup lang="ts">
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import DtrAttendanceWorkspace from '~/components/DtrAttendanceWorkspace.vue'
type Agency={AgencyID:number,AgencyName:string}; type Client={AgencyID:number,ClientID:number,ClientName:string}; type Site={SiteID:number,ClientID:number,SiteName:string}; type Dtr={BatchID:number,AgencyID:number,AgencyName:string,ClientID:number,ClientName:string,SiteID:number,SiteName:string,PeriodStart:string,PeriodEnd:string,Status:string,CreatedAt:string,PeopleCount:number}
const now=new Date(), selectedYear=ref(String(now.getFullYear())), selectedCutoff=ref(''), search=ref(''), agencyId=ref(''), clientId=ref(''), siteId=ref(''), items=ref<Dtr[]>([]), agencies=ref<Agency[]>([]), clients=ref<Client[]>([]), sites=ref<Site[]>([]), loading=ref(false), saving=ref(false), error=ref(''), formOpen=ref(false), editing=ref<Dtr|null>(null), workspace=ref<Dtr|null>(null), summaryOpen=ref(false), summary=ref<any>(null)
const form=reactive({AgencyID:'',ClientID:'',SiteID:'',PeriodStart:'',PeriodEnd:''})
function cutoffOptions(year:number){return Array.from({length:12},(_,m)=>{const name=new Date(year,m).toLocaleString('en-PH',{month:'long'}), last=new Date(year,m+1,0).getDate(),p=`${year}-${String(m+1).padStart(2,'0')}`;return[{value:`${p}-01:${p}-15`,label:`${name} 1–15, ${year}`},{value:`${p}-16:${p}-${last}`,label:`${name} 16–${last}, ${year}`}]}).flat()}
const yearOptions=computed(()=>Array.from({length:5},(_,i)=>String(now.getFullYear()-2+i))), cutoffs=computed(()=>cutoffOptions(Number(selectedYear.value))), cutoffLabel=computed(()=>cutoffs.value.find(c=>c.value===selectedCutoff.value)?.label||'Choose a cutoff'), period=computed(()=>selectedCutoff.value.split(':'))
const availableClients=computed(()=>clients.value.filter(c=>!agencyId.value||String(c.AgencyID)===agencyId.value)), availableSites=computed(()=>sites.value.filter(s=>!clientId.value||String(s.ClientID)===clientId.value)), formClients=computed(()=>clients.value.filter(c=>String(c.AgencyID)===form.AgencyID)), formSites=computed(()=>sites.value.filter(s=>String(s.ClientID)===form.ClientID))
function currentCutoff(){const y=now.getFullYear(),m=now.getMonth()+1,start=now.getDate()<=15?1:16,end=start===1?15:new Date(y,m,0).getDate(),p=`${y}-${String(m).padStart(2,'0')}`;return `${p}-${String(start).padStart(2,'0')}:${p}-${end}`}
async function load(){loading.value=true;error.value='';try{const query:Record<string,string>={};if(search.value)query.search=search.value;if(agencyId.value)query.agencyId=agencyId.value;if(clientId.value)query.clientId=clientId.value;if(siteId.value)query.siteId=siteId.value;if(period.value[0])query.periodStart=period.value[0];if(period.value[1])query.periodEnd=period.value[1];const r=await $fetch<any>('/api/attendance/dtr',{query});items.value=r.items||[];agencies.value=r.agencies||[];clients.value=r.clients||[];sites.value=r.sites||[]}catch(e:any){error.value=e?.data?.statusMessage||e?.message||'Unable to load Daily Time Records.'}finally{loading.value=false}}
function openCreate(){editing.value=null;Object.assign(form,{AgencyID:agencyId.value,ClientID:clientId.value,SiteID:siteId.value,PeriodStart:period.value[0]||'',PeriodEnd:period.value[1]||''});error.value='';formOpen.value=true}function openEdit(i:Dtr){workspace.value=i}
async function save(){saving.value=true;error.value='';try{const body={AgencyID:Number(form.AgencyID),ClientID:Number(form.ClientID),SiteID:Number(form.SiteID),PeriodStart:form.PeriodStart,PeriodEnd:form.PeriodEnd};if(editing.value)await $fetch(`/api/attendance/dtr/${editing.value.BatchID}`,{method:'PUT',body});else await $fetch('/api/attendance/dtr',{method:'POST',body});formOpen.value=false;await load()}catch(e:any){error.value=e?.data?.statusMessage||e?.message||'Unable to save DTR.'}finally{saving.value=false}}
async function remove(i:Dtr){if(!confirm(`Delete DTR-${i.BatchID}? This cannot be undone.`))return;try{await $fetch(`/api/attendance/dtr/${i.BatchID}`,{method:'DELETE'});await load()}catch(e:any){error.value=e?.data?.statusMessage||e?.message||'Unable to delete DTR.'}}
async function compute(i:Dtr,target:'payroll'|'billing'){try{await $fetch(`/api/attendance/dtr/${i.BatchID}/compute`,{method:'POST',body:{target}});await load()}catch(e:any){error.value=e?.data?.statusMessage||e?.message||'Unable to compute DTR.'}}
async function viewSummary(i:Dtr){try{summary.value={item:i,...(await $fetch<any>(`/api/attendance/dtr/${i.BatchID}/summary`))};summaryOpen.value=true}catch(e:any){error.value=e?.data?.statusMessage||e?.message||'Unable to load DTR summary.'}}
function formatDate(v:string){return new Date(v).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}function canEdit(i:Dtr){return !['Approved','Locked'].includes(i.Status)&&!i.Status.startsWith('Computed')}
watch(selectedYear,()=>{selectedCutoff.value=selectedYear.value===String(now.getFullYear())?currentCutoff():cutoffs.value[0]?.value||''});watch(agencyId,()=>{clientId.value='';siteId.value=''});watch(clientId,()=>siteId.value='');selectedCutoff.value=currentCutoff();onMounted(load);useRealtimeRefresh(load)
function formatPeriod(start:string,end:string){
  const first=new Date(start),last=new Date(end)
  return first.getFullYear()===last.getFullYear()&&first.getMonth()===last.getMonth()
    ?first.toLocaleDateString('en-PH',{month:'short'})+' '+first.getDate()+'–'+last.getDate()+', '+last.getFullYear()
    :formatDate(start)+' – '+formatDate(end)
}
function closeActions(event:Event,restoreFocus=false){
  const menu=(event.target as HTMLElement).closest('details')
  menu?.removeAttribute('open')
  if(restoreFocus)menu?.querySelector('summary')?.focus()
}
function blurActions(event:FocusEvent){
  if(!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node|null))closeActions(event)
}
</script>
<template><section class="dtr-page"><div class="dtr-heading"><div><p class="eyebrow">ATTENDANCE</p><h1>Daily Time Records</h1><p>Review and prepare employee attendance per payroll cutoff.</p></div><button class="primary" @click="openCreate">+ Create DTR</button></div><form class="filters" @submit.prevent="load"><input aria-label="Search DTRs" v-model.trim="search" type="search" placeholder="Search client, site, or DTR ID"><select aria-label="Agency" v-model="agencyId"><option value="">All agencies</option><option v-for="a in agencies" :key="a.AgencyID" :value="String(a.AgencyID)">{{a.AgencyName}}</option></select><select aria-label="Client" v-model="clientId"><option value="">All clients</option><option v-for="c in availableClients" :key="`${c.AgencyID}-${c.ClientID}`" :value="String(c.ClientID)">{{c.ClientName}}</option></select><select aria-label="Year" class="year-filter" v-model="selectedYear"><option v-for="y in yearOptions" :key="y">{{y}}</option></select><select aria-label="Cutoff" class="cutoff-filter" v-model="selectedCutoff"><option v-for="c in cutoffs" :key="c.value" :value="c.value">{{c.label}}</option></select><button class="primary">Search</button></form><p class="period">Selected cutoff: <strong>{{cutoffLabel}}</strong></p><p v-if="error" class="error">{{error}}</p>
<div class="dtr-list-panel" :aria-busy="loading">
  <table class="dtr-list-table">
    <colgroup><col class="identity-col"><col class="site-col"><col class="period-col"><col class="status-col"><col class="action-col"></colgroup>
    <thead><tr><th scope="col">DTR / Agency</th><th scope="col">Client / Site</th><th scope="col">Cutoff</th><th scope="col">People / Status</th><th scope="col" class="action-heading">Actions</th></tr></thead>
    <tbody>
      <tr v-for="i in items" :key="i.BatchID" class="dtr-list-row">
        <td data-label="DTR / Agency"><strong class="cell-title">DTR-{{String(i.BatchID).padStart(4,'0')}}</strong><span class="cell-detail">{{i.AgencyName}}</span></td>
        <td data-label="Client / Site"><strong class="cell-title">{{i.ClientName}}</strong><span class="cell-detail">{{i.SiteName}}</span></td>
        <td data-label="Cutoff"><strong class="cell-title">{{formatPeriod(i.PeriodStart,i.PeriodEnd)}}</strong><span class="cell-detail">Created {{formatDate(i.CreatedAt)}}</span></td>
        <td data-label="People / Status"><span class="people-count">{{i.PeopleCount}} {{Number(i.PeopleCount)===1?'person':'people'}}</span><span class="status">{{i.Status}}</span></td>
        <td class="dtr-action-cell">
          <div class="dtr-row-actions">
            <button class="secondary" :disabled="!canEdit(i)" :aria-label="'Edit DTR-'+String(i.BatchID).padStart(4,'0')" @click="openEdit(i)">Edit</button>
            <details class="dtr-action-menu" @keydown.esc.prevent="closeActions($event,true)" @focusout="blurActions">
              <summary class="secondary" :aria-label="'More actions for DTR-'+String(i.BatchID).padStart(4,'0')">More <span aria-hidden="true">⌄</span></summary>
              <div class="dtr-action-options" @click="closeActions($event)">
                <button type="button" @click="viewSummary(i)">View Summary DTR</button>
                <button type="button" @click="compute(i,'payroll')">Compute to payroll</button>
                <button type="button" @click="compute(i,'billing')">Compute to billing</button>
                <button type="button" class="delete-action" :disabled="!canEdit(i)" @click="remove(i)">Delete DTR</button>
              </div>
            </details>
          </div>
        </td>
      </tr>
      <tr v-if="!loading&&!items.length"><td colspan="5" class="empty">No Daily Time Records for this search and cutoff.</td></tr>
      <tr v-if="loading"><td colspan="5" class="empty">Loading Daily Time Records…</td></tr>
    </tbody>
  </table>
</div>
<div v-if="formOpen" class="overlay" @click.self="formOpen=false"><form class="modal" @submit.prevent="save"><button class="close" type="button" @click="formOpen=false">×</button><h2>Create DTR</h2><p>Create one DTR batch per agency, site, and payroll cutoff.</p><div class="grid"><label>Agency<select v-model="form.AgencyID" required @change="form.ClientID='';form.SiteID=''"><option disabled value="">Select agency</option><option v-for="a in agencies" :key="a.AgencyID" :value="String(a.AgencyID)">{{a.AgencyName}}</option></select></label><label>Client<select v-model="form.ClientID" required :disabled="!form.AgencyID" @change="form.SiteID=''"><option disabled value="">Select client</option><option v-for="c in formClients" :key="`${c.AgencyID}-${c.ClientID}`" :value="String(c.ClientID)">{{c.ClientName}}</option></select></label><label>Site<select v-model="form.SiteID" required :disabled="!form.ClientID"><option disabled value="">Select site</option><option v-for="s in formSites" :key="s.SiteID" :value="String(s.SiteID)">{{s.SiteName}}</option></select></label><label>Period start<input v-model="form.PeriodStart" type="date" required></label><label>Period end<input v-model="form.PeriodEnd" type="date" required></label></div><p v-if="error" class="error">{{error}}</p><div class="modal-actions"><button class="secondary" type="button" @click="formOpen=false">Cancel</button><button class="primary" :disabled="saving">{{saving?'Saving…':'Save DTR'}}</button></div></form></div><div v-if="summaryOpen&&summary" class="overlay" @click.self="summaryOpen=false"><section class="modal"><button class="close" @click="summaryOpen=false">×</button><h2>DTR Summary</h2><p><strong>{{summary.item.ClientName}}</strong> · {{summary.item.SiteName}}<br>{{formatDate(summary.item.PeriodStart)}}–{{formatDate(summary.item.PeriodEnd)}}</p><dl><div><dt>Employees</dt><dd>{{summary.summary.PeopleCount}}</dd></div><div><dt>Attendance entries</dt><dd>{{summary.summary.AttendanceCount}}</dd></div><div><dt>Regular hours</dt><dd>{{summary.summary.RegularHours}}</dd></div><div><dt>OT hours</dt><dd>{{summary.summary.OTHours}}</dd></div><div><dt>Night diff hours</dt><dd>{{summary.summary.NightDiffHours}}</dd></div></dl><div class="modal-actions"><button class="secondary" @click="summaryOpen=false">Close</button></div></section></div><DtrAttendanceWorkspace v-if="workspace" :dtr="workspace" @close="workspace=null" @changed="load" /></section></template>
<style>
.dtr-page { width: 100%; min-width: 0; max-width: 1420px; margin: 0 auto; container-type: inline-size; }
.dtr-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 24px; }
.dtr-page .eyebrow { margin: 0 0 7px; color: #4f79bd; font-weight: 800; font-size: 12px; letter-spacing: .09em; }
.dtr-page h1, .dtr-page h2 { margin: 0; color: #122c57; }.dtr-page h1 { font-size: 30px; }
.dtr-heading p:not(.eyebrow), .dtr-page .modal > p { margin: 7px 0 0; color: #60718f; }
.dtr-page .primary, .dtr-page .secondary, .dtr-page .danger { border: 1px solid #d2ddef; border-radius: 8px; padding: 10px 14px; font: inherit; font-weight: 700; cursor: pointer; background: #fff; color: #1947cd; }
.dtr-page .primary { background: #2867d8; color: #fff; border-color: #2867d8; }.dtr-page .danger { color: #b42318; }
.dtr-page .primary:disabled, .dtr-page .secondary:disabled, .dtr-page .danger:disabled { opacity: .45; cursor: not-allowed; }
.dtr-page .filters { display: grid; grid-template-columns: minmax(180px,1.4fr) repeat(2,minmax(130px,1fr)) 90px minmax(205px,1.1fr) auto; gap: 10px; }
.dtr-page .filters > * { min-width: 0; }
.dtr-page .filters input, .dtr-page .filters select, .dtr-page .modal input, .dtr-page .modal select { box-sizing: border-box; width: 100%; min-height: 43px; border: 1px solid #cfd9e9; border-radius: 8px; background: #fff; color: #223a60; font: inherit; padding: 0 12px; }
.dtr-page .period { margin: 15px 0; color: #5d6d88; }.dtr-page .error { color: #b42318; }
.dtr-page .dtr-list-panel { border: 1px solid #dce5f1; border-radius: 12px; background: #fff; }
.dtr-page .dtr-list-table { width: 100%; min-width: 0; table-layout: fixed; border-collapse: separate; border-spacing: 0; font-size: 14px; }
.dtr-page .identity-col, .dtr-page .site-col { width: auto; }.dtr-page .period-col { width: 200px; }.dtr-page .status-col { width: 140px; }.dtr-page .action-col { width: 158px; }
.dtr-page .dtr-list-table th, .dtr-page .dtr-list-table td { padding: 14px 16px; text-align: left; vertical-align: middle; border-bottom: 1px solid #e6edf7; white-space: normal; overflow-wrap: anywhere; }
.dtr-page .dtr-list-table th { color: #536987; font-size: 12px; font-weight: 700; background: #f7f9fd; }
.dtr-page .dtr-list-table th:first-child { border-radius: 12px 0 0 0; }.dtr-page .dtr-list-table th:last-child { border-radius: 0 12px 0 0; }
.dtr-page .dtr-list-table tr:last-child td { border-bottom: 0; }
.dtr-page .cell-title { display: block; color: #18365f; font-size: 14px; font-weight: 700; line-height: 1.5; }
.dtr-page .cell-detail { display: block; margin-top: 3px; color: #64738d; font-size: 12px; line-height: 1.5; }
.dtr-page .people-count { display: block; margin-bottom: 6px; color: #28446e; }
.dtr-page .dtr-list-table .empty { text-align: center; color: #64738d; padding: 36px 16px; }
.dtr-page .status { display: inline-block; padding: 4px 9px; border-radius: 999px; background: #e8efff; color: #2548c8; font-size: 12px; font-weight: 800; }
.dtr-page .dtr-list-table .action-heading { text-align: right; }
.dtr-page .dtr-row-actions { display: flex; justify-content: flex-end; align-items: center; gap: 6px; }
.dtr-page .dtr-row-actions .secondary { box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 5px; min-height: 38px; padding: 7px 10px; font-size: 13px; white-space: nowrap; }
.dtr-page .dtr-action-menu { position: relative; }
.dtr-page .dtr-action-menu summary { list-style: none; }.dtr-page .dtr-action-menu summary::-webkit-details-marker { display: none; }
.dtr-page .dtr-action-menu[open] summary { background: #eef4ff; border-color: #9ebbee; }
.dtr-page .dtr-action-options { position: absolute; z-index: 5; top: calc(100% + 6px); right: 0; width: 205px; padding: 5px; background: #fff; border: 1px solid #cfd9e9; border-radius: 10px; box-shadow: 0 9px 24px rgba(22,42,75,.16); }
.dtr-page .dtr-action-options button { display: block; box-sizing: border-box; width: 100%; min-height: 40px; padding: 10px; border: 0; border-radius: 5px; background: #fff; color: #24416b; text-align: left; font: inherit; font-size: 13px; cursor: pointer; }
.dtr-page .dtr-action-options button:hover, .dtr-page .dtr-action-options button:focus-visible { background: #f1f5ff; }
.dtr-page .dtr-action-options .delete-action { margin-top: 4px; border-top: 1px solid #e6edf7; border-radius: 0 0 5px 5px; color: #b42318; }
.dtr-page .dtr-action-options button:disabled { opacity: .45; cursor: not-allowed; }
.dtr-page .dtr-row-actions :focus-visible { outline: 2px solid #2867d8; outline-offset: 2px; }
.dtr-page .overlay { position: fixed; z-index: 30; inset: 0; display: grid; place-items: center; padding: 20px; background: rgba(15,27,52,.52); }.dtr-page .modal { position: relative; width: min(650px,100%); box-sizing: border-box; padding: 28px; border-radius: 15px; background: #fff; }.dtr-page .close { position: absolute; right: 18px; top: 12px; border: 0; background: none; font-size: 25px; cursor: pointer; }.dtr-page .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 20px; }.dtr-page .grid label { color: #3f5271; font-size: 13px; font-weight: 700; }.dtr-page .grid input, .dtr-page .grid select { margin-top: 6px; }.dtr-page .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }.dtr-page dl { display: grid; grid-template-columns: repeat(2,1fr); gap: 10px; margin: 22px 0; }.dtr-page dl div { padding: 12px; border: 1px solid #dae4f3; border-radius: 8px; }.dtr-page dt { color: #667793; font-size: 12px; }.dtr-page dd { margin: 6px 0 0; color: #183965; font-weight: 800; }
@container (max-width: 1100px) {
  .dtr-page .filters { grid-template-columns: repeat(4,minmax(0,1fr)); }
  .dtr-page .filters input { grid-column: span 2; }
  .dtr-page .filters .cutoff-filter { grid-column: span 2; }
}
@container (max-width: 850px) {
  .dtr-page .dtr-list-panel { border: 0; background: transparent; }
  .dtr-page .dtr-list-table, .dtr-page .dtr-list-table tbody { display: block; }
  .dtr-page .dtr-list-table colgroup { display: none; }
  .dtr-page .dtr-list-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .dtr-page .dtr-list-row { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); margin-bottom: 12px; padding: 8px; border: 1px solid #dce5f1; border-radius: 12px; background: #fff; }
  .dtr-page .dtr-list-table td { display: block; min-width: 0; border: 0; padding: 10px; }
  .dtr-page .dtr-list-table td[data-label]::before { content: attr(data-label); display: block; margin-bottom: 5px; color: #64738d; font-size: 11px; font-weight: 700; }
  .dtr-page .dtr-list-table .dtr-action-cell { grid-column: 1 / -1; border-top: 1px solid #e6edf7; margin-top: 5px; }
  .dtr-page .dtr-row-actions .secondary { min-height: 42px; padding-inline: 16px; }
}
@container (max-width: 550px) {
  .dtr-page .dtr-heading { flex-wrap: wrap; gap: 14px; }
  .dtr-page .dtr-heading h1 { font-size: 25px; }
  .dtr-page .filters { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .dtr-page .filters input, .dtr-page .filters .cutoff-filter { grid-column: 1 / -1; }
  .dtr-page .filters .year-filter { grid-row: 4; grid-column: 1; }
}
@media (max-width:650px) { .dtr-page .grid { grid-template-columns: 1fr; } }
</style>
