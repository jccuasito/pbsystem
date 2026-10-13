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
const receiptCloseButton = ref<HTMLButtonElement | null>(null)
let receiptTrigger: HTMLElement | null = null
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

async function load(quiet = false) {
  if (!quiet) loading.value = true
  error.value = ''
  try {
    const query: Record<string, string | number> = { page: page.value, pageSize: pagination.pageSize }
    for (const [key, value] of Object.entries(filters)) if (value) query[key] = value
    const response = await $fetch<any>('/api/deductions-loans/transactions', { query })
    if (quiet && selected.value) return
    items.value = response.items || []
    agencies.value = response.agencies || []
    Object.assign(summary, response.summary || {})
    Object.assign(pagination, response.pagination || {})
  } catch (cause: any) {
    error.value = cause?.data?.statusMessage || cause?.message || 'Unable to load transaction receipts.'
  } finally {
    if (!quiet) loading.value = false
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
async function openReceipt(item: Transaction, event: MouseEvent) {
  receiptTrigger = event.currentTarget as HTMLElement
  selected.value = item
  await nextTick()
  receiptCloseButton.value?.focus({ preventScroll: true })
}
async function closeReceipt() {
  selected.value = null
  await nextTick()
  receiptTrigger?.focus({ preventScroll: true })
  receiptTrigger = null
}
function onReceiptKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && selected.value) closeReceipt()
}

onMounted(() => { load(); window.addEventListener('keydown', onReceiptKeydown) })
onBeforeUnmount(() => window.removeEventListener('keydown', onReceiptKeydown))
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !selected.value })
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
            <td><button class="view-button" type="button" @click="openReceipt(item, $event)">View receipt</button></td>
          </tr>
          <tr v-if="loading"><td colspan="8" class="empty">Loading transaction receipts…</td></tr>
          <tr v-else-if="!items.length"><td colspan="8" class="empty">No transaction receipts match the selected filters.</td></tr>
        </tbody>
      </table>
    </div>

    <footer class="pagination"><span>Showing {{ items.length }} of {{ pagination.total }} transactions</span><div><button :disabled="page<=1" @click="goPage(page-1)">Previous</button><strong>Page {{ pagination.page }} of {{ pagination.pages }}</strong><button :disabled="page>=pagination.pages" @click="goPage(page+1)">Next</button></div></footer>

    <Teleport to="body">
    <div v-if="selected" class="receipt-layer" @click.self="closeReceipt">
      <section class="receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
        <div class="receipt-topline">
          <div class="receipt-brand"><span class="receipt-brand-mark">DJA</span><span><strong>DJA Group of Companies</strong><small>Payroll Management System</small></span></div>
          <button ref="receiptCloseButton" class="close" type="button" aria-label="Close receipt" @click="closeReceipt">&times;</button>
        </div>
        <div class="receipt-scroll">
        <header class="receipt-heading"><span class="eyebrow">PAYROLL TRANSACTION</span><h2 id="receipt-title">Transaction receipt</h2><span class="receipt-status" :class="selected.Status.toLowerCase()">{{ selected.Status }}</span></header>
        <div class="receipt-identity"><div><span class="receipt-label">Receipt no.</span><strong class="receipt-code">{{ selected.TransactionID }}</strong></div><div><span class="receipt-label">Transaction date</span><strong>{{ date(selected.TransactionDate) }}</strong></div></div>
        <div class="receipt-amount"><span>{{ selected.EntryType === 'Loan' ? 'Loan repayment deducted' : 'Deduction posted' }}</span><strong>{{ money(selected.Amount) }}</strong><small>{{ selected.ItemName }} &middot; {{ selected.ClassificationName || 'Unclassified' }}</small></div>
        <div class="receipt-section"><h3>Employee details</h3><dl><div><dt>Employee</dt><dd>{{ selected.EmployeeName }}</dd><small>{{ employeeNumber(selected) }} &middot; {{ selected.PositionName || 'No position' }}</small></div><div><dt>Agency</dt><dd>{{ selected.AgencyName || 'Unassigned' }}</dd></div></dl></div>
        <div class="receipt-section"><h3>Payment details</h3><dl class="receipt-lines"><div><dt>Payroll record</dt><dd>{{ selected.PayrollID ? `#${selected.PayrollID}` : 'Not recorded' }} &middot; {{ selected.PayrollStatus }}</dd></div><div><dt>Payroll cutoff</dt><dd>{{ selected.CutoffStartDate ? `${date(selected.CutoffStartDate)} - ${date(selected.CutoffEndDate)}` : 'Not recorded' }}</dd></div><div><dt>Account reference</dt><dd>{{ selected.AccountReference }}</dd></div><div><dt>Issuance code</dt><dd>{{ selected.IssuanceCode || 'Legacy record' }}</dd></div></dl></div>
        <div class="receipt-section receipt-balance"><h3>Account balance</h3><div class="balance-row"><span>Balance before</span><strong>{{ money(selected.BalanceBefore) }}</strong></div><div class="balance-row"><span>Amount deducted</span><strong>- {{ money(selected.Amount) }}</strong></div><div class="balance-row balance-final"><span>Balance after</span><strong>{{ money(selected.BalanceAfter) }}</strong></div></div>
        <div v-if="selected.Remarks" class="receipt-remarks"><span>Remarks</span><p>{{ selected.Remarks }}</p></div>
        <p class="receipt-note">{{ selected.Status === 'Voided' ? 'This transaction was voided. Amounts shown are retained for audit history.' : 'Generated automatically from an approved or released payroll. This receipt is read-only.' }}</p>
        </div>
        <footer><span>End of receipt</span><button type="button" @click="closeReceipt">Close</button></footer>
      </section>
    </div>
    </Teleport>
  </section>
