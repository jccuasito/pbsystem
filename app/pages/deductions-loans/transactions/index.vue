<script setup lang="ts">
import ModernDateField from '~~/components/ModernDateField.vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'

type Transaction = {
  EntryType: 'Loan' | 'Deduction'
  TransactionRecordID: number
  SourceRecordID: number
  TransactionID: string
  AccountReference: string
  IssuanceCode: string | null
  TransactionDate: string
  CutoffStartDate: string | null
  CutoffEndDate: string | null
  Amount: number
  BalanceBefore: number
  BalanceAfter: number
  Status: 'Posted' | 'Voided'
  PayrollID: number | null
  PayrollStatus: 'Approved' | 'Released'
  Remarks: string | null
  EmployeeID: number
  EmployeeNumber: string | null
  EmployeeName: string
  AgencyID: number | null
  AgencyName: string | null
  PositionName: string | null
  ItemName: string
  ClassificationName: string | null
  CreatedAt: string
}

const loading = ref(false)
const error = ref('')
const items = ref<Transaction[]>([])
const agencies = ref<Array<{ AgencyID: number; AgencyName: string }>>([])
const selected = ref<Transaction | null>(null)
const page = ref(1)
const filters = reactive({ search: '', entryType: '', status: '', agencyId: '', dateFrom: '', dateTo: '' })
const pagination = reactive({ page: 1, pageSize: 25, total: 0, pages: 1 })
const summary = reactive({ Total: 0, Loans: 0, Deductions: 0, TotalAmount: 0 })

