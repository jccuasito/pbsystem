<script setup lang="ts">
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'

type Day = {AttendanceID:number;EmployeeID:number;EmployeeNumber:string|null;EmployeeName:string;BatchID:number;DtrStatus:string;AgencyName:string;ClientName:string;SiteName:string;SiteAttendanceType:'Regular'|'Reliever';AttendanceDate:string;AttendanceStatus:string;RegularHours:number;OTHours:number;OTExtHours:number;RestDayHours:number;RestDayOTHours:number;NightDiffHours:number;TimeIn:string|null;TimeOut:string|null;ShiftCode:string|null;PositionName:string}
type Totals = {days:number;hours:number;ot:number;sites:number}
type Group = {employee:Day;entries:Day[];fixed:Totals;relief:Totals;combined:Totals}
const today=new Date()
const year=ref(String(today.getFullYear()))
const cutoff=ref(`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${today.getDate()<=15?'01':'16'}`)
const agencyId=ref(''),search=ref(''),loading=ref(false),error=ref(''),selectedEmployeeId=ref<number|null>(null)
const rows=ref<Day[]>([]),agencies=ref<{AgencyID:number;AgencyName:string}[]>([])
const years=computed(()=>Array.from({length:5},(_,i)=>String(today.getFullYear()-2+i)))
const cutoffs=computed(()=>Array.from({length:12},(_,m)=>{const prefix=`${year.value}-${String(m+1).padStart(2,'0')}`,label=new Date(Number(year.value),m,1).toLocaleString('en-PH',{month:'long'}),last=new Date(Number(year.value),m+1,0).getDate();return[{start:`${prefix}-01`,end:`${prefix}-15`,label:`${label} 1–15, ${year.value}`},{start:`${prefix}-16`,end:`${prefix}-${last}`,label:`${label} 16–${last}, ${year.value}`}]}).flat())
const selected=computed(()=>cutoffs.value.find(item=>item.start===cutoff.value))
function totals(entries:Day[]):Totals{return{days:new Set(entries.map(day=>day.AttendanceDate)).size,hours:entries.reduce((sum,day)=>sum+Number(day.RegularHours||0)+Number(day.OTHours||0)+Number(day.OTExtHours||0),0),ot:entries.reduce((sum,day)=>sum+Number(day.OTHours||0)+Number(day.OTExtHours||0),0),sites:new Set(entries.map(day=>`${day.ClientName}\u0000${day.SiteName}`)).size}}
const allGroups=computed<Group[]>(()=>{const map=new Map<number,Day[]>();for(const day of rows.value){const entries=map.get(day.EmployeeID)||[];entries.push(day);map.set(day.EmployeeID,entries)}return[...map.values()].map(entries=>{const fixed=entries.filter(day=>day.SiteAttendanceType!=='Reliever'),relief=entries.filter(day=>day.SiteAttendanceType==='Reliever');return{employee:entries[0]!,entries,fixed:totals(fixed),relief:totals(relief),combined:totals(entries)}})})
const groups=computed(()=>{const term=search.value.trim().toLowerCase();return term?allGroups.value.filter(group=>[group.employee.EmployeeName,group.employee.EmployeeNumber,`EMP-${String(group.employee.EmployeeID).padStart(4,'0')}`,group.employee.AgencyName,...group.entries.flatMap(day=>[day.ClientName,day.SiteName])].some(value=>String(value||'').toLowerCase().includes(term))):allGroups.value})
const reliefDays=computed(()=>groups.value.reduce((sum,group)=>sum+group.relief.days,0))
const selectedGroup=computed(()=>allGroups.value.find(group=>group.employee.EmployeeID===selectedEmployeeId.value))
function closeDetails(){selectedEmployeeId.value=null}
function onKeydown(event:KeyboardEvent){if(event.key==='Escape')closeDetails()}
function dayLabel(value:string){return new Date(value+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}
function hours(value:number){return Number(value||0).toFixed(2)}
async function load(){if(!selected.value)return;loading.value=true;error.value='';try{const result=await $fetch<{rows:Day[];agencies:{AgencyID:number;AgencyName:string}[]}>('/api/attendance/dtr/relievers',{query:{periodStart:selected.value.start,periodEnd:selected.value.end,agencyId:agencyId.value||undefined}});rows.value=result.rows||[];agencies.value=result.agencies||[]}catch(cause:any){error.value=cause?.data?.statusMessage||'Unable to load reliever attendance.'}finally{loading.value=false}}
watch(year,()=>{cutoff.value=`${year.value}-01-01`})
watch([cutoff,agencyId],()=>{closeDetails();load()})
onMounted(()=>{load();window.addEventListener('keydown',onKeydown)})
onBeforeUnmount(()=>window.removeEventListener('keydown',onKeydown))
useRealtimeRefresh(load)
</script>

<template>
  <section class="reliever-page">
    <header>
      <p class="eyebrow">ATTENDANCE</p>
      <h1>DTR Reliever</h1>
      <p>Combined regular-site and reliever attendance for each employee. Open a DTR to see the original site entries.</p>
    </header>

    <div class="filters">
      <label>Year<select v-model="year"><option v-for="item in years" :key="item" :value="item">{{ item }}</option></select></label>
      <label>Cutoff<select v-model="cutoff"><option v-for="item in cutoffs" :key="item.start" :value="item.start">{{ item.label }}</option></select></label>
      <label>Agency<select v-model="agencyId"><option value="">All agencies</option><option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option></select></label>
      <label>Search<input v-model="search" type="search" placeholder="Employee or site"></label>
    </div>

    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p class="count" role="status">{{ loading ? 'Loading...' : `${groups.length} reliever${groups.length === 1 ? '' : 's'} / ${reliefDays} reliever day${reliefDays === 1 ? '' : 's'}` }}</p>
    <div v-if="!loading && !groups.length && !error" class="empty">No reliever work was recorded for the selected cutoff.</div>

    <div v-if="groups.length" class="table-wrap">
      <table class="summary-table">
        <thead><tr><th>Employee</th><th>Regular site</th><th>Reliever sites</th><th>Combined total</th><th class="action-head">DTR</th></tr></thead>
        <tbody>
          <tr v-for="group in groups" :key="group.employee.EmployeeID">
            <td class="employee"><strong>{{ group.employee.EmployeeName }}</strong><small>EMP-{{ String(group.employee.EmployeeID).padStart(4, '0') }} · {{ group.employee.EmployeeNumber || 'No employee number' }} · {{ group.employee.AgencyName }} · {{ group.employee.PositionName }}</small></td>
            <td><strong>{{ group.fixed.days }} {{ group.fixed.days === 1 ? 'day' : 'days' }}</strong><small>{{ hours(group.fixed.hours) }} hrs</small></td>
            <td><strong>{{ group.relief.days }} {{ group.relief.days === 1 ? 'day' : 'days' }}</strong><small>{{ group.relief.sites }} {{ group.relief.sites === 1 ? 'site' : 'sites' }} · {{ hours(group.relief.hours) }} hrs</small></td>
            <td><strong>{{ group.combined.days }} {{ group.combined.days === 1 ? 'worked date' : 'worked dates' }}</strong><small>{{ hours(group.combined.hours) }} hrs ({{ hours(group.combined.ot) }} OT)</small></td>
            <td class="action-cell"><button type="button" @click="selectedEmployeeId = group.employee.EmployeeID">View DTR</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="selectedGroup" class="modal-backdrop" @click.self="closeDetails">
      <section class="dtr-modal" role="dialog" aria-modal="true" :aria-label="`${selectedGroup.employee.EmployeeName} DTR`">
        <div class="modal-header">
          <div><p class="eyebrow">COMBINED DTR</p><h2>{{ selectedGroup.employee.EmployeeName }}</h2><p>{{ selected?.label }} · {{ selectedGroup.employee.AgencyName }}</p></div>
          <button type="button" class="close" aria-label="Close DTR" @click="closeDetails">×</button>
        </div>
        <div class="modal-totals">
          <span>Regular site: <strong>{{ selectedGroup.fixed.days }} days / {{ hours(selectedGroup.fixed.hours) }} hrs</strong></span>
          <span>Reliever: <strong>{{ selectedGroup.relief.days }} days / {{ hours(selectedGroup.relief.hours) }} hrs</strong></span>
          <span>Total: <strong>{{ selectedGroup.combined.days }} worked dates / {{ hours(selectedGroup.combined.hours) }} hrs</strong></span>
        </div>
        <p class="note">A date worked at two sites counts once as a worked date; hours from both entries are included.</p>
        <div class="detail-wrap"><table class="detail-table">
          <thead><tr><th>Date</th><th>Duty</th><th>Site / original DTR</th><th>Status</th><th>Shift</th><th>Time in / out</th><th>Regular</th><th>Rest day</th><th>OT</th><th>ND</th></tr></thead>
          <tbody><tr v-for="day in selectedGroup.entries" :key="day.AttendanceID">
            <td>{{ dayLabel(day.AttendanceDate) }}</td><td><span :class="['duty', day.SiteAttendanceType === 'Reliever' ? 'relief' : 'fixed']">{{ day.SiteAttendanceType === 'Reliever' ? 'Reliever' : 'Regular site' }}</span></td>
            <td><strong>{{ day.SiteName }}</strong><small>{{ day.ClientName }} · DTR-{{ String(day.BatchID).padStart(4, '0') }} · {{ day.DtrStatus }}</small></td>
            <td>{{ day.AttendanceStatus }}</td><td>{{ day.ShiftCode || 'Manual' }}</td><td>{{ day.TimeIn || '—' }}<br>{{ day.TimeOut || '—' }}</td>
            <td>{{ hours(day.RegularHours) }}</td><td>{{ hours(day.RestDayHours) }}</td><td>{{ hours(Number(day.OTHours || 0) + Number(day.OTExtHours || 0)) }}</td><td>{{ hours(day.NightDiffHours) }}</td>
          </tr></tbody>
        </table></div>
        <div class="modal-footer"><button type="button" @click="closeDetails">Close</button></div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.reliever-page{padding:32px 36px;min-height:100%;color:#122b54;background:#f7f9fd}.eyebrow{margin:0 0 10px;color:#3164d9;font-size:13px;font-weight:800;letter-spacing:.1em}h1{margin:0;font-size:36px}header>p:last-child{color:#587098;margin:8px 0 28px}.filters{display:grid;grid-template-columns:130px minmax(220px,1fr) minmax(220px,1fr) minmax(250px,1.2fr);gap:14px;margin-bottom:16px}.filters label{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:700;color:#52698f}.filters input,.filters select{height:50px;border:1px solid #ccdaf2;border-radius:10px;background:#fff;color:#102955;padding:0 13px;font:inherit}.count{color:#587098;font-size:14px}.error{color:#c52f21}.empty,.table-wrap{background:#fff;border:1px solid #d6e1f2;border-radius:14px}.empty{padding:30px}.table-wrap{overflow-x:auto}.summary-table,.detail-table{border-collapse:collapse;width:100%;text-align:left}.summary-table{min-width:900px}.summary-table th,.summary-table td,.detail-table th,.detail-table td{padding:14px 18px;border-bottom:1px solid #e7edf7;text-align:left;font-size:14px}.summary-table tbody tr:last-child td,.detail-table tbody tr:last-child td{border-bottom:0}.summary-table th,.detail-table th{background:#f4f7fc;color:#536b92;font-size:13px;white-space:nowrap}.summary-table td strong,.summary-table td small,.detail-table td strong,.detail-table td small{display:block}.summary-table td small,.detail-table td small{color:#61789f;font-size:12px;margin-top:4px}.employee{min-width:310px}.action-head,.action-cell{text-align:right!important;white-space:nowrap}button{border:1px solid #c9d8f0;border-radius:9px;background:#fff;color:#225bd5;padding:9px 15px;font:inherit;font-weight:700;cursor:pointer}button:hover{background:#f0f5ff}.modal-backdrop{position:fixed;inset:0;z-index:1200;background:#10204099;display:flex;align-items:center;justify-content:center;padding:24px}.dtr-modal{width:min(1400px,100%);max-height:90vh;overflow:hidden;display:flex;flex-direction:column;background:#fff;border-radius:18px;box-shadow:0 20px 60px #10204055}.modal-header{padding:24px 28px 14px;display:flex;justify-content:space-between;gap:24px}.modal-header h2{margin:0;font-size:25px}.modal-header p:last-child{margin:8px 0 0;color:#61789f}.close{border:0;font-size:28px;padding:0 8px;color:#536b92}.modal-totals{display:flex;flex-wrap:wrap;gap:10px 28px;padding:13px 28px;background:#f4f7fc;font-size:14px}.note{margin:0;padding:12px 28px;color:#61789f;font-size:13px}.detail-wrap{overflow:auto}.detail-table{min-width:1120px}.detail-table th,.detail-table td{font-size:12px;padding:11px 13px}.duty{display:inline-block;padding:4px 8px;border-radius:10px;white-space:nowrap;font-weight:700}.duty.fixed{background:#e8efff;color:#244caa}.duty.relief{background:#e3f6ed;color:#16724b}.modal-footer{border-top:1px solid #e7edf7;padding:14px 28px;text-align:right}@media(max-width:1050px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.reliever-page{padding:24px 16px}.filters{grid-template-columns:1fr}.modal-backdrop{padding:8px}.modal-header{padding:20px}.modal-totals,.note{padding-left:20px;padding-right:20px}}
</style>