</template>

<style scoped>
.transactions-page{--ink:#112d57;--muted:#687a96;max-width:1440px;margin:0 auto;color:var(--ink)}.page-head{display:flex;justify-content:space-between;gap:24px;margin-bottom:22px}.eyebrow{display:block;margin-bottom:6px;color:#2867d8;font-size:.72rem;font-weight:850;letter-spacing:.1em}.page-head h1,.receipt-modal h2{margin:0;color:#102c56}.page-head h1{font-size:2rem}.page-head p,.receipt-modal header p{margin:7px 0 0;color:var(--muted)}
.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}.summary-grid article{padding:16px 18px;border:1px solid #d9e4f2;border-radius:12px;background:#fff}.summary-grid span{display:block;color:#6a7b95;font-size:.68rem;font-weight:800;text-transform:uppercase}.summary-grid strong{display:block;margin-top:7px;font-size:1.25rem}
.receipt-filters{display:grid;grid-template-columns:minmax(260px,1.5fr) repeat(3,minmax(130px,.75fr)) repeat(2,minmax(145px,.8fr)) auto;align-items:end;gap:10px;margin-bottom:18px;padding:15px;border:1px solid #dce5f1;border-radius:13px;background:#fff}.receipt-filters label{display:grid;gap:6px;color:#405675;font-size:.72rem;font-weight:800}.receipt-filters input,.receipt-filters select{box-sizing:border-box;width:100%;min-height:44px;border:1px solid #cbd8e8;border-radius:8px;background:#fff;padding:0 12px;color:#17355e;font:inherit}.receipt-filters :deep(.modern-date-field){gap:6px;font-size:.72rem}.receipt-filters :deep(.modern-date-field__trigger){min-height:44px;border-radius:8px;padding-inline:12px}.filter-actions{display:flex;gap:7px}.filter-actions button,.view-button,.pagination button,.receipt-modal footer button{min-height:42px;border:1px solid #cbd8e8;border-radius:8px;background:#fff;padding:8px 13px;color:#25466f;font:inherit;font-weight:800;cursor:pointer}.filter-actions .primary{border-color:#2867d8;background:#2867d8;color:#fff}.filter-actions button:hover,.view-button:hover,.pagination button:hover:not(:disabled),.receipt-modal footer button:hover{border-color:#9db7de;background:#f1f6ff}.filter-actions .primary:hover,.filter-actions .primary:focus-visible{border-color:#1d55c4;background:#1d55c4;color:#fff}
.receipt-table-wrap{overflow:auto;border:1px solid #dae4f1;border-radius:13px;background:#fff}.receipt-table-wrap table{width:100%;min-width:1180px;border-collapse:separate;border-spacing:0;font-size:.79rem}.receipt-table-wrap th,.receipt-table-wrap td{padding:13px 14px;border-bottom:1px solid #e5ebf4;text-align:left;vertical-align:middle}.receipt-table-wrap th{background:#f5f8fc;color:#586b86;font-size:.67rem;text-transform:uppercase}.receipt-table-wrap tr:last-child td{border-bottom:0}.receipt-table-wrap td>strong,.receipt-table-wrap td>small{display:block}.receipt-table-wrap td>small{margin-top:4px;color:#71819a;font-size:.68rem}.transaction-code{color:#1955be;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.02em}.kind{display:inline-flex;margin:0 7px 5px 0;padding:4px 8px;border-radius:999px;font-size:.65rem;font-weight:850}.kind.loan{background:#e7efff;color:#2053b4}.kind.deduction{background:#f3e5ff;color:#7d28ba}.receipt-status{display:inline-flex;padding:5px 9px;border-radius:999px;font-size:.67rem;font-weight:850}.receipt-status.posted{background:#dcf8e7;color:#087a39}.receipt-status.voided{background:#edf0f4;color:#58677b}.empty{padding:42px!important;color:#71819a;text-align:center!important}.error{color:#b42318}.pagination{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:14px;color:#687993;font-size:.75rem}.pagination>div{display:flex;align-items:center;gap:10px}.pagination button:disabled{opacity:.45;cursor:not-allowed}
.receipt-layer{position:fixed;z-index:1000;inset:0;display:grid;place-items:center;padding:22px;background:rgba(15,27,52,.48);overscroll-behavior:contain}.receipt-modal{position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:min(680px,100%);max-height:min(92dvh,1000px);min-height:0;overflow:hidden;border-radius:14px;background:#fff;color:#112d57;box-shadow:0 28px 85px rgba(10,29,62,.3);font-family:'DM Sans',Arial,sans-serif;font-size:.82rem}.receipt-scroll{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:0 34px 12px;scrollbar-width:thin;scrollbar-color:#b8c9df transparent}.receipt-scroll::-webkit-scrollbar{width:7px}.receipt-scroll::-webkit-scrollbar-track{background:transparent}.receipt-scroll::-webkit-scrollbar-thumb{border:2px solid #fff;border-radius:999px;background:#b8c9df}.receipt-scroll::-webkit-scrollbar-thumb:hover{background:#819dbc}.receipt-modal:before{content:"";position:absolute;top:0;left:0;right:0;height:5px;background:#255ed4}.receipt-topline{display:flex;flex:none;align-items:center;justify-content:space-between;gap:16px;margin:0 34px;padding:23px 0 20px;border-bottom:1px solid #d9e3f0}.receipt-brand{display:flex;align-items:center;gap:11px}.receipt-brand-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:9px;background:#183763;color:#fff;font-size:.72rem;font-weight:900;letter-spacing:.04em}.receipt-brand>span:last-child{display:grid;gap:2px}.receipt-brand strong{font-size:.8rem}.receipt-brand small{color:#71819a;font-size:.67rem}.receipt-modal .close{display:grid;place-items:center;width:34px;height:34px;border:1px solid #d9e3f0;border-radius:8px;background:#fff;color:#48617e;font-size:1.3rem;cursor:pointer}.receipt-heading{position:relative;padding:22px 0 16px}.receipt-heading .eyebrow{font-size:.65rem}.receipt-heading h2{font-size:1.45rem}.receipt-heading .receipt-status{position:absolute;right:0;top:29px}.receipt-identity{display:flex;justify-content:space-between;gap:18px;padding:0 0 19px}.receipt-identity>div{display:grid;gap:5px}.receipt-identity>div:last-child{text-align:right}.receipt-label,.receipt-modal dt{color:#70819a;font-size:.63rem;font-weight:800;letter-spacing:.045em;text-transform:uppercase}.receipt-identity strong{font-size:.8rem}.receipt-code{color:#1a55ba;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.receipt-amount{display:grid;justify-items:center;gap:6px;padding:23px 14px;background:#f2f6fd;border-top:1px dashed #abc0e0;border-bottom:1px dashed #abc0e0;text-align:center}.receipt-amount span{color:#59708e;font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.055em}.receipt-amount strong{color:#12366c;font-size:2rem;line-height:1.2}.receipt-amount small{color:#5c718d;font-size:.75rem}.receipt-section{padding:17px 0 0}.receipt-section h3{margin:0 0 10px;color:#254466;font-size:.72rem;font-weight:850;letter-spacing:.055em;text-transform:uppercase}.receipt-modal dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:0}.receipt-modal dl>div{min-width:0}.receipt-modal dd{margin:5px 0 0;color:#17365f;font-weight:800;overflow-wrap:anywhere}.receipt-modal dl small{display:block;margin-top:4px;color:#6e7e96}.receipt-lines{padding:12px 0 15px;border-top:1px solid #e4eaf2;border-bottom:1px solid #e4eaf2}.receipt-balance{padding-bottom:5px}.balance-row{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:8px 0;color:#5b6e88}.balance-row strong{color:#17365f;white-space:nowrap}.balance-final{margin-top:5px;padding:12px 0;border-top:1px dashed #a8bcd6;color:#17365f;font-weight:850}.balance-final strong{font-size:1.2rem}.receipt-remarks{margin-top:13px;padding:10px 12px;border-left:3px solid #aac4e8;background:#f7f9fc}.receipt-remarks>span{color:#71819a;font-size:.65rem;font-weight:800;text-transform:uppercase}.receipt-remarks p{margin:5px 0 0;color:#405675}.receipt-note{margin:16px 0 0;color:#687b95;font-size:.69rem;line-height:1.5}.receipt-modal footer{display:flex;flex:none;align-items:center;justify-content:space-between;gap:12px;margin:0 34px;padding:14px 0 18px;border-top:1px dashed #bdcbe0}.receipt-modal footer>span{color:#90a0b3;font-size:.65rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
@media(max-width:1150px){.receipt-filters{grid-template-columns:repeat(3,minmax(0,1fr))}.search-field{grid-column:span 2}.filter-actions{justify-content:flex-end}}@media(max-width:760px){.summary-grid{grid-template-columns:repeat(2,1fr)}.receipt-filters{grid-template-columns:1fr 1fr}.search-field{grid-column:1/-1}.filter-actions{grid-column:1/-1}.filter-actions button{flex:1}.pagination{align-items:stretch;flex-direction:column}.pagination>div{justify-content:space-between}.receipt-scroll{padding-inline:20px}.receipt-topline,.receipt-modal footer{margin-inline:20px}.receipt-modal dl{grid-template-columns:1fr}}@media(max-width:480px){.receipt-filters{grid-template-columns:1fr}.receipt-filters>*{grid-column:auto}.summary-grid{grid-template-columns:1fr 1fr}.page-head h1{font-size:1.65rem}.receipt-heading .receipt-status{position:static;margin-top:10px}.receipt-identity{flex-direction:column;gap:12px}.receipt-identity>div:last-child{text-align:left}.receipt-layer{padding:10px}.receipt-modal{max-height:calc(100dvh - 20px)}}
</style>