function money(value: unknown) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0))
}
function date(value: string | null) {
  if (!value) return '—'
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}
function employeeNumber(item: Transaction) {
  return item.EmployeeNumber || `EMP-${String(item.EmployeeID).padStart(4, '0')}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const query: Record<string, string | number> = { page: page.value, pageSize: pagination.pageSize }
    for (const [key, value] of Object.entries(filters)) if (value) query[key] = value
    const response = await $fetch<any>('/api/deductions-loans/transactions', { query })
    items.value = response.items || []
    agencies.value = response.agencies || []
    Object.assign(summary, response.summary || {})
    Object.assign(pagination, response.pagination || {})
  } catch (cause: any) {
    error.value = cause?.data?.statusMessage || cause?.message || 'Unable to load transaction receipts.'
  } finally {
    loading.value = false
  }
}
function applyFilters() { page.value = 1; load() }
function clearFilters() {
  Object.assign(filters, { search: '', entryType: '', status: '', agencyId: '', dateFrom: '', dateTo: '' })
  applyFilters()
}
function goPage(next: number) {
  page.value = Math.min(Math.max(1, next), pagination.pages)
  load()
}

onMounted(load)
useRealtimeRefresh(load)
</script>

<template>
  <section class="transactions-page">
    <header class="page-head">
      <div><span class="eyebrow">EMPLOYEE ACCOUNTS</span><h1>Transaction Receipts</h1><p>Review receipts created only after a loan or deduction is posted through an approved or released payroll.</p></div>
    </header>

    <div class="summary-grid">
      <article><span>Transactions</span><strong>{{ Number(summary.Total || 0).toLocaleString() }}</strong></article>
      <article><span>Loans</span><strong>{{ Number(summary.Loans || 0).toLocaleString() }}</strong></article>
      <article><span>Deductions</span><strong>{{ Number(summary.Deductions || 0).toLocaleString() }}</strong></article>
      <article><span>Total deducted</span><strong>{{ money(summary.TotalAmount) }}</strong></article>
    </div>

    <form class="receipt-filters" @submit.prevent="applyFilters">
      <label class="search-field"><span>Search transactions</span><input v-model.trim="filters.search" type="search" placeholder="Transaction ID, employee, reference, or catalog entry"></label>
      <label><span>Type</span><select v-model="filters.entryType"><option value="">All types</option><option value="Loan">Loan</option><option value="Deduction">Deduction</option></select></label>
      <label><span>Status</span><select v-model="filters.status"><option value="">All statuses</option><option value="Posted">Posted</option><option value="Voided">Voided</option></select></label>
      <label><span>Agency</span><select v-model="filters.agencyId"><option value="">All agencies</option><option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option></select></label>
      <ModernDateField v-model="filters.dateFrom" label="From" placeholder="Start date" align="start" />
      <ModernDateField v-model="filters.dateTo" label="To" placeholder="End date" :min="filters.dateFrom || undefined" align="start" />
      <div class="filter-actions"><button type="button" @click="clearFilters">Clear</button><button class="primary" type="submit">Search</button></div>
    </form>

    <p v-if="error" class="error">{{ error }}</p>
    <div class="receipt-table-wrap" :aria-busy="loading">
      <table>
        <thead><tr><th>Transaction ID</th><th>Date</th><th>Employee</th><th>Type / Catalog</th><th>Amount</th><th>Balance</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-for="item in items" :key="item.TransactionRecordID">
            <td><strong class="transaction-code">{{ item.TransactionID }}</strong><small>Account {{ item.AccountReference }} · Issuance {{ item.IssuanceCode || 'Legacy' }}</small></td>
            <td>{{ date(item.TransactionDate) }}</td>
            <td><strong>{{ item.EmployeeName }}</strong><small>{{ employeeNumber(item) }} · {{ item.AgencyName || 'Unassigned' }}</small></td>
            <td><span class="kind" :class="item.EntryType.toLowerCase()">{{ item.EntryType }}</span><strong>{{ item.ItemName }}</strong><small>{{ item.ClassificationName || 'Unclassified' }}</small></td>
            <td><strong>{{ money(item.Amount) }}</strong></td>
            <td>{{ money(item.BalanceAfter) }}</td>
            <td><span class="receipt-status" :class="item.Status.toLowerCase()">{{ item.Status }}</span></td>
            <td><button class="view-button" type="button" @click="selected=item">View receipt</button></td>
          </tr>
          <tr v-if="loading"><td colspan="8" class="empty">Loading transaction receipts…</td></tr>
          <tr v-else-if="!items.length"><td colspan="8" class="empty">No transaction receipts match the selected filters.</td></tr>
        </tbody>
      </table>
    </div>

    <footer class="pagination"><span>Showing {{ items.length }} of {{ pagination.total }} transactions</span><div><button :disabled="page<=1" @click="goPage(page-1)">Previous</button><strong>Page {{ pagination.page }} of {{ pagination.pages }}</strong><button :disabled="page>=pagination.pages" @click="goPage(page+1)">Next</button></div></footer>

    <div v-if="selected" class="receipt-layer" @click.self="selected=null">
      <section class="receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
        <button class="close" type="button" aria-label="Close receipt" @click="selected=null">×</button>
        <header><span class="eyebrow">TRANSACTION RECEIPT</span><h2 id="receipt-title">{{ selected.TransactionID }}</h2><p>{{ selected.EntryType }} deduction · {{ date(selected.TransactionDate) }}</p></header>
        <div class="receipt-status-line"><span class="receipt-status" :class="selected.Status.toLowerCase()">{{ selected.Status }}</span><span>Payroll #{{ selected.PayrollID }} · {{ selected.PayrollStatus }}</span></div>
        <dl>
          <div><dt>Employee</dt><dd>{{ selected.EmployeeName }}</dd><small>{{ employeeNumber(selected) }} · {{ selected.PositionName || 'No position' }}</small></div>
          <div><dt>Agency</dt><dd>{{ selected.AgencyName || 'Unassigned' }}</dd></div>
          <div><dt>Classification</dt><dd>{{ selected.ClassificationName || 'Unclassified' }}</dd></div>
          <div><dt>Catalog entry</dt><dd>{{ selected.ItemName }}</dd></div>
          <div><dt>Account reference</dt><dd>{{ selected.AccountReference }}</dd></div>
          <div><dt>Issuance code</dt><dd>{{ selected.IssuanceCode || 'Legacy record' }}</dd></div>
          <div><dt>Transaction date</dt><dd>{{ date(selected.TransactionDate) }}</dd></div>
          <div><dt>Cutoff</dt><dd>{{ selected.CutoffStartDate ? `${date(selected.CutoffStartDate)} – ${date(selected.CutoffEndDate)}` : 'Not recorded' }}</dd></div>
          <div><dt>Deducted amount</dt><dd>{{ money(selected.Amount) }}</dd></div>
          <div><dt>Balance before</dt><dd>{{ money(selected.BalanceBefore) }}</dd></div>
          <div><dt>Balance after</dt><dd>{{ money(selected.BalanceAfter) }}</dd></div>
        </dl>
        <div v-if="selected.Remarks" class="receipt-remarks"><span>Remarks</span><p>{{ selected.Remarks }}</p></div>
        <p class="receipt-note">This read-only receipt is generated automatically when the deduction is posted through an approved or released payroll.</p>
        <footer><button type="button" @click="selected=null">Close</button></footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.transactions-page{--ink:#112d57;--muted:#687a96;max-width:1440px;margin:0 auto;color:var(--ink)}.page-head{display:flex;justify-content:space-between;gap:24px;margin-bottom:22px}.eyebrow{display:block;margin-bottom:6px;color:#2867d8;font-size:.72rem;font-weight:850;letter-spacing:.1em}.page-head h1,.receipt-modal h2{margin:0;color:#102c56}.page-head h1{font-size:2rem}.page-head p,.receipt-modal header p{margin:7px 0 0;color:var(--muted)}
.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}.summary-grid article{padding:16px 18px;border:1px solid #d9e4f2;border-radius:12px;background:#fff}.summary-grid span{display:block;color:#6a7b95;font-size:.68rem;font-weight:800;text-transform:uppercase}.summary-grid strong{display:block;margin-top:7px;font-size:1.25rem}
.receipt-filters{display:grid;grid-template-columns:minmax(260px,1.5fr) repeat(3,minmax(130px,.75fr)) repeat(2,minmax(145px,.8fr)) auto;align-items:end;gap:10px;margin-bottom:18px;padding:15px;border:1px solid #dce5f1;border-radius:13px;background:#fff}.receipt-filters label{display:grid;gap:6px;color:#405675;font-size:.72rem;font-weight:800}.receipt-filters input,.receipt-filters select{box-sizing:border-box;width:100%;min-height:44px;border:1px solid #cbd8e8;border-radius:8px;background:#fff;padding:0 12px;color:#17355e;font:inherit}.receipt-filters :deep(.modern-date-field){gap:6px;font-size:.72rem}.receipt-filters :deep(.modern-date-field__trigger){min-height:44px;border-radius:8px;padding-inline:12px}.filter-actions{display:flex;gap:7px}.filter-actions button,.view-button,.pagination button,.receipt-modal footer button{min-height:42px;border:1px solid #cbd8e8;border-radius:8px;background:#fff;padding:8px 13px;color:#25466f;font:inherit;font-weight:800;cursor:pointer}.filter-actions .primary{border-color:#2867d8;background:#2867d8;color:#fff}.filter-actions button:hover,.view-button:hover,.pagination button:hover:not(:disabled),.receipt-modal footer button:hover{border-color:#9db7de;background:#f1f6ff}
.receipt-table-wrap{overflow:auto;border:1px solid #dae4f1;border-radius:13px;background:#fff}.receipt-table-wrap table{width:100%;min-width:1180px;border-collapse:separate;border-spacing:0;font-size:.79rem}.receipt-table-wrap th,.receipt-table-wrap td{padding:13px 14px;border-bottom:1px solid #e5ebf4;text-align:left;vertical-align:middle}.receipt-table-wrap th{background:#f5f8fc;color:#586b86;font-size:.67rem;text-transform:uppercase}.receipt-table-wrap tr:last-child td{border-bottom:0}.receipt-table-wrap td>strong,.receipt-table-wrap td>small{display:block}.receipt-table-wrap td>small{margin-top:4px;color:#71819a;font-size:.68rem}.transaction-code{color:#1955be;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.02em}.kind{display:inline-flex;margin:0 7px 5px 0;padding:4px 8px;border-radius:999px;font-size:.65rem;font-weight:850}.kind.loan{background:#e7efff;color:#2053b4}.kind.deduction{background:#f3e5ff;color:#7d28ba}.receipt-status{display:inline-flex;padding:5px 9px;border-radius:999px;font-size:.67rem;font-weight:850}.receipt-status.posted{background:#dcf8e7;color:#087a39}.receipt-status.voided{background:#edf0f4;color:#58677b}.empty{padding:42px!important;color:#71819a;text-align:center!important}.error{color:#b42318}.pagination{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:14px;color:#687993;font-size:.75rem}.pagination>div{display:flex;align-items:center;gap:10px}.pagination button:disabled{opacity:.45;cursor:not-allowed}
.receipt-layer{position:fixed;z-index:90;inset:0;display:grid;place-items:center;padding:22px;background:rgba(15,27,52,.36)}.receipt-modal{position:relative;width:min(760px,100%);max-height:90vh;overflow:auto;box-sizing:border-box;padding:28px;border-radius:17px;background:#fff;box-shadow:0 24px 70px rgba(20,39,72,.25)}.receipt-modal>.close{position:absolute;right:19px;top:15px;border:0;background:transparent;color:#25466f;font-size:1.7rem;cursor:pointer}.receipt-status-line{display:flex;align-items:center;gap:10px;margin:20px 0;padding:11px 13px;border-radius:9px;background:#f5f8fc;color:#697a94;font-size:.74rem}.receipt-modal dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0}.receipt-modal dl>div{padding:13px;border:1px solid #dce5f1;border-radius:9px}.receipt-modal dt,.receipt-remarks>span{color:#71819a;font-size:.66rem;font-weight:800;text-transform:uppercase}.receipt-modal dd{margin:5px 0 0;color:#17365f;font-weight:800}.receipt-modal dl small{display:block;margin-top:4px;color:#6e7e96}.receipt-remarks{margin-top:10px;padding:13px;border:1px solid #dce5f1;border-radius:9px}.receipt-remarks p{margin:5px 0 0;color:#405675}.receipt-note{margin:16px 0 0;padding:11px 13px;border-radius:8px;background:#edf4ff;color:#3a5c8d;font-size:.72rem}.receipt-modal footer{display:flex;justify-content:flex-end;margin-top:18px}
@media(max-width:1150px){.receipt-filters{grid-template-columns:repeat(3,minmax(0,1fr))}.search-field{grid-column:span 2}.filter-actions{justify-content:flex-end}}@media(max-width:760px){.summary-grid{grid-template-columns:repeat(2,1fr)}.receipt-filters{grid-template-columns:1fr 1fr}.search-field{grid-column:1/-1}.filter-actions{grid-column:1/-1}.filter-actions button{flex:1}.pagination{align-items:stretch;flex-direction:column}.pagination>div{justify-content:space-between}.receipt-modal dl{grid-template-columns:1fr}}@media(max-width:480px){.receipt-filters{grid-template-columns:1fr}.receipt-filters>*{grid-column:auto}.summary-grid{grid-template-columns:1fr 1fr}.page-head h1{font-size:1.65rem}}
</style>
