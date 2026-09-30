<script setup lang="ts">
import ModernDateField from '~~/components/ModernDateField.vue'

type RepaymentCutoff = 'First' | 'Second' | 'Both'
type EmployeeRow = {
  EmployeeID: number
  EmployeeNumber: string | null
  EmployeeName: string
  AgencyID: number | null
  AgencyName: string | null
  PositionName: string | null
  ActiveLoanCount: number
  ActiveDeductionCount: number
  TotalIssued: number
  OutstandingLoanBalance: number
  OutstandingDeductionBalance: number
  OutstandingBalance: number
}
type CatalogItem = { EntryType: 'Loan' | 'Deduction'; CatalogItemID: number; ItemName: string; ClassificationID: number; ClassificationName: string }
type SchedulePeriod = {
  Period: number
  CutoffStartDate: string
  CutoffEndDate: string
  ScheduledAmount: number
  RecordedPaidAmount: number
  ProjectedBalance: number
  RemainingPeriods: number
  Status: string
}
type RecordItem = {
  EntryType: 'Loan' | 'Deduction'
  RecordID: number
  IssuanceCode: string | null
  IssuanceDate: string | null
  OriginalAmount: number
  OutstandingAmount: number
  Status: string
  Remarks: string | null
  ItemName: string
  ClassificationName: string | null
  RepaymentStartDate: string | null
  RepaymentEndDate: string | null
  RepaymentMonths: number
  RepaymentPeriods: number
  RepaymentCutoff: RepaymentCutoff
  InstallmentAmount: number
  FinalInstallmentAmount: number
  IsPaused: number
  PauseStartDate: string | null
  ResumeDate: string | null
  PauseReason: string | null
  FifoPosition: number | null
  FifoPositionFirst: number | null
  FifoPositionSecond: number | null
  PlanStatus: string
  RepaymentSchedule: SchedulePeriod[]
}

const loading = ref(false)
const saving = ref(false)
const profileLoading = ref(false)
const error = ref('')
const profileError = ref('')
const search = ref('')
const agencyId = ref('')
const items = ref<EmployeeRow[]>([])
const agencies = ref<Array<{ AgencyID: number; AgencyName: string }>>([])
const catalogItems = ref<CatalogItem[]>([])
const page = ref(1)
const pagination = reactive({ page: 1, pageSize: 25, total: 0, pages: 1 })
const selectedEmployee = ref<EmployeeRow | null>(null)
const profileEmployee = ref<any>(null)
const profileRecords = ref<RecordItem[]>([])
const profileOpen = ref(false)
const issuanceOpen = ref(false)
const pauseOpen = ref(false)
const pauseRecord = ref<RecordItem | null>(null)
const planOpen = ref(false)
const planRecord = ref<RecordItem | null>(null)
const historyScope = ref<'Active' | 'Archive'>('Active')
const historyType = ref<'All' | 'Loan' | 'Deduction'>('All')
const today = () => new Date().toISOString().slice(0, 10)
const form = reactive({ EntryType: 'Loan' as 'Loan' | 'Deduction', CatalogItemID: '', IssuanceCode: '', IssuanceDate: today(), OriginalAmount: '', RepaymentStartDate: today(), RepaymentPeriods: '1', RepaymentCutoff: 'Second' as RepaymentCutoff, Remarks: '' })
const pauseForm = reactive({ PauseStartDate: today(), ResumeDate: '', PauseReason: '' })

const scopedHistory = computed(() => profileRecords.value.filter(item => historyScope.value === 'Active' ? item.Status === 'Active' : item.Status !== 'Active'))
const filteredHistory = computed(() => historyType.value === 'All' ? scopedHistory.value : scopedHistory.value.filter(item => item.EntryType === historyType.value))
function historyCount(kind: 'All' | 'Loan' | 'Deduction') {
  return kind === 'All' ? scopedHistory.value.length : scopedHistory.value.filter(item => item.EntryType === kind).length
}
function historyScopeCount(scope: 'Active' | 'Archive') {
  return profileRecords.value.filter(item => scope === 'Active' ? item.Status === 'Active' : item.Status !== 'Active').length
}
const availableCatalog = computed(() => catalogItems.value.filter(item => item.EntryType === form.EntryType))
const catalogGroups = computed(() => {
  const groups = new Map<string, CatalogItem[]>()
  for (const item of availableCatalog.value) {
    const key = item.ClassificationName || 'Other'
    groups.set(key, [...(groups.get(key) || []), item])
  }
  return [...groups.entries()].map(([name, entries]) => ({ name, entries }))
})
const profileTotals = computed(() => profileRecords.value.reduce((totals, item) => {
  if (item.Status !== 'Cancelled' && item.Status !== 'Inactive') {
    totals.issued += Number(item.OriginalAmount || 0)
  }
  if (item.Status === 'Active') {
    totals.balance += Number(item.OutstandingAmount || 0)
    totals.active += 1
  }
  return totals
}, { issued: 0, balance: 0, active: 0 }))

function scheduleWindow(startDate: string, cutoff: RepaymentCutoff, periodIndex: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  let selectedCutoff: 'First' | 'Second'
  let monthOffset: number
  if (cutoff === 'Both') {
    const sequenceIndex = periodIndex + (day <= 15 ? 0 : 1)
    selectedCutoff = sequenceIndex % 2 === 0 ? 'First' : 'Second'
    monthOffset = Math.floor(sequenceIndex / 2)
  } else {
    selectedCutoff = cutoff
    monthOffset = periodIndex + (cutoff === 'First' && day > 15 ? 1 : 0)
  }
  const targetMonth = new Date(Date.UTC(year, month + monthOffset, 1))
  const targetYear = targetMonth.getUTCFullYear()
  const targetMonthIndex = targetMonth.getUTCMonth()
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate()
  const iso = (value: number) => `${targetYear}-${String(targetMonthIndex + 1).padStart(2, '0')}-${String(value).padStart(2, '0')}`
  return {
    start: iso(selectedCutoff === 'First' ? 1 : 16),
    end: iso(selectedCutoff === 'First' ? 15 : lastDay),
  }
}

