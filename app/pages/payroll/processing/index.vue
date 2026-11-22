<script setup lang="ts">
import { useServerList } from '~~/app/composables/useServerList'
import ListProgress from '~~/app/components/ListProgress.vue'
import { requestErrorMessage } from '~~/shared/utils/requestError'
import {useRealtimeRefresh} from '~~/app/composables/useRealtimeRefresh'

import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import PayrollProcessingDetailModal from '~/components/PayrollProcessingDetailModal.vue'
import SearchableSelect from '~~/components/SearchableSelect.vue'

type Cutoff = { start: string; end: string }
type Result = { cutoffs: Cutoff[]; selectedCutoff: Cutoff | null; sites: any[]; permissions?: { canReview: boolean } }
const data = ref<Result>({ cutoffs: [], selectedCutoff: null, sites: [] })
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const actionError = ref('')
const success = ref('')
const cutoff = ref('')
const search = ref('')
const agency = ref('')
const client = ref('')
const siteAccount = ref('')
const statusFilter = ref('current')
const selectedId = ref<number | null>(null)
const selectedDetail = ref<any>(null)
const detailLoading = ref(false)
let detailRequest = 0
const directory = ref<any[]>([])
const serverCounts = ref<Record<string, number>>({})
const queueEnabled=ref<boolean|null>(null),jobs=ref<any[]>([]),queueError=ref('')
const visibleJobs=ref(8)
const pendingJobs=computed(()=>jobs.value.filter(job=>['Queued','Running'].includes(job.status)))
const selectedQueued=computed(()=>pendingJobs.value.some(job=>job.batchId===selectedId.value))
let requestKey='',jobsActive=false,jobsLoading=false
async function pollJobs(){
  if(!jobsActive||jobsLoading)return
  jobsLoading=true
  try{
    const result:any=await $fetch('/api/payroll/jobs',{retry:0,timeout:10000})
    if(!jobsActive)return
    queueEnabled.value=result.enabled;queueError.value=''
    const completed=result.items.filter((job:any)=>jobs.value.some(old=>old.id===job.id&&['Queued','Running'].includes(old.status))&&!['Queued','Running'].includes(job.status))
    jobs.value=result.items
    if(completed.length){
      if(completed.some((job:any)=>job.batchId===selectedId.value))closeDetail()
      const failed=completed.find((job:any)=>job.status!=='Succeeded')
      if(failed)error.value=`DTR-${failed.batchId}: ${failed.message||'Review this payroll before submitting again.'}`
      if(completed.some((job:any)=>job.status==='Succeeded'))success.value='Queued payroll finalized. Payroll records and eligible deductions were posted.'
      await serverList.refresh()
    }
  }catch(cause){if(jobsActive){queueError.value=requestErrorMessage(cause,'Unable to check payroll jobs. Accepted jobs continue on the server.');throw cause}}
  finally{jobsLoading=false}
}
function startJobs(){jobsActive=true}
function stopJobs(){jobsActive=false}
onMounted(startJobs)
onActivated(startJobs)
onDeactivated(stopJobs)
onBeforeUnmount(stopJobs)
useRealtimeRefresh(pollJobs,{intervalMs:3000,immediate:true,shouldRefresh:()=>queueEnabled.value!==false})

const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value || 0)
const day = (value: string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const range = (item: Cutoff) => `${day(item.start)} – ${day(item.end)}`
const agencies = computed(() => [...new Map(directory.value.map(site => [site.AgencyID, site.AgencyName])).entries()])
const clients = computed(() => [...new Map(directory.value.filter(site => !agency.value || String(site.AgencyID) === agency.value).map(site => [site.ClientID, site.ClientName])).entries()])
const siteAccountOptions = computed(() => {
  const sites = directory.value.filter(site => (!agency.value || String(site.AgencyID) === agency.value) && (!client.value || String(site.ClientID) === client.value))
  const accounts = new Map<string, string>()
  for (const site of sites) if (site.SiteAccountID) accounts.set(String(site.SiteAccountID), site.SiteAccountName || 'Unnamed Site Account')
  return [{ value: '', label: 'All site accounts' },
    ...[...accounts].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })),
    ...(sites.some(site => !site.SiteAccountID) ? [{ value: 'unassigned', label: 'Unassigned Site Account' }] : [])]
})
watch(siteAccountOptions, options => { if (siteAccount.value && !options.some(option => option.value === siteAccount.value)) siteAccount.value = '' })
const selectedSite = selectedDetail
const matchingSites = computed(() => data.value.sites)
const visible = matchingSites
const totals = computed(() => visible.value.reduce((sum, site) => ({
  people: sum.people + Number(site.peopleCount || 0), gross: sum.gross + Number(site.gross || 0),
  deductions: sum.deductions + Number(site.deductions || 0), net: sum.net + Number(site.netPreview || 0),
}), { people: 0, gross: 0, deductions: 0, net: 0 }))
const counts = serverCounts

