<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PayrollProcessingDetailModal from '~/components/PayrollProcessingDetailModal.vue'

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
const statusFilter = ref('current')
const selectedId = ref<number | null>(null)

const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value || 0)
const day = (value: string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const range = (item: Cutoff) => `${day(item.start)} – ${day(item.end)}`
const agencies = computed(() => [...new Map(data.value.sites.map(site => [site.AgencyID, site.AgencyName])).entries()])
const clients = computed(() => [...new Map(data.value.sites.filter(site => !agency.value || String(site.AgencyID) === agency.value).map(site => [site.ClientID, site.ClientName])).entries()])
const selectedSite = computed(() => data.value.sites.find(site => Number(site.BatchID) === selectedId.value) || null)
const visible = computed(() => data.value.sites.filter(site =>
  (!agency.value || String(site.AgencyID) === agency.value) &&
  (!client.value || String(site.ClientID) === client.value) &&
  (statusFilter.value === 'current' ? !['Rejected', 'Cancelled'].includes(site.ReviewStatus) : (site.ReviewStatus || 'Pending') === statusFilter.value) &&
  (!search.value.trim() || `${site.SiteName} ${site.ClientName} ${site.AgencyName} ${site.BatchID} ${site.employees.map((person: any) => person.EmployeeName).join(' ')}`.toLowerCase().includes(search.value.trim().toLowerCase()))
))
const totals = computed(() => visible.value.reduce((sum, site) => ({
  people: sum.people + Number(site.peopleCount || 0), gross: sum.gross + Number(site.gross || 0),
  deductions: sum.deductions + Number(site.deductions || 0), net: sum.net + Number(site.netPreview || 0),
}), { people: 0, gross: 0, deductions: 0, net: 0 }))
const counts = computed(() => data.value.sites.reduce((value, site) => {
  const status = String(site.ReviewStatus || 'Pending')
  value[status] = (value[status] || 0) + 1
  return value
}, {} as Record<string, number>))

async function load() {
  loading.value = true; error.value = ''
  try {
    const [periodStart, periodEnd] = cutoff.value.split(':')
    const result = await $fetch<Result>('/api/payroll/processing', { query: periodStart && periodEnd ? { periodStart, periodEnd } : {} })
    data.value = result
    if (!cutoff.value && result.selectedCutoff) cutoff.value = `${result.selectedCutoff.start}:${result.selectedCutoff.end}`
    if (selectedId.value && !result.sites.some(site => Number(site.BatchID) === selectedId.value)) selectedId.value = null
  } catch (caught: any) { error.value = caught?.data?.statusMessage || caught?.message || 'Unable to load payroll processing.' }
  finally { loading.value = false }
}
async function review(action: 'finalize' | 'reject' | 'cancel', reason = '') {
  if (!selectedId.value || busy.value) return
  busy.value = true; actionError.value = ''; success.value = ''
  try {
    await $fetch(`/api/payroll/processing/${selectedId.value}`, { method: 'POST', body: { action, reason } })
    selectedId.value = null
    await load()
    success.value = action === 'finalize' ? 'Payroll finalized. Employee payroll records, eligible deductions, and approved adjustments were posted.' : action === 'cancel' ? 'Finalization cancelled. Payroll and deduction receipts were voided, balances restored, and the DTR returned to Draft.' : 'Returned to Draft. Correct the DTR and compute it again before finalizing.'
  } catch (caught: any) { actionError.value = caught?.data?.statusMessage || caught?.message || 'Unable to save payroll review.' }
  finally { busy.value = false }
}
onMounted(load)
</script>

<template>
  <section class="processing-page">
    <header class="heading"><div><p class="eyebrow">PAYROLL</p><h1>Payroll Processing</h1><p>Review computed DTRs by site, then finalize payroll in the same screen.</p></div><button type="button" class="secondary refresh" :disabled="loading" @click="load">{{ loading?'Refreshing…':'Refresh' }}</button></header>
    <p class="workflow-note">Finalization posts employee payroll, eligible fixed-site installments, and approved prior-period adjustments. BTR reliever hours are a separate earning at the regular rate effective on each covered date. Payslip release is separate.</p>
    <div class="filters">
      <label class="search-field">Search site or employee<input v-model="search" type="search" placeholder="Search site, client, DTR, or employee"></label>
      <label>Agency<select v-model="agency" @change="client='' "><option value="">All agencies</option><option v-for="[id, name] in agencies" :key="id" :value="String(id)">{{ name }}</option></select></label>
      <label>Client<select v-model="client"><option value="">All clients</option><option v-for="[id, name] in clients" :key="id" :value="String(id)">{{ name }}</option></select></label>
      <label>Cutoff<select v-model="cutoff" @change="load"><option value="">Latest cutoff</option><option v-for="item in data.cutoffs" :key="item.start+item.end" :value="`${item.start}:${item.end}`">{{ range(item) }}</option></select></label>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="success" class="success" role="status">{{ success }}</p>
    <div class="list-top"><p>Showing {{ visible.length }} site DTRs<span v-if="data.selectedCutoff"> · {{ range(data.selectedCutoff) }}</span></p><div class="status-tabs" aria-label="Review status filters"><button v-for="item in [{key:'current',label:'Current'}, {key:'Pending',label:'To review'}, {key:'Approved',label:'Finalized'}, {key:'Rejected',label:'Returned'}, {key:'Cancelled',label:'Cancelled'}]" :key="item.key" type="button" :class="{active:statusFilter===item.key}" @click="statusFilter=item.key">{{ item.label }} <span>{{ item.key==='current'?data.sites.length-(counts.Rejected||0)-(counts.Cancelled||0):counts[item.key]||0 }}</span></button></div></div>
    <div v-if="visible.length" class="summary-strip"><div><span>Employees</span><strong>{{ totals.people }}</strong></div><div><span>Gross</span><strong>{{ money(totals.gross) }}</strong></div><div><span>Deductions</span><strong>{{ money(totals.deductions) }}</strong></div><div><span>Net for review</span><strong>{{ money(totals.net) }}</strong></div></div>
    <div class="table-wrap"><table class="processing-table"><thead><tr><th>Site / Client</th><th>Agency / DTR</th><th>Employees</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Review</th><th>Action</th></tr></thead><tbody>
      <tr v-for="site in visible" :key="site.BatchID"><td><strong>{{ site.SiteName }}</strong><small>{{ site.ClientName }}</small></td><td><strong>{{ site.AgencyName }}</strong><small>DTR-{{ String(site.BatchID).padStart(4, '0') }}</small></td><td>{{ site.peopleCount }}</td><td>{{ money(site.gross) }}</td><td>{{ money(site.deductions) }}</td><td><strong>{{ money(site.netPreview) }}</strong></td><td><span class="review-chip" :class="String(site.ReviewStatus || 'Pending').toLowerCase()">{{ site.ReviewStatus==='Approved'?'Finalized':site.ReviewStatus==='Rejected'?'Returned':site.ReviewStatus==='Cancelled'?'Cancelled':'To review' }}</span><small v-if="site.warningCount && site.ReviewStatus==='Pending'" class="note-count">{{ site.warningCount }} payroll note{{ site.warningCount===1?'':'s' }}</small></td><td><button type="button" class="secondary" @click="selectedId=Number(site.BatchID);actionError='';success=''">{{ site.ReviewStatus==='Pending'?'Review':'View details' }}</button></td></tr>
      <tr v-if="!visible.length"><td colspan="8" class="empty">{{ loading?'Loading site DTRs…':statusFilter==='current' && counts.Rejected?'No current DTRs. Open Returned to view rejected history.':'No site DTRs match these filters.' }}</td></tr>
    </tbody></table></div>
    <PayrollProcessingDetailModal v-if="selectedSite" :site="selectedSite" :can-review="!!data.permissions?.canReview" :busy="busy" :error="actionError" @close="selectedId=null" @approve="review('finalize')" @reject="reason=>review('reject', reason)" @cancel="reason=>review('cancel', reason)" />
  </section>
</template>
