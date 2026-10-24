<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
const loading=ref(true),error=ref(''),restricted=ref(false),cutoff=ref(''),search=ref(''),expanded=ref<number|null>(null)
const refreshing=ref(false)
let request=0
const report=ref<any>({accounts:[],cutoffs:[],period:null,totals:{}})
const rows=computed(()=>report.value.accounts.filter((row:any)=>`${row.SiteAccountName} ${row.sites.map((site:any)=>`${site.SiteName} ${site.ClientName} ${site.AgencyName || ''}`).join(' ')}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const money=(value:any)=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value||0))
const day=(value:string)=>new Date(value+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})
const label=(period:any)=>`${day(period.PeriodStart)} – ${day(period.PeriodEnd)}`
const status=(row:any)=>row.Ready?'Finalized':!Number(row.DtrCount)?'No DTR yet':Number(row.SitesWithoutDtr)?'Missing site DTR':'Pending payroll'
async function loadSummary(silent=false){
 const current=++request
 refreshing.value=true
 if(!silent)loading.value=true
 error.value='';restricted.value=false
 try{
  const [periodStart,periodEnd]=cutoff.value.split(':')
  const result=await $fetch<any>('/api/payroll/site-accounts',{query:{...(periodStart?{periodStart,periodEnd}:{})},timeout:15000,retry:0})
  if(current!==request)return
  report.value=result
  if(result.period)cutoff.value=`${result.period.PeriodStart}:${result.period.PeriodEnd}`
 }catch(cause:any){
  if(current!==request)return
  report.value={...report.value,accounts:[],totals:{}}
  if(cause?.status===403||cause?.statusCode===403||cause?.data?.statusCode===403)restricted.value=true
  else error.value=cause?.data?.statusMessage||'Unable to load Site Account payroll totals.'
 }finally{if(current===request){loading.value=false;refreshing.value=false}}
}
useRealtimeRefresh(()=>loadSummary(true),{immediate:true,shouldRefresh:()=>!refreshing.value})
</script>
<template>
 <div class="payroll-summary-workspace">
  <main class="account-summary">
   <header><div><p>PAYROLL</p><h1>Payroll Summary</h1><span>Finalized payroll totals across the sites linked to each account.</span></div><button type="button" class="refresh" :disabled="loading" @click="loadSummary()">{{loading?'Loading…':'Refresh'}}</button></header>
   <p class="info">Totals include finalized payroll only. Draft, pending and cancelled amounts are excluded. Grouping follows each site and agency's current Site Account assignment.</p>
   <p v-if="restricted" class="info" role="status">Payroll view access is required to see these amounts.</p>
   <template v-else>
    <p v-if="error" class="error" role="alert">{{error}}</p>
    <section class="summary-filters"><label>Payroll cutoff<select v-model="cutoff" :disabled="loading||!report.cutoffs.length" @change="expanded=null;loadSummary()"><option v-if="!report.cutoffs.length" value="">No DTR cutoffs yet</option><option v-for="period in report.cutoffs" :key="period.PeriodStart+period.PeriodEnd" :value="period.PeriodStart+':'+period.PeriodEnd">{{label(period)}}</option></select></label><label>Search account or site<input v-model="search" type="search" placeholder="Account, client, or site" /></label></section>
    <section class="total-cards" aria-label="All accounts cutoff totals" :aria-busy="loading"><article><span>Total gross pay</span><strong>{{loading?'—':money(report.totals.Gross)}}</strong></article><article><span>Total deductions</span><strong>{{loading?'—':money(report.totals.Deductions)}}</strong></article><article><span>Total net pay</span><strong>{{loading?'—':money(report.totals.Net)}}</strong></article><article><span>Finalized DTRs</span><strong>{{loading?'—':`${report.totals.FinalizedDtrCount||0} / ${report.totals.DtrCount||0}`}}</strong><small>{{report.totals.SitesWithoutDtr||0}} sites without a DTR</small></article></section>
    <div class="summary-table"><table><thead><tr><th>Site Account</th><th>Site payrolls</th><th>Cutoff status</th><th class="amount">Gross pay</th><th class="amount">Deductions</th><th class="amount">Net pay</th><th>Details</th></tr></thead><tbody>
     <tr v-if="loading"><td colspan="7">Loading payroll totals…</td></tr><tr v-else-if="!rows.length"><td colspan="7">No Site Accounts match. Add accounts and link sites in Organization > Site.</td></tr>
     <template v-for="row in loading?[]:rows" :key="row.SiteAccountID"><tr><td><strong>{{row.SiteAccountName}}</strong><small v-if="row.Status==='Inactive'">Inactive account</small><small>{{row.PayrollEntries}} finalized payroll entries</small></td><td>{{row.SiteCount}}</td><td><span class="badge" :class="{ready:row.Ready}">{{status(row)}}</span><small>{{row.FinalizedDtrCount}} / {{row.DtrCount}} DTRs finalized</small></td><td class="amount">{{money(row.Gross)}}</td><td class="amount">{{money(row.Deductions)}}</td><td class="amount"><strong>{{money(row.Net)}}</strong></td><td><button type="button" :aria-expanded="expanded===row.SiteAccountID" @click="expanded=expanded===row.SiteAccountID?null:row.SiteAccountID">{{expanded===row.SiteAccountID?'Hide sites':'View sites'}}</button></td></tr>
     <tr v-if="expanded===row.SiteAccountID"><td colspan="7" class="site-details"><p v-if="!row.sites.length">No sites linked for this cutoff.</p><table v-else><thead><tr><th>Site / client</th><th>DTRs finalized</th><th class="amount">Gross pay</th><th class="amount">Deductions</th><th class="amount">Net pay</th></tr></thead><tbody><tr v-for="site in row.sites" :key="site.SiteID+':'+site.AgencyID"><td><strong>{{site.SiteName}}</strong><small>{{site.ClientName}}</small><small>{{site.AgencyName || 'No company assigned'}}</small></td><td>{{site.FinalizedDtrCount}} / {{site.DtrCount}}</td><td class="amount">{{money(site.Gross)}}</td><td class="amount">{{money(site.Deductions)}}</td><td class="amount">{{money(site.Net)}}</td></tr></tbody></table></td></tr></template>
    </tbody></table></div>
   </template>
  </main>
 </div>
</template>
<style scoped>
.payroll-summary-workspace{color:#163258}.account-summary{padding:28px 32px}.account-summary header{display:flex;justify-content:space-between;align-items:center;gap:16px}.account-summary header p{margin:0;color:#2864e8;font-size:.74rem;font-weight:800;letter-spacing:.08em}.account-summary h1{margin:8px 0;font-size:1.8rem}.account-summary header span{color:#627e9f;font-size:.88rem}.info{padding:14px 17px;border:1px solid #d9e5f8;border-radius:10px;background:#f0f5ff;color:#45658d;font-size:.82rem;line-height:1.6}.error{color:#b42318}.summary-filters{display:grid;grid-template-columns:minmax(240px,1fr) minmax(240px,1.3fr);gap:16px;margin:22px 0}.summary-filters label{display:grid;gap:8px;font-size:.8rem;font-weight:700;color:#536e91}.summary-filters input,.summary-filters select{min-height:46px;width:100%;box-sizing:border-box;border:1px solid #cedbef;border-radius:10px;padding:10px 13px;background:#fff;color:#163258;font:inherit}.total-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:22px}.total-cards article{display:grid;align-content:start;gap:10px;padding:18px;border:1px solid #d9e4f4;border-radius:12px;background:#fff}.total-cards span,.total-cards small{color:#637d9e;font-size:.78rem}.total-cards strong{font-size:1.3rem;overflow-wrap:anywhere}.summary-table{overflow:auto;border:1px solid #d9e4f4;border-radius:12px;background:#fff}.summary-table table{border-collapse:collapse;width:100%;min-width:820px;text-align:left}.summary-table th{background:#f4f7fc;color:#627b9a;font-size:.73rem;text-transform:uppercase}.summary-table th,.summary-table td{padding:15px;border-bottom:1px solid #e4ebf6;font-size:.81rem;vertical-align:middle}.summary-table td small{display:block;margin-top:5px;color:#6a83a3;font-size:.73rem}.summary-table .amount{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.account-summary button{font:inherit;cursor:pointer}.refresh,.summary-table button{padding:10px 13px;border:1px solid #cddbf1;border-radius:8px;background:#f6f9ff;color:#2155bc;white-space:nowrap}.badge{display:inline-block;border-radius:20px;background:#fff1d7;color:#9b6600;padding:6px 9px;font-size:.72rem}.badge.ready{background:#ddf8e9;color:#137a47}.site-details{background:#f8faff}.site-details table{min-width:650px}.site-details p{color:#617c9d}@media(max-width:1000px){.total-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){.account-summary{padding:22px 12px}.summary-filters{grid-template-columns:1fr}.total-cards{gap:9px}.total-cards article{padding:13px}.total-cards strong{font-size:1.05rem}}
</style>
<style>
html[data-theme='dark'] .payroll-summary-workspace{color:var(--ink)}
html[data-theme='dark'] .payroll-summary-workspace :is(.info,.summary-table,.total-cards article){border-color:var(--line);background:#15223b}
html[data-theme='dark'] .payroll-summary-workspace :is(.account-summary header span,.info,.summary-filters label,.total-cards span,.total-cards small,.summary-table td small,.site-details p){color:var(--muted)}
html[data-theme='dark'] .payroll-summary-workspace :is(.summary-filters input,.summary-filters select,.refresh,.summary-table button){border-color:#405273;background:#1b2946;color:#d3deef}
html[data-theme='dark'] .payroll-summary-workspace :is(.summary-table th,.site-details){background:#1b2946;color:#bdcee7}
html[data-theme='dark'] .payroll-summary-workspace :is(.summary-table th,.summary-table td){border-color:var(--line)}
</style>