const serverList = useServerList<any>({
  query: () => {
    const [periodStart, periodEnd] = cutoff.value.split(':')
    return { ...(periodStart && periodEnd ? { periodStart, periodEnd } : {}), search: search.value,
      agencyId: agency.value, clientId: client.value, siteAccountId: siteAccount.value, status: statusFilter.value }
  },
  fetchPage: (page, query, signal) => $fetch('/api/payroll/processing', { query: { ...query, page, pageSize: 25, includeEmployees: '0', includeLookups: page === 1 ? '1' : '0' }, signal }),
  key: site => Number(site.BatchID),
  paused: () => busy.value || !!selectedId.value,
  onLoaded: result => {
    data.value = { ...data.value, cutoffs: result.cutoffs, selectedCutoff: result.selectedCutoff, permissions: result.permissions }
    if (result.directory) directory.value = result.directory
    serverCounts.value = result.counts
  },
})
const displayedItems = serverList.items, listProgress = serverList.progress, loadMoreItems = serverList.loadMore
watch(serverList.items, items => { data.value.sites = items })
watch(serverList.loading, value => { loading.value = value })
watch(serverList.error, value => { error.value = value })

async function load() {
  await serverList.refresh()
  const current=detailRequest,site=selectedDetail.value
  if(selectedId.value&&site){
    try{const detail=await fetchDetail(site);if(current===detailRequest)selectedDetail.value=detail}
    catch(cause){if(current===detailRequest){closeDetail();error.value='The change was saved. '+requestErrorMessage(cause,'Reopen this payroll review to refresh its details.')}}
  }
}
async function fetchDetail(site:any){
 const result:any=await $fetch('/api/payroll/processing',{query:{page:1,pageSize:1,batchId:site.BatchID,periodStart:site.PeriodStart,periodEnd:site.PeriodEnd,status:site.ReviewStatus||'Pending',includeLookups:'0'},retry:0,timeout:30000})
 const detail=result.items.find((row:any)=>Number(row.BatchID)===Number(site.BatchID))
 if(!detail)throw new Error('This payroll changed. Refresh the list before reviewing it.')
 return detail
}
function closeDetail(){detailRequest++;selectedId.value=null;selectedDetail.value=null;detailLoading.value=false}
async function openDetail(site:any){
 const random=crypto.getRandomValues(new Uint8Array(16));random[6]=(random[6]!&15)|64;random[8]=(random[8]!&63)|128
 const hex=Array.from(random,n=>n.toString(16).padStart(2,'0')).join('')
 requestKey=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-')
 const current=++detailRequest;selectedId.value=Number(site.BatchID);selectedDetail.value=null;detailLoading.value=true;actionError.value='';success.value='';error.value=''
 try{const detail=await fetchDetail(site);if(current===detailRequest)selectedDetail.value=detail}
 catch(cause){if(current===detailRequest){error.value=requestErrorMessage(cause,'Unable to load payroll details.');closeDetail()}}
 finally{if(current===detailRequest)detailLoading.value=false}
}
onBeforeUnmount(closeDetail)
onDeactivated(closeDetail)
async function review(action: 'finalize' | 'reject' | 'cancel', reason = '') {
  if (!selectedId.value || busy.value) return
  busy.value = true; actionError.value = ''; success.value = ''
  try {
    if(action==='finalize'&&queueEnabled.value===null)throw new Error('Unable to confirm queue availability. Refresh the page before submitting.')
    if(action==='finalize'&&queueEnabled.value){
      const result:any=await $fetch('/api/payroll/jobs',{method:'POST',body:{batchId:selectedId.value,requestKey,expectedHash:selectedDetail.value?.reviewHash},retry:0,timeout:15000})
      jobs.value=[result.job,...jobs.value.filter(job=>job.id!==result.job.id)]
      closeDetail();success.value='Payroll queued. You can continue working; its status appears below.'
      return
    }
    await $fetch(`/api/payroll/processing/${selectedId.value}`, { method: 'POST', body: { action, reason },retry:0 })
    closeDetail()
    await load()
    success.value = action === 'finalize' ? 'Payroll finalized. Employee payroll records, eligible deductions, and approved adjustments were posted.' : action === 'cancel' ? 'Finalization cancelled. Payroll and deduction receipts were voided, balances restored, and the DTR returned to Draft.' : 'Returned to Draft. Correct the DTR and compute it again before finalizing.'
  } catch (caught: any) { actionError.value = requestErrorMessage(caught, 'Unable to save payroll review.') }
  finally { busy.value = false }
}
async function changeDeduction(change: { action: 'skip' | 'restore'; employeeId: number; entryType: string; recordId: number; reason: string }) {
  if (!selectedId.value || busy.value) return
  busy.value = true; actionError.value = ''; success.value = ''
  try {
    await $fetch(`/api/payroll/processing/${selectedId.value}/deductions`, { method: 'POST', body: change })
    await load()
    success.value = change.action === 'skip' ? 'Deduction skipped for this cutoff.' : 'Deduction restored for this cutoff.'
  } catch (caught: any) { actionError.value = requestErrorMessage(caught, 'Unable to change this deduction.') }
  finally { busy.value = false }
}
async function changeCashBond(change:any){
 if(!selectedId.value||busy.value)return
 busy.value=true;actionError.value=''
 try{await $fetch('/api/deductions-loans/cash-bonds/cutoff',{method:'PUT',body:{BatchID:selectedId.value,...change}});await load();success.value='Deduction amount saved for this employee and cutoff only.'}
 catch(e:any){actionError.value=requestErrorMessage(e, 'Unable to change refundable deduction amount.')}finally{busy.value=false}
}
async function pausePlan(change: { entryType: string; recordId: number; startDate: string; resumeDate: string; reason: string }) {
  if (!selectedId.value || busy.value) return
  busy.value = true; actionError.value = ''; success.value = ''
  try {
    if (change.entryType === 'Recurring') {
      await $fetch('/api/deductions-loans/recurring', { method: 'PUT', body: {
        RecurringDeductionID: change.recordId, action: 'pause', PauseStartDate: change.startDate,
        ResumeDate: change.resumeDate || null, PauseReason: change.reason,
      } })
    } else {
      await $fetch('/api/deductions-loans/employee-records', { method: 'PUT', body: {
        EntryType: change.entryType, RecordID: change.recordId, PlanAction: 'pause',
        PauseStartDate: change.startDate, ResumeDate: change.resumeDate || null, PauseReason: change.reason,
      } })
    }
    await load()
    success.value = 'Plan paused. Resume it from the employee account or use the scheduled resume date.'
  } catch (caught: any) { actionError.value = requestErrorMessage(caught, 'Unable to pause this plan.') }
  finally { busy.value = false }
}
onActivated(() => { if (serverList.items.value.length) void serverList.refresh() })
</script>

