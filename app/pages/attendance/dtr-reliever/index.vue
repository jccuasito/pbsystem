<script setup lang="ts">
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'

type Day = {AttendanceID:number;EmployeeID:number;EmployeeNumber:string|null;EmployeeName:string;BatchID:number;DtrStatus:string;AgencyName:string;ClientName:string;SiteName:string;AttendanceDate:string;AttendanceStatus:string;RegularHours:number;OTHours:number;OTExtHours:number;RestDayHours:number;NightDiffHours:number;TimeIn:string|null;TimeOut:string|null;ShiftCode:string|null;PositionName:string}
type Group = {employee:Day;days:Day[];sites:number;regular:number;ot:number}
const today=new Date()
const year=ref(String(today.getFullYear()))
const cutoff=ref(`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${today.getDate()<=15?'01':'16'}`)
const agencyId=ref(''),search=ref(''),loading=ref(false),error=ref('')
const rows=ref<Day[]>([]),agencies=ref<{AgencyID:number;AgencyName:string}[]>([])
const years=computed(()=>Array.from({length:5},(_,i)=>String(today.getFullYear()-2+i)))
const cutoffs=computed(()=>Array.from({length:12},(_,m)=>{const prefix=`${year.value}-${String(m+1).padStart(2,'0')}`,label=new Date(Number(year.value),m,1).toLocaleString('en-PH',{month:'long'}),last=new Date(Number(year.value),m+1,0).getDate();return[{start:`${prefix}-01`,end:`${prefix}-15`,label:`${label} 1–15, ${year.value}`},{start:`${prefix}-16`,end:`${prefix}-${last}`,label:`${label} 16–${last}, ${year.value}`}]}).flat())
const selected=computed(()=>cutoffs.value.find(item=>item.start===cutoff.value))
const groups=computed<Group[]>(()=>{const term=search.value.trim().toLowerCase(),map=new Map<number,Group>();for(const day of rows.value){if(term&&![day.EmployeeName,day.EmployeeNumber,`EMP-${String(day.EmployeeID).padStart(4,'0')}`,day.SiteName,day.ClientName].some(value=>String(value||'').toLowerCase().includes(term)))continue;let group=map.get(day.EmployeeID);if(!group){group={employee:day,days:[],sites:0,regular:0,ot:0};map.set(day.EmployeeID,group)}group.days.push(day);group.regular+=Number(day.RegularHours||0);group.ot+=Number(day.OTHours||0)+Number(day.OTExtHours||0)}return[...map.values()].map(group=>({...group,sites:new Set(group.days.map(day=>day.SiteName)).size}))})
const dayCount=computed(()=>groups.value.reduce((sum,group)=>sum+group.days.length,0))
function dayLabel(value:string){return new Date(value+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}
function hours(value:number){return Number(value||0).toFixed(2)}
async function load(){if(!selected.value)return;loading.value=true;error.value='';try{const result=await $fetch<{rows:Day[];agencies:{AgencyID:number;AgencyName:string}[]}>('/api/attendance/dtr/relievers',{query:{periodStart:selected.value.start,periodEnd:selected.value.end,agencyId:agencyId.value||undefined}});rows.value=result.rows||[];agencies.value=result.agencies||[]}catch(cause:any){error.value=cause?.data?.statusMessage||'Unable to load reliever attendance.'}finally{loading.value=false}}
watch(year,()=>{cutoff.value=`${year.value}-01-01`})
watch([cutoff,agencyId],load)
onMounted(load)
useRealtimeRefresh(load)
</script>

<template>
  <section class="reliever-page"><header><p class="eyebrow">ATTENDANCE</p><h1>DTR Reliever</h1><p>View relievers' worked days across all sites. Each attendance entry remains in its original site DTR.</p></header>
    <div class="filters"><label>Year<select v-model="year"><option v-for="item in years" :key="item" :value="item">{{item}}</option></select></label><label>Cutoff<select v-model="cutoff"><option v-for="item in cutoffs" :key="item.start" :value="item.start">{{item.label}}</option></select></label><label>Agency<select v-model="agencyId"><option value="">All agencies</option><option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{agency.AgencyName}}</option></select></label><label>Search<input v-model="search" type="search" placeholder="Employee or site"></label></div>
    <p v-if="error" role="alert" class="error">{{error}}</p><p class="count" role="status">{{loading?'Loading…':`${groups.length} reliever${groups.length===1?'':'s'} · ${dayCount} worked day${dayCount===1?'':'s'}`}}</p>
    <div v-if="!loading&&!groups.length&&!error" class="empty">No reliever work was recorded for the selected cutoff.</div>
    <div v-for="group in groups" :key="group.employee.EmployeeID" class="card"><details><summary><span class="person"><strong>{{group.employee.EmployeeName}}</strong><small>EMP-{{String(group.employee.EmployeeID).padStart(4,'0')}} · {{group.employee.EmployeeNumber||'No employee number'}} · {{group.employee.AgencyName}} · {{group.employee.PositionName}}</small></span><span class="totals"><b>{{group.days.length}} day{{group.days.length===1?'':'s'}}</b><span>{{group.sites}} site{{group.sites===1?'':'s'}}</span><span>{{hours(group.regular)}} regular hrs</span><span>{{hours(group.ot)}} OT hrs</span></span></summary>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Site / DTR</th><th>Status</th><th>Shift</th><th>Time in / out</th><th>Regular</th><th>Rest day</th><th>OT</th><th>ND</th></tr></thead><tbody><tr v-for="day in group.days" :key="day.AttendanceID"><td>{{dayLabel(day.AttendanceDate)}}</td><td><strong>{{day.SiteName}}</strong><small>{{day.ClientName}} · DTR-{{String(day.BatchID).padStart(4,'0')}} · {{day.DtrStatus}}</small></td><td>{{day.AttendanceStatus}}</td><td>{{day.ShiftCode||'Manual'}}</td><td>{{day.TimeIn||'—'}}<br>{{day.TimeOut||'—'}}</td><td>{{hours(day.RegularHours)}}</td><td>{{hours(day.RestDayHours)}}</td><td>{{hours(Number(day.OTHours||0)+Number(day.OTExtHours||0))}}</td><td>{{hours(day.NightDiffHours)}}</td></tr></tbody></table></div>
    </details></div>
  </section>
