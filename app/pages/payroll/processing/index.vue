<script setup lang="ts">
import { useServerList } from '~~/app/composables/useServerList'
import ListProgress from '~~/app/components/ListProgress.vue'
import { requestErrorMessage } from '~~/shared/utils/requestError'

import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
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
    await $fetch(`/api/payroll/processing/${selectedId.value}`, { method: 'POST', body: { action, reason } })
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
    <p v-if="detailLoading" class="workflow-note" role="status">Loading payroll details...</p>
    <div class="list-top"><p>Showing {{ visible.length }} site DTRs<span v-if="data.selectedCutoff"> · {{ range(data.selectedCutoff) }}</span></p><div class="status-tabs" aria-label="Review status filters"><button v-for="item in [{key:'current',label:'Current'}, {key:'Pending',label:'To review'}, {key:'Approved',label:'Finalized'}, {key:'Rejected',label:'Returned'}, {key:'Cancelled',label:'Cancelled'}]" :key="item.key" type="button" :class="{active:statusFilter===item.key}" @click="statusFilter=item.key">{{ item.label }} <span>{{ counts[item.key]||0 }}</span></button></div></div>
    <p v-if="visible.length" class="workflow-note">Totals below cover the {{ visible.length }} loaded site DTRs. Scroll to load more.</p><div v-if="visible.length" class="summary-strip"><div><span>Employees</span><strong>{{ totals.people }}</strong></div><div><span>Gross</span><strong>{{ money(totals.gross) }}</strong></div><div><span>Deductions</span><strong>{{ money(totals.deductions) }}</strong></div><div><span>Net for review</span><strong>{{ money(totals.net) }}</strong></div></div>
    <div class="table-wrap"><table class="processing-table"><thead><tr><th>Site / Client</th><th>Agency / DTR</th><th>Employees</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Review</th><th>Action</th></tr></thead><tbody>
      <tr v-for="site in displayedItems" :key="site.BatchID"><td><strong>{{ site.SiteName }}</strong><small>{{ site.ClientName }}</small><small>Site Account: {{ site.SiteAccountName || 'Unassigned' }}</small></td><td><strong>{{ site.AgencyName }}</strong><small>DTR-{{ String(site.BatchID).padStart(4, '0') }}</small></td><td>{{ site.peopleCount }}</td><td>{{ money(site.gross) }}</td><td>{{ money(site.deductions) }}</td><td><strong>{{ money(site.netPreview) }}</strong></td><td><span class="review-chip" :class="String(site.ReviewStatus || 'Pending').toLowerCase()">{{ site.ReviewStatus==='Approved'?'Finalized':site.ReviewStatus==='Rejected'?'Returned':site.ReviewStatus==='Cancelled'?'Cancelled':'To review' }}</span><small v-if="site.warningCount && site.ReviewStatus==='Pending'" class="note-count">{{ site.warningCount }} payroll note{{ site.warningCount===1?'':'s' }}</small></td><td><button type="button" class="secondary" :disabled="detailLoading" @click="openDetail(site)">{{ site.ReviewStatus==='Pending'?'Review':'View details' }}</button></td></tr>
      <tr v-if="!visible.length"><td colspan="8" class="empty">{{ loading?'Loading site DTRs…':statusFilter==='current' && counts.Rejected?'No current DTRs. Open Returned to view rejected history.':'No site DTRs match these filters.' }}</td></tr>
    </tbody></table></div>
    <ListProgress v-bind="listProgress" unit="payrolls" :paused="loading || busy || detailLoading || !!selectedSite" @load-more="loadMoreItems" />

    <PayrollProcessingDetailModal v-if="selectedSite" :site="selectedSite" :can-review="!!data.permissions?.canReview" :busy="busy" :error="actionError" @close="closeDetail" @approve="review('finalize')" @reject="reason=>review('reject', reason)" @cancel="reason=>review('cancel', reason)" @deduction="changeDeduction" @pause-plan="pausePlan" @cash-bond="changeCashBond" />
  </section>
</template>