const planPreview = computed(() => {
  const amountInCents = Math.round(Number(form.OriginalAmount || 0) * 100)
  const periods = Number(form.RepaymentPeriods || 0)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form.RepaymentStartDate)
  if (!amountInCents || !Number.isInteger(periods) || periods < 1 || !match) return null
  const finalWindow = scheduleWindow(form.RepaymentStartDate, form.RepaymentCutoff, periods - 1)
  if (!finalWindow) return null
  const endDate = finalWindow.end
  const installmentCents = Math.round(amountInCents / periods)
  const finalInstallmentCents = amountInCents - installmentCents * (periods - 1)
  let projectedBalanceCents = amountInCents
  const schedule: SchedulePeriod[] = Array.from({ length: periods }, (_, index) => {
    const window = scheduleWindow(form.RepaymentStartDate, form.RepaymentCutoff, index)!
    const scheduledCents = index === periods - 1 ? finalInstallmentCents : installmentCents
    projectedBalanceCents = Math.max(0, projectedBalanceCents - scheduledCents)
    return {
      Period: index + 1,
      CutoffStartDate: window.start,
      CutoffEndDate: window.end,
      ScheduledAmount: scheduledCents / 100,
      RecordedPaidAmount: 0,
      ProjectedBalance: projectedBalanceCents / 100,
      RemainingPeriods: periods - index - 1,
      Status: 'For review',
    }
  })
  return { periods, endDate, installment: installmentCents / 100, finalInstallment: finalInstallmentCents / 100, schedule }
})
const repaymentPlanView = computed(() => {
  if (planRecord.value) return planRecord.value
  if (!planPreview.value) return null
  const catalog = catalogItems.value.find(item => item.EntryType === form.EntryType && String(item.CatalogItemID) === form.CatalogItemID)
  return {
    ItemName: catalog?.ItemName || 'Repayment plan preview',
    IssuanceCode: form.IssuanceCode || 'Review before saving',
    EntryType: form.EntryType,
    RepaymentCutoff: form.RepaymentCutoff,
    OriginalAmount: Number(form.OriginalAmount || 0),
    RepaymentPeriods: planPreview.value.periods,
    InstallmentAmount: planPreview.value.installment,
    OutstandingAmount: Number(form.OriginalAmount || 0),
    RepaymentSchedule: planPreview.value.schedule,
  }
})

function money(value: unknown) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0))
}
function date(value: string | null) {
  if (!value) return 'No date'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}
function employeeNumber(employee: { EmployeeID: number; EmployeeNumber?: string | null }) {
  return employee.EmployeeNumber || `EMP-${String(employee.EmployeeID).padStart(4, '0')}`
}
function cutoffLabel(cutoff: RepaymentCutoff) {
  if (cutoff === 'Both') return 'Both cutoffs'
  return cutoff === 'First' ? '1st cutoff' : '2nd cutoff'
}
function cutoffDescription(cutoff: RepaymentCutoff) {
  if (cutoff === 'Both') return 'every payroll cutoff (1st and 2nd)'
  return cutoff === 'First' ? 'the 1st cutoff (days 1–15)' : 'the 2nd cutoff (day 16–month end)'
}
function fifoLabel(record: RecordItem) {
  if (record.RepaymentCutoff === 'Both') {
    return `FIFO 1st #${record.FifoPositionFirst || '—'} · 2nd #${record.FifoPositionSecond || '—'}`
  }
  return `FIFO #${record.FifoPosition || '—'}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<any>('/api/deductions-loans/employee-records', {
      query: { search: search.value || undefined, agencyId: agencyId.value || undefined, page: page.value, pageSize: pagination.pageSize },
    })
    items.value = response.items || []
    agencies.value = response.agencies || []
    catalogItems.value = response.catalogItems || []
    Object.assign(pagination, response.pagination || {})
  } catch (cause: any) {
    error.value = cause?.data?.statusMessage || cause?.message || 'Unable to load employee loan and deduction records.'
  } finally {
    loading.value = false
  }
}

async function loadProfile(employee: EmployeeRow | { EmployeeID: number }) {
  profileLoading.value = true
  profileError.value = ''
  try {
    const response = await $fetch<any>('/api/deductions-loans/employee-records', { query: { employeeId: employee.EmployeeID } })
    profileEmployee.value = response.employee
    profileRecords.value = response.records || []
    catalogItems.value = response.catalogItems || catalogItems.value
  } catch (cause: any) {
    profileError.value = cause?.data?.statusMessage || cause?.message || 'Unable to load this employee history.'
  } finally {
    profileLoading.value = false
  }
}

async function openProfile(employee: EmployeeRow) {
  selectedEmployee.value = employee
  profileEmployee.value = employee
  profileRecords.value = []
  historyScope.value = 'Active'
  historyType.value = 'All'
  profileOpen.value = true
  await loadProfile(employee)
}

function openIssuance(employee: EmployeeRow | any, type: 'Loan' | 'Deduction' = 'Loan') {
  selectedEmployee.value = employee
  Object.assign(form, { EntryType: type, CatalogItemID: '', IssuanceCode: '', IssuanceDate: today(), OriginalAmount: '', RepaymentStartDate: today(), RepaymentPeriods: '1', RepaymentCutoff: type === 'Deduction' ? 'First' : 'Second', Remarks: '' })
  profileError.value = ''
  issuanceOpen.value = true
}

async function saveIssuance() {
  if (!selectedEmployee.value) return
  saving.value = true
  profileError.value = ''
  try {
    await $fetch('/api/deductions-loans/employee-records', {
      method: 'POST',
      body: {
        EmployeeID: selectedEmployee.value.EmployeeID,
        EntryType: form.EntryType,
        CatalogItemID: Number(form.CatalogItemID),
        IssuanceCode: form.IssuanceCode,
        IssuanceDate: form.IssuanceDate,
        OriginalAmount: Number(form.OriginalAmount),
        RepaymentStartDate: form.RepaymentStartDate,
        RepaymentPeriods: Number(form.RepaymentPeriods),
        RepaymentCutoff: form.RepaymentCutoff,
        Remarks: form.Remarks,
      },
    })
    issuanceOpen.value = false
    await Promise.all([load(), profileOpen.value ? loadProfile(selectedEmployee.value) : Promise.resolve()])
  } catch (cause: any) {
    profileError.value = cause?.data?.statusMessage || cause?.message || 'Unable to save this issuance.'
  } finally {
    saving.value = false
  }
}

async function changeStatus(item: RecordItem, status: string, askForConfirmation = true) {
  if (askForConfirmation && !confirm(`Mark ${item.IssuanceCode || item.ItemName} as ${status}?`)) return
  profileError.value = ''
  try {
    await $fetch('/api/deductions-loans/employee-records', { method: 'PUT', body: { EntryType: item.EntryType, RecordID: item.RecordID, Status: status } })
    if (selectedEmployee.value) await Promise.all([loadProfile(selectedEmployee.value), load()])
  } catch (cause: any) {
    profileError.value = cause?.data?.statusMessage || cause?.message || 'Unable to update this record.'
  }
}

function openPause(item: RecordItem) {
  pauseRecord.value = item
  Object.assign(pauseForm, { PauseStartDate: today(), ResumeDate: '', PauseReason: '' })
  profileError.value = ''
  pauseOpen.value = true
}

function openRepaymentPlan(item: RecordItem) {
  planRecord.value = item
  planOpen.value = true
}

function openRepaymentPreview() {
  if (!planPreview.value) return
  planRecord.value = null
  planOpen.value = true
}

function statusLabel(item: RecordItem) {
  if (item.Status === 'Cancelled' || item.Status === 'Inactive') return 'Voided'
  return Number(item.IsPaused) ? 'Paused' : item.Status
}

async function voidIssuance(item: RecordItem) {
  const label = item.IssuanceCode || item.ItemName
  if (!confirm(`Void ${label}? It will be removed from the employee's active balance but kept in history for audit.`)) return
  await changeStatus(item, item.EntryType === 'Loan' ? 'Cancelled' : 'Inactive', false)
}