</template>

<style scoped>
.reliever-page{padding:32px 36px;min-height:100%;color:#122b54;background:#f7f9fd}.eyebrow{margin:0 0 10px;color:#3164d9;font-size:13px;font-weight:800;letter-spacing:.1em}h1{margin:0;font-size:36px}header>p:last-child{color:#587098;margin:8px 0 28px}.filters{display:grid;grid-template-columns:130px minmax(220px,1fr) minmax(220px,1fr) minmax(250px,1.2fr);gap:14px;margin-bottom:16px}.filters label{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:700;color:#52698f}.filters input,.filters select{height:50px;border:1px solid #ccdaf2;border-radius:10px;background:#fff;color:#102955;padding:0 13px;font:inherit}.count{color:#587098;font-size:14px}.error{color:#c52f21}.empty,.card{background:#fff;border:1px solid #d6e1f2;border-radius:14px;margin:12px 0}.empty{padding:30px}.card summary{display:flex;justify-content:space-between;gap:20px;align-items:center;padding:20px 22px;cursor:pointer}.person{display:flex;flex-direction:column;gap:5px}.person strong{font-size:18px}.person small,.card td small{color:#61789f;font-size:13px}.totals{display:flex;gap:20px;align-items:center;white-space:nowrap;font-size:14px}.totals b{color:#225bd5}.table-wrap{overflow-x:auto;border-top:1px solid #e0e8f5}table{border-collapse:collapse;width:100%;min-width:1050px;text-align:left}th,td{padding:13px 16px;border-bottom:1px solid #e7edf7;font-size:13px}th{color:#536b92;background:#f4f7fc}td strong,td small{display:block}@media(max-width:1050px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}.card summary{align-items:flex-start;flex-direction:column}.totals{flex-wrap:wrap;white-space:normal}}@media(max-width:620px){.reliever-page{padding:24px 16px}.filters{grid-template-columns:1fr}}
</style>
