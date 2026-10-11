<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type Cutoff = { PeriodStart: string; PeriodEnd: string }
type Agency = { AgencyID: number; AgencyName: string }
type HistoryRow = {
  BatchID: number; AgencyID: number; AgencyName: string; ClientName: string; SiteName: string
  PeriodStart: string; PeriodEnd: string; ActiveCount: number; CancelledCount: number
  Gross: number; Deductions: number; Net: number
  CancelledGross: number; CancelledDeductions: number; CancelledNet: number
  LastActionAt: string | null; status: 'Finalized' | 'Cancelled'
}
type HistoryList = {
  items: HistoryRow[]; cutoffs: Cutoff[]; agencies: Agency[]
  summary: { Total: number; EmployeeCount: number; Gross: number; Deductions: number; Net: number }
  pagination: { page: number; pageSize: number; total: number; pages: number }
}
type PayrollRow = {
  PostingID: number; PayrollID: number; PostingStatus: 'Active' | 'Cancelled'; PayrollStatus: string
  CancelledAt: string | null; EmployeeID: number; EmployeeNumber: string | null; EmployeeName: string
  AssignmentType: string; GrossPay: number; TotalDeduction: number; NetPay: number
}
type HistoryDetail = {
  batch: Pick<HistoryRow, 'BatchID' | 'AgencyName' | 'ClientName' | 'SiteName' | 'PeriodStart' | 'PeriodEnd'>
  payrolls: PayrollRow[]
  events: Array<{ EventID: number; Action: string; ActorName: string; ActorRole: string | null; ActorDepartment: string | null; Reason: string | null; CreatedAt: string }>
}

const emptyList = (): HistoryList => ({ items: [], cutoffs: [], agencies: [], summary: { Total: 0, EmployeeCount: 0, Gross: 0, Deductions: 0, Net: 0 }, pagination: { page: 1, pageSize: 20, total: 0, pages: 1 } })
const data = ref<HistoryList>(emptyList())
const search = ref('')
const agencyId = ref('')
const cutoff = ref('')
const status = ref('all')
const page = ref(1)
const loading = ref(false)
const error = ref('')
const detail = ref<HistoryDetail | null>(null)
const selectedBatchId = ref<number | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const detailTab = ref<'current' | 'audit'>('current')

const activePayrolls = computed(() => detail.value?.payrolls.filter(row => row.PostingStatus === 'Active' && ['Approved', 'Released'].includes(row.PayrollStatus)) || [])
const cancelledPayrolls = computed(() => detail.value?.payrolls.filter(row => row.PostingStatus === 'Cancelled' || row.PayrollStatus === 'Cancelled') || [])
const currentTotals = computed(() => activePayrolls.value.reduce((totals, row) => {
  totals.gross += Math.round(Number(row.GrossPay) * 100)
  totals.deductions += Math.round(Number(row.TotalDeduction) * 100)
  totals.net += Math.round(Number(row.NetPay) * 100)
  return totals
}, { gross: 0, deductions: 0, net: 0 }))
const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0))
const day = (value?: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const moment = (value?: string | null) => value ? new Date(value.replace(' ', 'T')).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const period = (start: string, end: string) => `${day(start)} – ${day(end)}`
const employeeNumber = (row: PayrollRow) => row.EmployeeNumber?.trim() || `EMP-${String(row.EmployeeID).padStart(4, '0')}`
const rowGross = (row: HistoryRow) => row.status === 'Finalized' ? row.Gross : row.CancelledGross
const rowDeductions = (row: HistoryRow) => row.status === 'Finalized' ? row.Deductions : row.CancelledDeductions
const rowNet = (row: HistoryRow) => row.status === 'Finalized' ? row.Net : row.CancelledNet

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [periodStart, periodEnd] = cutoff.value.split(':')
    data.value = await $fetch<HistoryList>('/api/payroll/history', { query: {
      search: search.value.trim(), agencyId: agencyId.value || undefined, status: status.value,
      periodStart: periodStart || undefined, periodEnd: periodEnd || undefined, page: page.value,
    } })
  } catch (caught: any) {
    error.value = caught?.data?.statusMessage || caught?.message || 'Unable to load payroll history.'
  } finally { loading.value = false }
}