async function savePause() {
  if (!pauseRecord.value) return
  saving.value = true
  profileError.value = ''
  try {
    await $fetch('/api/deductions-loans/employee-records', {
      method: 'PUT',
      body: { EntryType: pauseRecord.value.EntryType, RecordID: pauseRecord.value.RecordID, PlanAction: 'pause', ...pauseForm },
    })
    pauseOpen.value = false
    if (selectedEmployee.value) await loadProfile(selectedEmployee.value)
  } catch (cause: any) {
    profileError.value = cause?.data?.statusMessage || cause?.message || 'Unable to pause this repayment plan.'
  } finally {
    saving.value = false
  }
}

async function resumePlan(item: RecordItem) {
  if (!confirm(`Resume ${item.IssuanceCode || item.ItemName} now?`)) return
  profileError.value = ''
  try {
    await $fetch('/api/deductions-loans/employee-records', { method: 'PUT', body: { EntryType: item.EntryType, RecordID: item.RecordID, PlanAction: 'resume' } })
    if (selectedEmployee.value) await loadProfile(selectedEmployee.value)
  } catch (cause: any) {
    profileError.value = cause?.data?.statusMessage || cause?.message || 'Unable to resume this repayment plan.'
  }
}

function applyFilters() {
  page.value = 1
  load()
}
function goPage(next: number) {
  page.value = Math.min(Math.max(1, next), pagination.pages)
  load()
}
watch(() => form.EntryType, type => {
  form.CatalogItemID = ''
  form.RepaymentCutoff = type === 'Deduction' ? 'First' : 'Second'
})
watch(() => form.IssuanceDate, value => {
  if (form.RepaymentStartDate < value) form.RepaymentStartDate = value
})
onMounted(load)
</script>