<template>
  <section class="processing-page">
    <header class="heading"><div><p class="eyebrow">PAYROLL</p><h1>Payroll Processing</h1><p>Review computed DTRs by site, then finalize payroll in the same screen.</p></div></header>
    <p class="workflow-note">Finalization posts employee payroll, eligible fixed-site installments, agency contributions, cash bond collections, and approved prior-period adjustments. BTR reliever hours are a separate earning at the regular rate effective on each covered date. Payslip release is separate.</p>
    <div class="filters">
      <label class="search-field">Search site or employee<input v-model="search" type="search" placeholder="Search site, client, DTR, or employee"></label>
      <label>Agency<select v-model="agency" @change="client='';siteAccount=''"><option value="">All agencies</option><option v-for="[id, name] in agencies" :key="id" :value="String(id)">{{ name }}</option></select></label>
      <label>Client<select v-model="client" @change="siteAccount=''"><option value="">All clients</option><option v-for="[id, name] in clients" :key="id" :value="String(id)">{{ name }}</option></select></label>
      <SearchableSelect v-model="siteAccount" label="Site Account" placeholder="Search site accounts" :options="siteAccountOptions" empty-text="No matching site accounts for these filters." />
      <label>Cutoff<select v-model="cutoff"><option value="">Latest cutoff</option><option v-for="item in data.cutoffs" :key="item.start+item.end" :value="`${item.start}:${item.end}`">{{ range(item) }}</option></select></label>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="success" class="success" role="status">{{ success }}</p>
    <section v-if="queueEnabled||queueError" class="queue-panel" aria-label="Your payroll jobs">
      <header><strong>Payroll jobs <span v-if="pendingJobs.length">· {{ pendingJobs.length }} pending</span></strong><small>Jobs continue when you close this page.</small></header>
      <p v-if="queueError" role="alert">{{ queueError }}</p>
      <p v-else-if="!jobs.length">No recent payroll jobs.</p>
      <ul v-else><li v-for="job in jobs.slice(0,visibleJobs)" :key="job.id"><strong>DTR-{{ String(job.batchId).padStart(4,'0') }}</strong><span class="queue-state" :class="job.status.toLowerCase()">{{ job.status==='Succeeded'?'Finalized':job.status==='NeedsReview'?'Needs review':job.status }}</span><small>{{ job.message||(job.status==='Queued'?'Waiting for an available worker.':'') }}</small></li></ul>
      <button v-if="jobs.length>visibleJobs" class="secondary" type="button" @click="visibleJobs+=8">Show more jobs</button>
    </section>
    <p v-if="detailLoading" class="workflow-note" role="status">Loading payroll details...</p>
    <div class="list-top"><p>Showing {{ visible.length }} site DTRs<span v-if="data.selectedCutoff"> · {{ range(data.selectedCutoff) }}</span></p><div class="status-tabs" aria-label="Review status filters"><button v-for="item in [{key:'current',label:'Current'}, {key:'Pending',label:'To review'}, {key:'Approved',label:'Finalized'}, {key:'Rejected',label:'Returned'}, {key:'Cancelled',label:'Cancelled'}]" :key="item.key" type="button" :class="{active:statusFilter===item.key}" @click="statusFilter=item.key">{{ item.label }} <span>{{ counts[item.key]||0 }}</span></button></div></div>
    <p v-if="visible.length" class="workflow-note">Totals below cover the {{ visible.length }} loaded site DTRs. Scroll to load more.</p><div v-if="visible.length" class="summary-strip"><div><span>Employees</span><strong>{{ totals.people }}</strong></div><div><span>Gross</span><strong>{{ money(totals.gross) }}</strong></div><div><span>Deductions</span><strong>{{ money(totals.deductions) }}</strong></div><div><span>Net for review</span><strong>{{ money(totals.net) }}</strong></div></div>
    <div class="table-wrap"><table class="processing-table"><thead><tr><th>Site / Client</th><th>Agency / DTR</th><th>Employees</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Review</th><th>Action</th></tr></thead><tbody>
      <tr v-for="site in displayedItems" :key="site.BatchID"><td><strong>{{ site.SiteName }}</strong><small>{{ site.ClientName }}</small><small>Site Account: {{ site.SiteAccountName || 'Unassigned' }}</small></td><td><strong>{{ site.AgencyName }}</strong><small>DTR-{{ String(site.BatchID).padStart(4, '0') }}</small></td><td>{{ site.peopleCount }}</td><td>{{ money(site.gross) }}</td><td>{{ money(site.deductions) }}</td><td><strong>{{ money(site.netPreview) }}</strong></td><td><span class="review-chip" :class="String(site.ReviewStatus || 'Pending').toLowerCase()">{{ site.ReviewStatus==='Approved'?'Finalized':site.ReviewStatus==='Rejected'?'Returned':site.ReviewStatus==='Cancelled'?'Cancelled':'To review' }}</span><small v-if="site.warningCount && site.ReviewStatus==='Pending'" class="note-count">{{ site.warningCount }} payroll note{{ site.warningCount===1?'':'s' }}</small></td><td><button type="button" class="secondary" :disabled="detailLoading" @click="openDetail(site)">{{ site.ReviewStatus==='Pending'?'Review':'View details' }}</button></td></tr>
      <tr v-if="!visible.length"><td colspan="8" class="empty">{{ loading?'Loading site DTRs…':statusFilter==='current' && counts.Rejected?'No current DTRs. Open Returned to view rejected history.':'No site DTRs match these filters.' }}</td></tr>
    </tbody></table></div>
    <ListProgress v-bind="listProgress" unit="payrolls" :paused="loading || busy || detailLoading || !!selectedSite" @load-more="loadMoreItems" />

    <PayrollProcessingDetailModal v-if="selectedSite" :site="selectedSite" :can-review="!!data.permissions?.canReview&&!selectedQueued" :busy="busy" :error="actionError" @close="closeDetail" @approve="review('finalize')" @reject="reason=>review('reject', reason)" @cancel="reason=>review('cancel', reason)" @deduction="changeDeduction" @pause-plan="pausePlan" @cash-bond="changeCashBond" />
  </section>
</template>

<style scoped>
.queue-panel{margin:1rem 0;padding:1rem;border:1px solid var(--line,#d7e2f5);border-radius:14px;background:var(--surface,#fff)}
.queue-panel header{display:flex;justify-content:space-between;gap:.75rem;flex-wrap:wrap}.queue-panel small{color:var(--muted,#64748b)}
.queue-panel ul{list-style:none;padding:0;margin:.75rem 0 0}.queue-panel li{display:flex;align-items:center;gap:.75rem;padding:.65rem 0;flex-wrap:wrap;border-top:1px solid var(--line,#d7e2f5)}
.queue-state{padding:.2rem .6rem;border-radius:20px;background:#e8efff;color:#234da0;font-size:.85rem;font-weight:600}.queue-state.succeeded{background:#dcfce7;color:#166534}.queue-state.failed,.queue-state.needsreview{background:#fff1d6;color:#92400e}
@media(max-width:600px){.queue-panel li small{flex-basis:100%}}
</style>