async function openDetail(batchId: number) {
  selectedBatchId.value = batchId
  detail.value = null
  detailTab.value = 'current'
  detailError.value = ''
  detailLoading.value = true
  try {
    const result = await $fetch<HistoryDetail>(`/api/payroll/history/${batchId}`)
    if (selectedBatchId.value === batchId) {
      detail.value = result
      if (!result.payrolls.some(row => row.PostingStatus === 'Active' && ['Approved', 'Released'].includes(row.PayrollStatus))) detailTab.value = 'audit'
    }
  } catch (caught: any) {
    if (selectedBatchId.value === batchId) detailError.value = caught?.data?.statusMessage || caught?.message || 'Unable to load payroll details.'
  } finally { if (selectedBatchId.value === batchId) detailLoading.value = false }
}
function closeDetail() { selectedBatchId.value = null; detail.value = null; detailError.value = ''; detailTab.value = 'current' }
function applyFilters() { page.value = 1; load() }
function changePage(next: number) { page.value = next; load() }
onMounted(load)
</script>

<template>
  <section class="history-page">
    <header class="page-head"><div><p class="eyebrow">PAYROLL</p><h1>Payroll History</h1><p>Review finalized site payroll, employee totals, and cancellation history.</p></div><button type="button" class="secondary" :disabled="loading" @click="load">{{ loading ? 'Refreshing…' : 'Refresh' }}</button></header>
    <div class="notice">Amounts come from posted payroll records. Cancelled payroll is kept for audit and excluded from current totals.</div>

    <form class="filters" @submit.prevent="applyFilters">
      <label class="search-field">Search<input v-model="search" type="search" placeholder="Site, client, DTR, or employee"></label>
      <label>Agency<select v-model="agencyId" @change="applyFilters"><option value="">All agencies</option><option v-for="agency in data.agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option></select></label>
      <label>Cutoff<select v-model="cutoff" @change="applyFilters"><option value="">All cutoffs</option><option v-for="item in data.cutoffs" :key="`${item.PeriodStart}:${item.PeriodEnd}`" :value="`${item.PeriodStart}:${item.PeriodEnd}`">{{ period(item.PeriodStart, item.PeriodEnd) }}</option></select></label>
      <label>Status<select v-model="status" @change="applyFilters"><option value="all">All</option><option value="Finalized">Finalized</option><option value="Cancelled">Cancelled</option></select></label>
      <button type="submit" class="primary" :disabled="loading">Search</button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="summary-strip"><div><span>Site cutoffs</span><strong>{{ data.summary.Total }}</strong></div><div><span>Current employees</span><strong>{{ data.summary.EmployeeCount }}</strong></div><div><span>Current gross</span><strong>{{ money(data.summary.Gross) }}</strong></div><div><span>Current deductions</span><strong>{{ money(data.summary.Deductions) }}</strong></div><div><span>Current net</span><strong>{{ money(data.summary.Net) }}</strong></div></div>
    <p class="result-count">Showing {{ data.items.length }} of {{ data.pagination.total }} site cutoffs</p>
    <div class="table-wrap"><table><thead><tr><th>Cutoff / DTR</th><th>Site / Client</th><th>Agency</th><th>Employees</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Status</th><th>Action</th></tr></thead><tbody>
      <tr v-for="row in data.items" :key="row.BatchID"><td><strong>{{ period(row.PeriodStart, row.PeriodEnd) }}</strong><small>DTR-{{ String(row.BatchID).padStart(4, '0') }}</small></td><td><strong>{{ row.SiteName }}</strong><small>{{ row.ClientName }}</small></td><td>{{ row.AgencyName }}</td><td>{{ row.status === 'Finalized' ? row.ActiveCount : row.CancelledCount }}</td><td>{{ money(rowGross(row)) }}</td><td>{{ money(rowDeductions(row)) }}</td><td><strong>{{ money(rowNet(row)) }}</strong><small v-if="row.status === 'Cancelled'">Voided amount</small></td><td><span class="status-chip" :class="row.status.toLowerCase()">{{ row.status }}</span><small v-if="row.LastActionAt">{{ moment(row.LastActionAt) }}</small></td><td><button type="button" class="secondary" @click="openDetail(row.BatchID)">View details</button></td></tr>
      <tr v-if="!data.items.length"><td colspan="9" class="empty">{{ loading ? 'Loading payroll history…' : 'No finalized or cancelled payroll matches these filters.' }}</td></tr>
    </tbody></table></div>
    <div class="pagination"><button type="button" class="secondary" :disabled="loading || page <= 1" @click="changePage(page - 1)">Previous</button><span>Page {{ data.pagination.page }} of {{ data.pagination.pages }}</span><button type="button" class="secondary" :disabled="loading || page >= data.pagination.pages" @click="changePage(page + 1)">Next</button></div>

    <div v-if="selectedBatchId" class="modal-backdrop" @click.self="closeDetail">
      <section class="detail-modal" role="dialog" aria-modal="true" aria-label="Payroll history details">
        <header class="modal-head">
          <div>
            <p class="eyebrow">PAYROLL HISTORY · DTR-{{ String(selectedBatchId).padStart(4, '0') }}</p>
            <h2>{{ detail?.batch.SiteName || 'Site payroll' }}</h2>
            <p v-if="detail">{{ detail.batch.ClientName }} · {{ detail.batch.AgencyName }} · {{ period(detail.batch.PeriodStart, detail.batch.PeriodEnd) }}</p>
          </div>
          <button type="button" class="close" aria-label="Close details" @click="closeDetail">×</button>
        </header>
        <div class="modal-body">
          <p v-if="detailError" class="error" role="alert">{{ detailError }}</p>
          <p v-if="detailLoading" class="empty">Loading payroll details…</p>
          <template v-if="detail">
            <div class="modal-summary" aria-label="Current posted payroll totals">
              <div><span>Employees</span><strong>{{ activePayrolls.length }}</strong></div>
              <div><span>Gross</span><strong>{{ money(currentTotals.gross / 100) }}</strong></div>
              <div><span>Deductions</span><strong>{{ money(currentTotals.deductions / 100) }}</strong></div>
              <div class="net-summary"><span>Net pay</span><strong>{{ money(currentTotals.net / 100) }}</strong></div>
            </div>
            <p class="summary-note">Current posted amounts only. Cancelled records are excluded.</p>
            <div class="detail-tabs" role="tablist" aria-label="Payroll detail sections">
              <button id="history-current-tab" type="button" role="tab" :aria-selected="detailTab === 'current'" aria-controls="history-current-panel" :class="{ active: detailTab === 'current' }" @click="detailTab = 'current'">Current payroll <span>{{ activePayrolls.length }}</span></button>
              <button id="history-audit-tab" type="button" role="tab" :aria-selected="detailTab === 'audit'" aria-controls="history-audit-panel" :class="{ active: detailTab === 'audit' }" @click="detailTab = 'audit'">Cancelled &amp; audit <span>{{ cancelledPayrolls.length }}</span></button>
            </div>
            <section v-if="detailTab === 'current'" id="history-current-panel" role="tabpanel" aria-labelledby="history-current-tab">
              <div class="section-head"><h3>Current finalized payroll</h3><span>{{ activePayrolls.length }} employee{{ activePayrolls.length === 1 ? '' : 's' }}</span></div>
              <p class="section-note">These posted amounts are included in the current totals above.</p>
              <div v-if="activePayrolls.length" class="detail-table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>Payroll</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Status</th></tr></thead><tbody>
                <tr v-for="row in activePayrolls" :key="row.PostingID"><td><strong>{{ row.EmployeeName }}</strong><small>{{ employeeNumber(row) }}</small></td><td>{{ row.AssignmentType }}</td><td>#{{ row.PayrollID }}</td><td>{{ money(row.GrossPay) }}</td><td>{{ money(row.TotalDeduction) }}</td><td><strong>{{ money(row.NetPay) }}</strong></td><td><span class="status-chip finalized">{{ row.PayrollStatus }}</span></td></tr>
              </tbody></table></div>
              <p v-else class="empty-block">No current finalized payroll for this site cutoff.</p>
            </section>
            <div v-else id="history-audit-panel" role="tabpanel" aria-labelledby="history-audit-tab" class="audit-panel">
              <section>
                <div class="section-head"><h3>Cancelled payroll records</h3><span>{{ cancelledPayrolls.length }} employee record{{ cancelledPayrolls.length === 1 ? '' : 's' }}</span></div>
                <p class="section-note">Preserved for audit. These amounts are excluded from current totals.</p>
                <div v-if="cancelledPayrolls.length" class="detail-table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>Payroll</th><th>Former gross</th><th>Former deductions</th><th>Former net</th><th>Cancelled</th></tr></thead><tbody>
                  <tr v-for="row in cancelledPayrolls" :key="row.PostingID"><td><strong>{{ row.EmployeeName }}</strong><small>{{ employeeNumber(row) }}</small></td><td>{{ row.AssignmentType }}</td><td>#{{ row.PayrollID }}</td><td>{{ money(row.GrossPay) }}</td><td>{{ money(row.TotalDeduction) }}</td><td>{{ money(row.NetPay) }}</td><td>{{ moment(row.CancelledAt) }}</td></tr>
                </tbody></table></div>
                <p v-else class="empty-block">No cancelled payroll records for this site cutoff.</p>
              </section>
              <section>
                <div class="section-head"><h3>Audit trail</h3><span>{{ detail.events.length }} event{{ detail.events.length === 1 ? '' : 's' }}</span></div>
                <div v-if="detail.events.length" class="events"><div v-for="event in detail.events" :key="event.EventID" class="event"><span class="event-dot"/><div><strong>{{ event.Action === 'Approve Payroll' ? 'Finalized payroll' : 'Cancelled finalization' }}</strong><small>{{ event.ActorName }}{{ event.ActorRole ? ` · ${event.ActorRole}` : '' }} · {{ moment(event.CreatedAt) }}</small><p v-if="event.Reason">{{ event.Reason }}</p></div></div></div>
                <p v-else class="empty-block">No finalize/cancel events recorded.</p>
              </section>
            </div>
          </template>
        </div>
        <footer class="modal-foot"><button type="button" class="secondary" @click="closeDetail">Close</button></footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.history-page{--ink:#112b53;--muted:#657d9f;--line:#d5e1f2;color:var(--ink);padding:34px 36px 48px;font-family:Inter,'Segoe UI',sans-serif}.page-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.eyebrow{margin:0;color:#2863db;font-size:.72rem;font-weight:850;letter-spacing:.09em}.page-head h1{margin:6px 0 5px;font-size:2rem}.page-head p:not(.eyebrow),.modal-head p:not(.eyebrow){margin:0;color:var(--muted)}.primary,.secondary{font:inherit;font-weight:750;border-radius:9px;min-height:44px;padding:0 16px;cursor:pointer}.primary{background:#2864e8;color:#fff;border:1px solid #2864e8}.secondary{background:#fff;color:#1b4b91;border:1px solid #c8d7ed}.secondary:disabled,.primary:disabled{opacity:.5;cursor:default}.notice{margin:20px 0;padding:14px 16px;background:#ebf2ff;border-left:3px solid #6895ff;border-radius:8px;color:#315486}.filters{display:grid;grid-template-columns:minmax(230px,1.6fr) repeat(3,minmax(150px,1fr)) auto;align-items:end;gap:12px;margin:22px 0}.filters label{display:grid;gap:7px;color:#3b5478;font-size:.78rem;font-weight:750}.filters input,.filters select{min-height:48px;border:1px solid #cbd9ee;border-radius:9px;background:#fff;color:var(--ink);padding:0 13px;font:inherit;font-size:.86rem}.summary-strip{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:18px 0}.summary-strip>div{border:1px solid var(--line);background:#fff;border-radius:11px;padding:15px}.summary-strip span,.summary-strip strong{display:block}.summary-strip span{font-size:.7rem;color:var(--muted);text-transform:uppercase;font-weight:750}.summary-strip strong{margin-top:6px;font-size:1.1rem}.result-count{font-size:.78rem;color:var(--muted);margin:18px 0 10px}.error{background:#fff1f1;border:1px solid #fecaca;border-radius:8px;color:#9c2525;padding:12px}.table-wrap,.detail-table-wrap{overflow:auto;background:#fff;border:1px solid var(--line);border-radius:13px}table{width:100%;border-collapse:collapse}th,td{padding:14px 13px;text-align:left;border-bottom:1px solid #e5edf8;white-space:nowrap}th{background:#f3f7fc;color:#526c92;font-size:.68rem;text-transform:uppercase;letter-spacing:.025em}td{font-size:.8rem}td strong,td small{display:block}td small{margin-top:4px;color:var(--muted);font-size:.7rem}tr:last-child td{border-bottom:0}.empty{text-align:center;color:var(--muted);padding:30px!important}.status-chip{display:inline-block;border-radius:99px;padding:5px 10px;font-size:.7rem;font-weight:800}.status-chip.finalized{background:#d9fbe8;color:#087245}.status-chip.cancelled{background:#eef1f6;color:#576780}.pagination{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:16px;font-size:.78rem;color:var(--muted)}.modal-backdrop{position:fixed;inset:0;z-index:1200;background:rgba(20,36,64,.52);display:flex;align-items:center;justify-content:center;padding:24px}.detail-modal{display:flex;flex-direction:column;width:min(1450px,100%);max-height:calc(100vh - 48px);background:#fff;border:1px solid var(--line);border-radius:20px;box-shadow:0 25px 75px rgba(9,31,75,.28);overflow:hidden}.modal-head{display:flex;justify-content:space-between;gap:20px;padding:27px 32px 22px;border-bottom:1px solid var(--line)}.modal-head h2{margin:6px 0 5px;font-size:1.65rem}.close{align-self:flex-start;width:38px;height:38px;border:0;background:transparent;color:#48648d;font-size:1.75rem;cursor:pointer}.modal-body{overflow:auto;padding:25px 32px;background:#fafcff}.modal-body section+section{margin-top:30px}.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:20px}.section-head h3{margin:0;font-size:1.05rem}.section-head span,.section-note{font-size:.76rem;color:var(--muted)}.section-note{margin:6px 0 12px}.empty-block{border:1px solid var(--line);border-radius:9px;padding:17px;color:var(--muted);font-size:.8rem}.events{border:1px solid var(--line);border-radius:11px;background:#fff}.event{display:flex;gap:13px;padding:15px 17px}.event+.event{border-top:1px solid #e5edf8}.event-dot{width:9px;height:9px;border-radius:50%;background:#2864e8;margin-top:6px;flex:none}.event strong,.event small{display:block}.event strong{font-size:.81rem}.event small{color:var(--muted);font-size:.74rem;margin-top:4px}.event p{font-size:.77rem;margin:8px 0 0}.modal-foot{display:flex;justify-content:flex-end;padding:14px 32px;border-top:1px solid var(--line)}
.modal-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.modal-summary>div{min-width:0;border:1px solid var(--line);border-radius:11px;background:#fff;padding:14px 17px}
.modal-summary span,.modal-summary strong{display:block}
.modal-summary span{color:var(--muted);font-size:.7rem;font-weight:750;text-transform:uppercase}
.modal-summary strong{margin-top:6px;font-size:1.1rem;overflow-wrap:anywhere}
.modal-summary .net-summary{background:#eaf2ff;border-color:#bfd4fb}
.modal-summary .net-summary strong{color:#174eaf}
.summary-note{margin:9px 0 20px;color:var(--muted);font-size:.75rem}
.detail-tabs{display:flex;gap:8px;margin-bottom:20px;border-bottom:1px solid var(--line)}
.detail-tabs button{display:flex;align-items:center;gap:8px;margin-bottom:-1px;padding:11px 14px;border:0;border-bottom:3px solid transparent;background:transparent;color:#5f7495;font:inherit;font-size:.82rem;font-weight:750;cursor:pointer}
.detail-tabs button.active{border-bottom-color:#2864e8;color:#1856c4}
.detail-tabs button span{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:20px;background:#e9eff9;font-size:.7rem}
.detail-tabs button.active span{background:#dce9ff}
.detail-tabs button:focus-visible{outline:2px solid #2864e8;outline-offset:2px}
.audit-panel section+section{margin-top:30px}
@media(max-width:1100px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}.filters .search-field{grid-column:1/-1}.summary-strip{grid-template-columns:repeat(3,1fr)}}
@media(max-width:650px){.history-page{padding:24px 16px}.page-head h1{font-size:1.6rem}.filters{grid-template-columns:1fr}.filters .search-field{grid-column:auto}.summary-strip{grid-template-columns:repeat(2,1fr)}.modal-backdrop{padding:0}.detail-modal{height:100vh;max-height:100vh;border-radius:0}.modal-head,.modal-body,.modal-foot{padding-left:17px;padding-right:17px}}
@media(max-width:650px){.modal-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.detail-tabs button{padding:10px 8px;font-size:.75rem}}
</style>