<template>
  <section class="employee-accounts-page">
    <header class="page-head">
      <div>
        <span class="eyebrow">DEDUCTIONS &amp; LOANS</span>
        <h1>Employee Loans &amp; Deductions</h1>
        <p>Record each manual issuance and review the employee's complete loan and deduction history.</p>
      </div>
    </header>

    <form class="filters" @submit.prevent="applyFilters">
      <label class="search-field">Search employee
        <input v-model="search" placeholder="Employee ID, number, or name">
      </label>
      <label>Agency
        <select v-model="agencyId">
          <option value="">All agencies</option>
          <option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option>
        </select>
      </label>
      <button class="primary" type="submit" :disabled="loading">{{ loading ? 'Loading…' : 'Search' }}</button>
    </form>
    <p class="workflow-note"><strong>Repayment-ready records:</strong> every issuance includes its start date, term, cutoff, installment, FIFO priority, and optional pause schedule for payroll processing.</p>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="table-wrap desktop-list">
      <table>
        <thead><tr><th>Employee</th><th>Agency / Position</th><th>Active accounts</th><th>Lifetime issued</th><th>Outstanding balance</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-if="loading"><td colspan="6" class="empty">Loading employees…</td></tr>
          <tr v-else-if="!items.length"><td colspan="6" class="empty">No employees match the selected filters.</td></tr>
          <tr v-for="employee in items" v-else :key="employee.EmployeeID">
            <td><strong>{{ employee.EmployeeName }}</strong><small>{{ employeeNumber(employee) }}</small></td>
            <td>{{ employee.AgencyName || 'Unassigned' }}<small>{{ employee.PositionName || 'No position' }}</small></td>
            <td><div class="account-badges"><span class="loan">{{ Number(employee.ActiveLoanCount) }} loans</span><span class="deduction">{{ Number(employee.ActiveDeductionCount) }} deductions</span></div></td>
            <td>{{ money(employee.TotalIssued) }}</td>
            <td>{{ money(employee.OutstandingBalance) }}</td>
            <td><div class="actions"><button type="button" @click="openProfile(employee)">View profile</button><button class="add" type="button" @click="openIssuance(employee)">+ Add issuance</button></div></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="mobile-list">
      <article v-for="employee in items" :key="employee.EmployeeID">
        <header><div><strong>{{ employee.EmployeeName }}</strong><small>{{ employeeNumber(employee) }} · {{ employee.AgencyName || 'Unassigned' }}</small></div><span>{{ money(employee.OutstandingBalance) }}</span></header>
        <div class="account-badges"><span class="loan">{{ Number(employee.ActiveLoanCount) }} loans</span><span class="deduction">{{ Number(employee.ActiveDeductionCount) }} deductions</span></div>
        <footer><button @click="openProfile(employee)">View profile</button><button class="add" @click="openIssuance(employee)">+ Add issuance</button></footer>
      </article>
    </div>

    <footer v-if="pagination.total" class="pagination">
      <span>Showing {{ (pagination.page - 1) * pagination.pageSize + 1 }}–{{ Math.min(pagination.page * pagination.pageSize, pagination.total) }} of {{ pagination.total }}</span>
      <div><button :disabled="pagination.page <= 1" @click="goPage(pagination.page - 1)">Previous</button><strong>Page {{ pagination.page }} of {{ pagination.pages }}</strong><button :disabled="pagination.page >= pagination.pages" @click="goPage(pagination.page + 1)">Next</button></div>
    </footer>

    <div v-if="profileOpen" class="modal-backdrop" @click.self="profileOpen=false">
      <section class="profile-modal">
        <button class="close" aria-label="Close" @click="profileOpen=false">×</button>
        <header class="profile-head">
          <div><span class="eyebrow">EMPLOYEE ACCOUNT</span><h2>{{ profileEmployee?.EmployeeName }}</h2><p>{{ employeeNumber(profileEmployee || selectedEmployee || {}) }} · {{ profileEmployee?.AgencyName || 'Unassigned' }} · {{ profileEmployee?.PositionName || 'No position' }}</p></div>
          <button class="primary" @click="openIssuance(profileEmployee || selectedEmployee)">+ Add issuance</button>
        </header>
        <div class="summary-cards"><div><span>Lifetime issued</span><strong>{{ money(profileTotals.issued) }}</strong></div><div><span>Outstanding balance</span><strong>{{ money(profileTotals.balance) }}</strong></div><div><span>Active plans</span><strong>{{ profileTotals.active }}</strong></div></div>
        <div class="history-heading">
          <div><h3>Issuance history</h3><p>Active records are separated from completed or voided records.</p></div>
        </div>
        <div class="history-controls">
          <div class="filter-group">
            <span class="filter-label">Status</span>
            <div class="scope-tabs" role="tablist" aria-label="Choose issuance status">
              <button v-for="scope in (['Active','Archive'] as const)" :key="scope" type="button" role="tab" class="scope-filter" :class="[`scope-${scope.toLowerCase()}`,{active:historyScope===scope}]" :aria-selected="historyScope===scope" @click="historyScope=scope; historyType='All'"><span class="filter-icon">{{ scope === 'Active' ? '●' : '▣' }}</span><span>{{ scope }}</span><small>{{ historyScopeCount(scope) }}</small></button>
            </div>
          </div>
          <div class="filter-group filter-group-type">
            <span class="filter-label">Type</span>
            <div class="type-tabs" role="tablist" aria-label="Filter issuance type">
              <button v-for="kind in (['All','Loan','Deduction'] as const)" :key="kind" type="button" role="tab" class="history-filter" :class="[`filter-${kind.toLowerCase()}`,{active:historyType===kind}]" :aria-selected="historyType===kind" @click="historyType=kind"><span class="filter-icon">{{ kind === 'All' ? '▦' : kind === 'Loan' ? '₱' : '−' }}</span><span>{{ kind }}</span><small>{{ historyCount(kind) }}</small></button>
            </div>
          </div>
        </div>
        <p class="history-result">Showing {{ historyCount(historyType) }} {{ historyScope.toLowerCase() }} {{ historyType === 'All' ? 'records' : `${historyType.toLowerCase()} record${historyCount(historyType) === 1 ? '' : 's'}` }}</p>
        <p v-if="profileError" class="error">{{ profileError }}</p>
        <div class="record-list">
          <p v-if="profileLoading" class="empty">Loading history…</p>
          <p v-else-if="!filteredHistory.length" class="empty">{{ historyScope === 'Active' ? 'No active loans or deductions.' : 'No archived issuance records.' }}</p>
          <article v-for="record in filteredHistory" v-else :key="`${record.EntryType}-${record.RecordID}`" class="record-card">
            <header>
              <div class="record-heading"><span class="kind" :class="record.EntryType.toLowerCase()">{{ record.EntryType }}</span><div><strong>{{ record.ItemName }}</strong><small>{{ record.ClassificationName || 'Unclassified' }} · {{ record.IssuanceCode || 'Legacy record' }}</small></div></div>
              <span class="status" :class="{ 'status-active': record.Status === 'Active' && !Number(record.IsPaused), 'status-paused': Number(record.IsPaused), 'status-paid': record.Status === 'Paid', 'status-completed': record.Status === 'Completed', 'status-cancelled': record.Status === 'Cancelled', 'status-inactive': record.Status === 'Inactive' }">{{ statusLabel(record) }}</span>
            </header>
            <div class="record-details">
              <div><span>Issued</span><strong>{{ date(record.IssuanceDate) }}</strong><small>Original amount {{ money(record.OriginalAmount) }}</small></div>
              <div><span>Schedule</span><strong>{{ cutoffLabel(record.RepaymentCutoff) }} · {{ record.RepaymentPeriods }} period{{ Number(record.RepaymentPeriods) === 1 ? '' : 's' }}</strong><small>{{ date(record.RepaymentStartDate) }} – {{ date(record.RepaymentEndDate) }} · {{ fifoLabel(record) }}</small></div>
              <div><span>Installment</span><strong>{{ money(record.InstallmentAmount) }}</strong><small>Per selected cutoff<span v-if="Number(record.FinalInstallmentAmount) !== Number(record.InstallmentAmount)"> · final {{ money(record.FinalInstallmentAmount) }}</span></small></div>
              <div><span>Outstanding balance</span><strong>{{ record.Status === 'Active' ? money(record.OutstandingAmount) : money(0) }}</strong><small v-if="Number(record.IsPaused)">{{ record.ResumeDate ? `Resumes ${date(record.ResumeDate)}` : 'Manual resume required' }}</small><small v-else>{{ record.PlanStatus }}</small></div>
            </div>
            <footer>
              <button class="view-plan" @click="openRepaymentPlan(record)">View repayment plan</button>
              <div v-if="record.Status==='Active'" class="record-actions"><button v-if="Number(record.IsPaused)" @click="resumePlan(record)">Resume now</button><button v-else @click="openPause(record)">Pause plan</button><button v-if="record.EntryType==='Loan'" @click="changeStatus(record,'Paid')">Mark paid</button><button v-else @click="changeStatus(record,'Completed')">Complete</button><button class="danger-action" @click="voidIssuance(record)">Void issuance</button></div>
            </footer>
          </article>
        </div>
      </section>
    </div>

    <div v-if="issuanceOpen" class="modal-backdrop issuance-layer" @click.self="issuanceOpen=false">
      <form class="issuance-modal" @submit.prevent="saveIssuance">
        <button class="close" type="button" aria-label="Close" @click="issuanceOpen=false">×</button>
        <header><span class="eyebrow">MANUAL ISSUANCE</span><h2>Add loan or deduction</h2><p>For {{ selectedEmployee?.EmployeeName }} · {{ selectedEmployee ? employeeNumber(selectedEmployee) : '' }}</p></header>
        <div class="form-grid issuance-form-grid">
          <label class="form-field">Type<select v-model="form.EntryType" required><option value="Loan">Loan</option><option value="Deduction">Deduction</option></select></label>
          <label class="form-field">Catalog entry<select v-model="form.CatalogItemID" required><option disabled value="">Select {{ form.EntryType.toLowerCase() }}</option><optgroup v-for="group in catalogGroups" :key="group.name" :label="group.name"><option v-for="item in group.entries" :key="item.CatalogItemID" :value="String(item.CatalogItemID)">{{ item.ItemName }}</option></optgroup></select></label>
          <ModernDateField v-model="form.IssuanceDate" label="Issuance date" placeholder="Select issuance date" align="start" required />
          <label class="form-field">Issuance code<input v-model="form.IssuanceCode" maxlength="100" placeholder="e.g. SSS-SL-2026-001" required></label>
          <label class="wide form-field">Original value / amount received<input v-model="form.OriginalAmount" type="number" min="0.01" max="99999999.99" step="0.01" placeholder="0.00" required></label>
          <div class="section-label wide"><strong>Repayment plan</strong><span>Deduction defaults to 1st cutoff; loan defaults to 2nd cutoff. You can change either.</span></div>
          <ModernDateField v-model="form.RepaymentStartDate" label="Repayment starts" placeholder="Select repayment start" :min="form.IssuanceDate || undefined" align="start" required />
          <label class="form-field">Number of periods<input v-model="form.RepaymentPeriods" type="number" min="1" max="120" step="1" required><small class="field-help">A period is one scheduled payroll cutoff.</small></label>
          <label class="wide form-field">Deduct every<select v-model="form.RepaymentCutoff" required><option value="First">1st cutoff (days 1–15)</option><option value="Second">2nd cutoff (day 16–month end)</option><option value="Both">Both cutoffs (every payroll cutoff)</option></select><small class="field-help">Choose Both to deduct on consecutive 1st and 2nd payroll cutoffs.</small></label>
          <div v-if="planPreview" class="plan-preview wide"><div><span>Installment per cutoff</span><strong>{{ money(planPreview.installment) }}</strong></div><div><span>Planned completion</span><strong>{{ date(planPreview.endDate) }}</strong></div><div><span>Final installment</span><strong>{{ money(planPreview.finalInstallment) }}</strong></div></div>
          <button class="review-plan wide" type="button" :disabled="!planPreview" @click="openRepaymentPreview">Review repayment plan</button>
          <label class="wide">Remarks <em>Optional</em><textarea v-model="form.Remarks" maxlength="255" placeholder="Reference, purpose, or supporting note"></textarea></label>
        </div>
        <p class="form-note">FIFO applies only to repeated issuances of the same catalog entry and eligible cutoff. The oldest matching issuance is processed first; different loan or deduction entries keep separate queues. A Both-cutoffs plan joins both of its catalog entry's queues.</p>
        <p v-if="profileError" class="error">{{ profileError }}</p>
        <footer><button type="button" @click="issuanceOpen=false">Cancel</button><button class="primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save issuance' }}</button></footer>
      </form>
    </div>

    <div v-if="planOpen && repaymentPlanView" class="modal-backdrop plan-layer" @click.self="planOpen=false">
      <section class="plan-modal">
        <button class="close" type="button" aria-label="Close" @click="planOpen=false">×</button>
        <header><span class="eyebrow">{{ planRecord ? 'REPAYMENT PLAN' : 'REPAYMENT PLAN REVIEW' }}</span><h2>{{ repaymentPlanView.ItemName }}</h2><p>{{ repaymentPlanView.IssuanceCode || 'Legacy record' }} · {{ repaymentPlanView.EntryType }} · {{ cutoffLabel(repaymentPlanView.RepaymentCutoff) }}</p></header>
        <div class="plan-summary">
          <div><span>Original amount</span><strong>{{ money(repaymentPlanView.OriginalAmount) }}</strong></div>
          <div><span>Periods</span><strong>{{ repaymentPlanView.RepaymentPeriods }}</strong></div>
          <div><span>Per cutoff</span><strong>{{ money(repaymentPlanView.InstallmentAmount) }}</strong></div>
          <div><span>{{ planRecord ? 'Current balance' : 'Starting balance' }}</span><strong>{{ money(repaymentPlanView.OutstandingAmount) }}</strong></div>
        </div>
        <p class="schedule-note">This plan is deducted during {{ cutoffDescription(repaymentPlanView.RepaymentCutoff) }}.</p>
        <div class="schedule-wrap">
          <table>
            <thead><tr><th>Period</th><th>Cutoff start</th><th>Cutoff end</th><th>Scheduled installment</th><th>Recorded paid</th><th>Projected balance</th><th>Remaining periods</th><th>Status</th></tr></thead>
            <tbody>
              <tr v-for="period in repaymentPlanView.RepaymentSchedule" :key="period.Period">
                <td>{{ period.Period }}</td><td>{{ date(period.CutoffStartDate) }}</td><td>{{ date(period.CutoffEndDate) }}</td><td>{{ money(period.ScheduledAmount) }}</td><td>{{ money(period.RecordedPaidAmount) }}</td><td>{{ money(period.ProjectedBalance) }}</td><td>{{ period.RemainingPeriods }}</td><td><span class="period-status">{{ period.Status }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="schedule-help">{{ planRecord ? 'Recorded paid is based on the balance already posted to this issuance.' : 'This is a review only. The issuance has not been saved yet.' }} Projected balance shows the expected balance after each scheduled installment.</p>
        <footer><button type="button" @click="planOpen=false">Close</button></footer>
      </section>
    </div>

    <div v-if="pauseOpen" class="modal-backdrop pause-layer" @click.self="pauseOpen=false">
      <form class="pause-modal" @submit.prevent="savePause">
        <button class="close" type="button" aria-label="Close" @click="pauseOpen=false">×</button>
        <header><span class="eyebrow">REPAYMENT PLAN</span><h2>Pause this plan</h2><p>{{ pauseRecord?.ItemName }} · {{ pauseRecord?.IssuanceCode }}</p></header>
        <div class="form-grid">
          <label>Pause effective date<input v-model="pauseForm.PauseStartDate" type="date" required></label>
          <label>Resume date <em>Optional</em><input v-model="pauseForm.ResumeDate" type="date"></label>
          <label class="wide">Reason <em>Optional</em><textarea v-model="pauseForm.PauseReason" maxlength="255" placeholder="Example: Skip the current cutoff per approved request"></textarea></label>
        </div>
        <p class="form-note">Leave the resume date empty when payroll staff should resume this plan manually.</p>
        <p v-if="profileError" class="error">{{ profileError }}</p>
        <footer><button type="button" @click="pauseOpen=false">Cancel</button><button class="primary" :disabled="saving">{{ saving ? 'Saving…' : 'Pause plan' }}</button></footer>
      </form>
    </div>
  </section>
</template>

<style scoped>
.employee-accounts-page{--ink:#12284b;--muted:#657792;--line:#d7e1ee;box-sizing:border-box;width:100%;padding:34px 36px 46px;color:var(--ink);font-family:Inter,'Segoe UI',sans-serif}.page-head{display:flex;justify-content:space-between;gap:20px;margin-bottom:25px}.eyebrow{color:#2864d7;font-size:.72rem;font-weight:850;letter-spacing:.08em}.page-head h1,.profile-head h2,.issuance-modal h2,.pause-modal h2{margin:5px 0 5px;font-size:2rem}.page-head p,.profile-head p,.issuance-modal header p,.pause-modal header p{margin:0;color:var(--muted)}.filters{display:grid;grid-template-columns:minmax(320px,1fr) minmax(210px,280px) auto;align-items:end;gap:12px}.filters label,.form-grid label{display:grid;gap:7px;color:#40516c;font-size:.76rem;font-weight:800}.filters input,.filters select,.form-grid input,.form-grid select,.form-grid textarea{box-sizing:border-box;width:100%;min-height:48px;border:1px solid #cbd8ea;border-radius:9px;background:#fff;padding:0 13px;color:#172d50;font:inherit;font-size:.86rem}.form-grid textarea{min-height:82px;padding:11px;resize:vertical}.primary{min-height:48px;border:1px solid #2867e8;border-radius:9px;background:#2867e8;padding:0 18px;color:#fff;font:inherit;font-weight:800;cursor:pointer}.workflow-note{margin:16px 0;padding:12px 14px;border:1px solid #c8daf8;border-radius:9px;background:#f1f6ff;color:#36577f;font-size:.78rem}.error{padding:10px 12px;border:1px solid #fecaca;border-radius:8px;background:#fff7f7;color:#b42318}.table-wrap,.history-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px;background:#fff}.table-wrap table,.history-wrap table{width:100%;border-collapse:collapse}.history-wrap table{min-width:1120px}.table-wrap th,.table-wrap td,.history-wrap th,.history-wrap td{padding:13px 15px;border-bottom:1px solid #e4eaf2;text-align:left;vertical-align:middle}.table-wrap th,.history-wrap th{background:#f5f8fc;color:#405371;font-size:.69rem;text-transform:uppercase;white-space:nowrap}.table-wrap td,.history-wrap td{font-size:.79rem}.table-wrap td strong,.table-wrap td small,.history-wrap td strong,.history-wrap td small{display:block}.table-wrap td small,.history-wrap td small{margin-top:4px;color:var(--muted);font-size:.68rem}.account-badges{display:flex;gap:6px;flex-wrap:wrap}.account-badges span,.kind,.status{display:inline-flex;border-radius:999px;padding:4px 8px;font-size:.66rem;font-weight:850;white-space:nowrap}.loan{background:#e7efff;color:#2456b7}.deduction{background:#f3e8ff;color:#7e22ce}.actions,.record-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.record-actions{max-width:250px}.actions button,.record-actions button,.pagination button,.history-toolbar button,.profile-modal button:not(.primary):not(.close),.issuance-modal footer button:not(.primary),.pause-modal footer button:not(.primary){min-height:34px;border:1px solid #cbd8ea;border-radius:8px;background:#fff;padding:6px 10px;color:#254975;font:inherit;font-size:.72rem;font-weight:800;cursor:pointer}.actions .add{border-color:#b9cef5;background:#edf4ff;color:#1d54c6}.empty{padding:38px!important;text-align:center!important;color:var(--muted)}.pagination{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:15px;color:var(--muted);font-size:.75rem}.pagination div{display:flex;align-items:center;gap:9px}.pagination button:disabled{opacity:.45;cursor:not-allowed}.mobile-list{display:none}.modal-backdrop{position:fixed;z-index:500;inset:0;display:grid;place-items:center;padding:28px;background:rgba(13,30,59,.32)}.profile-modal,.issuance-modal,.pause-modal{position:relative;box-sizing:border-box;width:min(1220px,calc(100vw - 70px));max-height:calc(100vh - 56px);overflow:auto;border-radius:16px;background:#fff;padding:28px 32px;box-shadow:0 24px 70px rgba(13,30,59,.25)}.close{position:absolute;right:16px;top:12px;border:0;background:transparent;color:#34506f;font-size:1.65rem;cursor:pointer}.profile-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-right:36px}.profile-head h2,.issuance-modal h2,.pause-modal h2{font-size:1.65rem}.summary-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:22px 0}.summary-cards div{display:grid;gap:6px;padding:14px;border:1px solid var(--line);border-radius:10px;background:#f8faff}.summary-cards span{color:var(--muted);font-size:.69rem;font-weight:800;text-transform:uppercase}.summary-cards strong{font-size:1.15rem}.history-toolbar{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:10px}.history-toolbar h3{margin:0}.history-toolbar div{display:flex;gap:5px}.history-toolbar button.active{border-color:#2867e8;background:#eaf1ff;color:#1d54c6}.kind.loan{background:#e7efff;color:#2456b7}.kind.deduction{background:#f3e8ff;color:#7e22ce}.status{background:#eef2f7;color:#526174}.status-active{background:#dcfce7;color:#147a3d}.status-paused{background:#fff3cd;color:#8a5a00}.status-paid,.status-completed{background:#e7efff;color:#2456b7}.status-cancelled,.status-inactive{background:#f1f5f9;color:#64748b}.issuance-layer{z-index:540;background:rgba(13,30,59,.34)}.pause-layer{z-index:580;background:rgba(13,30,59,.3)}.issuance-modal{width:min(820px,calc(100vw - 50px))}.pause-modal{width:min(640px,calc(100vw - 50px))}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:22px}.form-grid .wide{grid-column:1/-1}.form-grid em{justify-self:end;margin-top:-21px;color:#8996a9;font-size:.65rem;font-style:normal}.section-label{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-top:6px;padding-top:16px;border-top:1px solid var(--line)}.section-label span{color:var(--muted);font-size:.7rem;font-weight:500}.plan-preview{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px;border:1px solid #bfd3f7;border-radius:10px;background:#f2f7ff}.plan-preview div{display:grid;gap:4px}.plan-preview span{color:#607392;font-size:.65rem;font-weight:750;text-transform:uppercase}.plan-preview strong{font-size:.9rem}.form-note{padding:11px 13px;border-radius:8px;background:#f1f6ff;color:#36577f;font-size:.75rem;line-height:1.5}.issuance-modal footer,.pause-modal footer{display:flex;justify-content:flex-end;gap:9px;margin-top:18px}.issuance-modal footer button,.pause-modal footer button{min-height:42px}.primary:disabled{opacity:.55;cursor:not-allowed}
.record-list{display:grid;gap:12px}.record-card{overflow:hidden;border:1px solid var(--line);border-radius:12px;background:#fff}.record-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:15px 17px;border-bottom:1px solid #e4eaf2;background:#f8faff}.record-heading{display:flex;align-items:flex-start;gap:10px}.record-heading strong,.record-heading small{display:block}.record-heading strong{font-size:.9rem}.record-heading small{margin-top:4px;color:var(--muted);font-size:.7rem}.record-details{display:grid;grid-template-columns:1fr 1.5fr 1fr 1fr;gap:0}.record-details>div{display:grid;align-content:start;gap:5px;min-height:74px;padding:14px 17px;border-right:1px solid #e4eaf2}.record-details>div:last-child{border-right:0}.record-details span{color:#607392;font-size:.65rem;font-weight:800;text-transform:uppercase}.record-details strong{font-size:.82rem}.record-details small{color:var(--muted);font-size:.68rem;line-height:1.4}.record-card>footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 17px;border-top:1px solid #e4eaf2;background:#fbfcfe}.record-card button,.review-plan{min-height:36px;border:1px solid #cbd8ea;border-radius:8px;background:#fff;padding:7px 11px;color:#254975;font:inherit;font-size:.72rem;font-weight:800;cursor:pointer}.record-card .view-plan,.review-plan{border-color:#b9cef5;background:#edf4ff;color:#1d54c6}.record-card .record-actions{justify-content:flex-end;max-width:none}.record-card .danger-action{border-color:#fecaca;color:#b42318}.review-plan{justify-self:start}.review-plan:disabled{opacity:.45;cursor:not-allowed}.plan-layer{z-index:570;background:rgba(13,30,59,.3)}.plan-modal{position:relative;box-sizing:border-box;width:min(1120px,calc(100vw - 70px));max-height:calc(100vh - 56px);overflow:auto;border-radius:16px;background:#fff;padding:28px 32px;box-shadow:0 24px 70px rgba(13,30,59,.25)}.plan-modal h2{margin:5px 0;font-size:1.65rem}.plan-modal header p{margin:0;color:var(--muted)}.plan-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:22px 0 12px}.plan-summary div{display:grid;gap:5px;padding:13px;border:1px solid var(--line);border-radius:9px;background:#f8faff}.plan-summary span{color:var(--muted);font-size:.66rem;font-weight:800;text-transform:uppercase}.plan-summary strong{font-size:1rem}.schedule-note,.schedule-help{margin:0 0 12px;padding:11px 13px;border-radius:8px;background:#f1f6ff;color:#36577f;font-size:.75rem;line-height:1.45}.schedule-help{margin:12px 0 0;background:#f8faff}.schedule-wrap{overflow:auto;border:1px solid var(--line);border-radius:10px}.schedule-wrap table{width:100%;min-width:940px;border-collapse:collapse}.schedule-wrap th,.schedule-wrap td{padding:12px 13px;border-bottom:1px solid #e4eaf2;text-align:left;white-space:nowrap}.schedule-wrap th{background:#f5f8fc;color:#405371;font-size:.67rem;text-transform:uppercase}.schedule-wrap td{font-size:.76rem}.period-status{display:inline-flex;border-radius:999px;background:#edf4ff;padding:4px 8px;color:#2456b7;font-size:.66rem;font-weight:800}.plan-modal footer{display:flex;justify-content:flex-end;margin-top:16px}.plan-modal footer button{min-height:40px;border:1px solid #cbd8ea;border-radius:8px;background:#fff;padding:6px 18px;color:#254975;font:inherit;font-size:.75rem;font-weight:800;cursor:pointer}.form-grid label>small{color:var(--muted);font-size:.67rem;font-weight:500;line-height:1.35}
@media(max-width:950px){.employee-accounts-page{padding:24px 18px}.desktop-list{display:none}.mobile-list{display:grid;gap:10px}.mobile-list article{display:grid;gap:12px;padding:14px;border:1px solid var(--line);border-radius:11px;background:#fff}.mobile-list article header{display:flex;justify-content:space-between;gap:10px}.mobile-list article header strong,.mobile-list article header small{display:block}.mobile-list article header small{margin-top:4px;color:var(--muted);font-size:.68rem}.mobile-list article header>span{font-size:.76rem;font-weight:850}.mobile-list footer{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mobile-list footer button{min-height:38px;border:1px solid #cbd8ea;border-radius:8px;background:#fff;color:#254975;font:inherit;font-size:.72rem;font-weight:800}.filters{grid-template-columns:1fr 220px auto}.history-wrap table{min-width:920px}.plan-summary{grid-template-columns:repeat(2,1fr)}.record-details{grid-template-columns:1fr 1fr}.record-details>div:nth-child(2){border-right:0}.record-details>div:nth-child(-n+2){border-bottom:1px solid #e4eaf2}}
@media(max-width:650px){.employee-accounts-page{padding:18px 12px}.page-head h1{font-size:1.65rem}.filters{grid-template-columns:1fr}.workflow-note{line-height:1.5}.pagination{align-items:stretch;flex-direction:column}.pagination div{justify-content:space-between}.modal-backdrop{align-items:stretch;padding:0}.profile-modal,.issuance-modal,.pause-modal,.plan-modal{width:100%;max-height:100dvh;border-radius:0;padding:58px 14px 24px}.profile-head{display:grid;padding-right:0}.profile-head .primary{width:100%}.summary-cards{grid-template-columns:1fr}.history-toolbar{align-items:stretch;flex-direction:column}.history-toolbar div{display:grid;grid-template-columns:repeat(3,1fr)}.form-grid{grid-template-columns:1fr}.form-grid .wide{grid-column:auto}.section-label{align-items:flex-start;flex-direction:column}.plan-preview,.plan-summary{grid-template-columns:1fr}.issuance-modal footer,.pause-modal footer{display:grid;grid-template-columns:1fr 1fr}.issuance-modal footer button,.pause-modal footer button{width:100%}.record-card>header,.record-card>footer{align-items:stretch;flex-direction:column}.record-details{grid-template-columns:1fr}.record-details>div{min-height:auto;border-right:0;border-bottom:1px solid #e4eaf2}.record-card .record-actions{display:grid;grid-template-columns:1fr 1fr}.record-card .record-actions button,.record-card .view-plan{width:100%}}
.employee-accounts-page button{transition:background-color .16s ease,border-color .16s ease,color .16s ease,box-shadow .16s ease,transform .16s ease}.employee-accounts-page button:not(:disabled){cursor:pointer}.employee-accounts-page button:not(:disabled):hover{transform:translateY(-1px);box-shadow:0 5px 14px rgba(30,64,115,.13)}.employee-accounts-page button:focus-visible{outline:3px solid rgba(40,103,232,.24);outline-offset:2px}.primary:not(:disabled):hover{border-color:#174fc7;background:#174fc7}.close:hover{background:#edf4ff;color:#174fc7;box-shadow:none!important}.history-toolbar>div{display:flex;gap:4px;padding:4px;border:1px solid #d8e2ef;border-radius:11px;background:#f1f5f9}.history-toolbar .history-filter{display:flex;align-items:center;gap:7px;min-height:38px;border:1px solid transparent;border-radius:8px;background:transparent;padding:7px 11px;color:#526783}.history-toolbar .history-filter small{display:inline-grid;min-width:20px;height:20px;place-items:center;border-radius:999px;background:rgba(96,115,146,.12);font-size:.62rem}.history-toolbar .history-filter:not(.active):hover{border-color:#cbd8ea;background:#fff;color:#173e78}.history-toolbar .history-filter.active{border-color:transparent;color:#fff;box-shadow:0 4px 11px rgba(30,64,115,.2)}.history-toolbar .filter-all.active{background:#2867e8}.history-toolbar .filter-loan.active{background:#2456b7}.history-toolbar .filter-deduction.active{background:#7e22ce}.history-toolbar .history-filter.active small{background:rgba(255,255,255,.22)}.filter-dot{width:7px;height:7px;border-radius:50%;background:#74849c}.filter-loan .filter-dot{background:#3b82f6}.filter-deduction .filter-dot{background:#a855f7}.history-filter.active .filter-dot{background:#fff}.record-card{transition:border-color .18s ease,box-shadow .18s ease,transform .18s ease}.record-card:hover{border-color:#b9ccec;box-shadow:0 8px 22px rgba(30,64,115,.09);transform:translateY(-1px)}.record-card button:hover{border-color:#9db9e8;background:#f5f8ff;color:#174fc7}.record-card .view-plan:hover,.review-plan:not(:disabled):hover{border-color:#2867e8;background:#2867e8;color:#fff}.record-card .danger-action:hover{border-color:#ef4444;background:#fff1f2;color:#b42318}
.history-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:12px}.history-heading h3{margin:0 0 4px}.history-heading p{margin:0;color:var(--muted);font-size:.72rem}.scope-tabs{display:flex;gap:4px;padding:4px;border:1px solid #d8e2ef;border-radius:11px;background:#f1f5f9}.scope-filter{display:flex;align-items:center;gap:8px;min-height:38px;border:1px solid transparent;border-radius:8px;background:transparent;padding:7px 13px;color:#526783;font:inherit;font-size:.74rem;font-weight:800}.scope-filter small{display:inline-grid;min-width:21px;height:21px;place-items:center;border-radius:999px;background:rgba(96,115,146,.12);font-size:.62rem}.scope-filter:not(.active):hover{border-color:#cbd8ea;background:#fff;color:#173e78}.scope-filter.active{border-color:#2867e8;background:#2867e8;color:#fff;box-shadow:0 4px 11px rgba(30,64,115,.18)}.scope-filter.active small{background:rgba(255,255,255,.22)}.history-toolbar>strong{color:#405371;font-size:.76rem}.issuance-modal{width:min(900px,calc(100vw - 50px))}.issuance-form-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start;gap:16px}.form-field{align-content:start}.field-help{min-height:18px;color:var(--muted);font-size:.67rem;font-weight:500;line-height:1.35}.issuance-form-grid :deep(.modern-date-field){align-content:start;gap:7px;font-size:.76rem}.issuance-form-grid :deep(.modern-date-field__trigger){min-height:48px;border-color:#cbd8ea;border-radius:9px;padding:0 13px;font-size:.86rem}.issuance-form-grid :deep(.modern-date-field__panel){z-index:60}
@media(max-width:650px){.history-heading{align-items:stretch;flex-direction:column}.scope-tabs{display:grid;grid-template-columns:1fr 1fr}.scope-filter{justify-content:center}.history-toolbar>div{display:grid;grid-template-columns:repeat(3,1fr)}.history-toolbar .history-filter{justify-content:center;padding:7px 6px}.issuance-form-grid{grid-template-columns:1fr}.issuance-form-grid .wide{grid-column:auto}}

/* Issuance history filters */
.history-heading{display:block;margin-bottom:12px}.history-controls{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:8px;padding:10px 12px;border:1px solid #dce5f1;border-radius:13px;background:#f8fafd}.filter-group{display:flex;align-items:center;gap:10px}.filter-group-type{margin-left:auto}.filter-label{color:#657792;font-size:.64rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.scope-tabs,.type-tabs{display:flex;gap:4px;padding:4px;border:1px solid #d7e1ee;border-radius:10px;background:#eef3f8}.profile-modal .scope-filter,.profile-modal .history-filter{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:38px;border:1px solid transparent;border-radius:7px;background:transparent;padding:7px 11px;color:#4b607d;font:inherit;font-size:.72rem;font-weight:800;white-space:nowrap;box-shadow:none}.profile-modal .filter-icon{display:inline-grid;min-width:18px;height:18px;place-items:center;color:#72839b;font-size:.75rem;font-weight:900;line-height:1}.profile-modal .scope-filter small,.profile-modal .history-filter small{display:inline-grid;min-width:21px;height:21px;place-items:center;border-radius:999px;background:rgba(96,115,146,.12);color:inherit;font-size:.61rem}.profile-modal .scope-filter:not(.active):hover,.profile-modal .history-filter:not(.active):hover{border-color:#c5d3e6;background:#fff;color:#173e78;box-shadow:0 3px 9px rgba(30,64,115,.09)}.profile-modal .scope-filter:not(.active):hover .filter-icon,.profile-modal .history-filter:not(.active):hover .filter-icon{color:currentColor}.profile-modal .scope-filter.active,.profile-modal .history-filter.active{color:#fff;box-shadow:0 4px 11px rgba(30,64,115,.16)}.profile-modal .scope-active.active{border-color:#86d9a7;background:#dcfce7;color:#166534}.profile-modal .scope-archive.active{border-color:#b8c5d6;background:#e2e8f0;color:#334155}.profile-modal .filter-all.active{border-color:#2867e8;background:#2867e8}.profile-modal .filter-loan.active{border-color:#2456b7;background:#2456b7}.profile-modal .filter-deduction.active{border-color:#8b32cf;background:#8b32cf}.profile-modal .scope-filter.active .filter-icon,.profile-modal .history-filter.active .filter-icon{color:currentColor}.profile-modal .scope-filter.active small,.profile-modal .history-filter.active small{background:rgba(255,255,255,.22)}.profile-modal .scope-active.active small{background:rgba(22,101,52,.12)}.profile-modal .scope-archive.active small{background:rgba(51,65,85,.12)}.history-result{margin:0 2px 12px;color:#657792;font-size:.7rem;font-weight:650}

.profile-modal button.scope-filter[role="tab"],.profile-modal button.history-filter[role="tab"]{min-height:38px;border:1px solid transparent;border-radius:7px;background:transparent;padding:7px 11px;color:#4b607d}.profile-modal button.scope-active.active{border-color:#86d9a7;background:#dcfce7;color:#166534}.profile-modal button.scope-archive.active{border-color:#b8c5d6;background:#e2e8f0;color:#334155}.profile-modal button.filter-all.active{border-color:#2867e8;background:#2867e8;color:#fff}.profile-modal button.filter-loan.active{border-color:#2456b7;background:#2456b7;color:#fff}.profile-modal button.filter-deduction.active{border-color:#8b32cf;background:#8b32cf;color:#fff}

@media(max-width:800px){.history-controls{align-items:stretch;flex-direction:column;gap:10px}.filter-group,.filter-group-type{display:grid;grid-template-columns:54px 1fr;align-items:center;margin-left:0}.scope-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.type-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.profile-modal .scope-filter,.profile-modal .history-filter{width:100%;padding-inline:7px}}
@media(max-width:480px){.history-controls{padding:10px}.filter-group,.filter-group-type{grid-template-columns:1fr;gap:6px}.filter-label{padding-left:2px}.profile-modal .scope-filter,.profile-modal .history-filter{font-size:.68rem}.profile-modal .filter-icon{display:none}}
</style>
