<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type Employee = {
  EmployeeID: number; EmployeeNumber: string | null; EmployeeName: string; Status: string
  AgencyName: string | null; PositionName: string | null; LastCutoffEnd?: string | null; CutoffCount?: number
}
type Line = { section: 'earnings' | 'adjustment' | 'government' | 'other'; label: string; hours: number; amount: number }
type Cutoff = {
  key: string; periodStart: string; periodEnd: string; status: string; payrollIds: number[]
  assignmentType: 'Regular' | 'Reliever'; siteName: string | null
  sources: Array<{ payrollId: number; batchId: number | null; siteName: string; clientName: string; gross: number; deductions: number; net: number }>
  gross: number; deductions: number; net: number; lines: Line[]
}
type ListResult = { items: Employee[]; agencies: Array<{ AgencyID: number; AgencyName: string }>; pagination: { page: number; pageSize: number; total: number; pages: number } }
type ProfileResult = { employee: Employee; cutoffs: Cutoff[] }

const list = ref<ListResult>({ items: [], agencies: [], pagination: { page: 1, pageSize: 25, total: 0, pages: 1 } })
const profile = ref<ProfileResult | null>(null)
const selectedPayslipKey = ref('')
const search = ref('')
const agencyId = ref('')
const page = ref(1)
const loading = ref(false)
const profileLoading = ref(false)
const error = ref('')
const profileError = ref('')
const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0))
const date = (value?: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const period = (item: Cutoff) => `${date(item.periodStart)} – ${date(item.periodEnd)}`
const displayNumber = (employee: Employee) => employee.EmployeeNumber?.trim() || `EMP-${String(employee.EmployeeID).padStart(4, '0')}`
const activeCutoff = computed(() => profile.value?.cutoffs.find(item => item.key === selectedPayslipKey.value) || profile.value?.cutoffs[0] || null)
const lines = (section: Line['section']) => activeCutoff.value?.lines.filter(item => item.section === section) || []
const sum = (section: Line['section']) => lines(section).reduce((total, item) => total + Number(item.amount), 0)
const governmentTotal = computed(() => sum('government'))
const otherTotal = computed(() => sum('other'))

async function load() {
  loading.value = true; error.value = ''
  try {
    list.value = await $fetch<ListResult>('/api/payroll/payslips', {
      query: { search: search.value.trim(), agencyId: agencyId.value || undefined, page: page.value },
    })
  } catch (caught: any) {
    error.value = caught?.data?.statusMessage || caught?.message || 'Unable to load employees.'
  } finally { loading.value = false }
}

async function openProfile(employee: Employee) {
  profile.value = { employee, cutoffs: [] }
  selectedPayslipKey.value = ''
  profileLoading.value = true; profileError.value = ''
  try {
    const result = await $fetch<ProfileResult>('/api/payroll/payslips', { query: { employeeId: employee.EmployeeID } })
    profile.value = result
    if (result.cutoffs[0]) selectedPayslipKey.value = result.cutoffs[0].key
  } catch (caught: any) {
    profileError.value = caught?.data?.statusMessage || caught?.message || 'Unable to load payslip history.'
  } finally { profileLoading.value = false }
}

function applyFilters() { page.value = 1; load() }
function changePage(next: number) { page.value = next; load() }
onMounted(load)
</script>

<template>
  <section class="payslip-page">
    <header class="page-head"><div><p class="eyebrow">PAYROLL</p><h1>Payslips</h1><p>View each employee’s finalized payslips and cutoff history.</p></div><button type="button" class="secondary" :disabled="loading" @click="load">{{ loading ? 'Refreshing…' : 'Refresh' }}</button></header>
    <div class="notice">Regular payroll is shown by cutoff. Reliever payroll has a separate payslip for each site in the same cutoff.</div>
    <form class="filters" @submit.prevent="applyFilters">
      <label>Search employee<input v-model="search" type="search" placeholder="Employee name or number"></label>
      <label>Agency<select v-model="agencyId"><option value="">All agencies</option><option v-for="agency in list.agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option></select></label>
      <button type="submit" class="primary">Search</button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p class="result-count">Showing {{ list.items.length }} of {{ list.pagination.total }} employees</p>
    <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Agency / Position</th><th>Latest cutoff</th><th>Payroll cutoffs</th><th>Action</th></tr></thead><tbody>
      <tr v-for="employee in list.items" :key="employee.EmployeeID"><td><strong>{{ employee.EmployeeName }}</strong><small>{{ displayNumber(employee) }}</small></td><td><strong>{{ employee.AgencyName || 'Unassigned agency' }}</strong><small>{{ employee.PositionName || 'Unassigned position' }}</small></td><td>{{ date(employee.LastCutoffEnd) }}</td><td>{{ employee.CutoffCount || 0 }} cutoff{{ Number(employee.CutoffCount) === 1 ? '' : 's' }}</td><td><button type="button" class="secondary" @click="openProfile(employee)">View profile</button></td></tr>
      <tr v-if="!list.items.length"><td colspan="5" class="empty">{{ loading ? 'Loading employees…' : 'No employees match your search.' }}</td></tr>
    </tbody></table></div>
    <div class="pagination"><button type="button" class="secondary" :disabled="loading || page <= 1" @click="changePage(page - 1)">Previous</button><span>Page {{ list.pagination.page }} of {{ list.pagination.pages }}</span><button type="button" class="secondary" :disabled="loading || page >= list.pagination.pages" @click="changePage(page + 1)">Next</button></div>

    <div v-if="profile" class="modal-backdrop" @click.self="profile=null">
      <section class="profile-modal" role="dialog" aria-modal="true" :aria-label="`Payslips for ${profile.employee.EmployeeName}`">
        <header class="profile-head"><div><p class="eyebrow">EMPLOYEE PAYSLIPS</p><h2>{{ profile.employee.EmployeeName }}</h2><p>{{ displayNumber(profile.employee) }} · {{ profile.employee.AgencyName || 'Unassigned agency' }} · {{ profile.employee.PositionName || 'Unassigned position' }}</p></div><button type="button" class="close" aria-label="Close profile" @click="profile=null">×</button></header>
        <div class="profile-body">
          <p v-if="profileError" class="error" role="alert">{{ profileError }}</p>
          <p v-if="profileLoading" class="empty">Loading payslip history…</p>
          <p v-else-if="!profile.cutoffs.length" class="empty">No finalized payslips yet for this employee.</p>
          <template v-else>
            <div class="history-head"><div><h3>Latest and history</h3><p>{{ profile.cutoffs.length }} payslip{{ profile.cutoffs.length === 1 ? '' : 's' }} from finalized payroll</p></div><span class="history-hint">Select a payslip to view it</span></div>
            <div class="history-tabs" role="tablist" aria-label="Payslip history"><button v-for="(item, index) in profile.cutoffs" :key="item.key" type="button" role="tab" :aria-selected="activeCutoff === item" :class="{ active: activeCutoff === item }" @click="selectedPayslipKey=item.key"><strong>{{ index === 0 ? 'Latest · ' : '' }}{{ period(item) }}</strong><small>{{ item.assignmentType === 'Reliever' ? `${item.siteName} · Reliever` : `${item.sources.length} payroll source${item.sources.length === 1 ? '' : 's'}` }} · {{ money(item.net) }} net</small></button></div>
            <article v-if="activeCutoff" class="payslip-sheet" aria-label="Finalized payslip">
              <header class="sheet-head"><div><p class="eyebrow">PAYSLIP · {{ activeCutoff.status.toUpperCase() }}</p><h3>{{ profile.employee.AgencyName || 'Payroll' }}</h3><p>{{ profile.employee.EmployeeName }} · {{ displayNumber(profile.employee) }}</p></div><div class="sheet-period"><span>PAYROLL CUTOFF</span><strong>{{ period(activeCutoff) }}</strong><small>{{ activeCutoff.payrollIds.length }} payroll record{{ activeCutoff.payrollIds.length === 1 ? '' : 's' }}</small></div></header>
              <div class="sheet-meta" :class="{ 'sheet-meta-reliever': activeCutoff.assignmentType === 'Reliever' }"><div><span>Employee</span><strong>{{ profile.employee.EmployeeName }}</strong></div><div><span>Position</span><strong>{{ profile.employee.PositionName || 'Unassigned' }}</strong></div><div><span>{{ activeCutoff.assignmentType === 'Reliever' ? 'Site' : 'Sites in this cutoff' }}</span><strong>{{ activeCutoff.assignmentType === 'Reliever' ? activeCutoff.siteName : activeCutoff.sources.length }}</strong></div><div v-if="activeCutoff.assignmentType === 'Reliever'"><span>Shift type</span><strong>Reliever</strong></div></div>
              <div class="sheet-columns">
                <section class="sheet-section"><h4>Gross income</h4><div class="line-head"><span>Pay item</span><span>Hours</span><span>Amount</span></div><div v-for="line in lines('earnings')" :key="`earning-${line.label}`" class="sheet-line"><span>{{ line.label }}</span><span>{{ line.hours ? line.hours.toFixed(2) : '—' }}</span><strong>{{ money(line.amount) }}</strong></div><div v-if="lines('adjustment').length" class="subheading">Prior-period adjustments</div><div v-for="line in lines('adjustment')" :key="`adjustment-${line.label}`" class="sheet-line"><span>{{ line.label.replace(/^Adjustment · /, '') }}</span><span>{{ line.hours ? line.hours.toFixed(2) : '—' }}</span><strong>{{ money(line.amount) }}</strong></div><p v-if="!lines('earnings').length && !lines('adjustment').length" class="empty-line">No earning lines.</p><div class="section-total"><span>Total gross income</span><strong>{{ money(activeCutoff.gross) }}</strong></div></section>
                <section class="sheet-section"><h4>Government deductions</h4><div class="line-head two"><span>Item</span><span>Amount</span></div><div v-for="line in lines('government')" :key="`government-${line.label}`" class="sheet-line two"><span>{{ line.label }}</span><strong>{{ money(line.amount) }}</strong></div><p v-if="!lines('government').length" class="empty-line">No government deductions.</p><div class="section-total"><span>Government total</span><strong>{{ money(governmentTotal) }}</strong></div></section>
                <section class="sheet-section"><h4>Other deductions</h4><div class="line-head two"><span>Item</span><span>Amount</span></div><div v-for="line in lines('other')" :key="`other-${line.label}`" class="sheet-line two"><span>{{ line.label }}</span><strong>{{ money(line.amount) }}</strong></div><p v-if="!lines('other').length" class="empty-line">No other deductions.</p><div class="section-total"><span>Other total</span><strong>{{ money(otherTotal) }}</strong></div></section>
              </div>
              <div class="sheet-footer"><div><span>Total deductions</span><strong>{{ money(activeCutoff.deductions) }}</strong></div><div class="net-pay"><span>Net pay</span><strong>{{ money(activeCutoff.net) }}</strong></div></div>
              <div class="source-block"><h4>{{ activeCutoff.assignmentType === 'Reliever' ? 'Payroll sources at this site' : 'Payroll sources in this cutoff' }}</h4><p v-if="activeCutoff.sources.length > 1">Combined from {{ activeCutoff.sources.length }} {{ activeCutoff.assignmentType === 'Reliever' ? 'payroll records' : 'site payrolls' }}. Each source remains listed below for review.</p><div v-for="source in activeCutoff.sources" :key="source.payrollId" class="source-row"><div><strong>{{ source.siteName }}</strong><small>{{ source.clientName }}{{ source.batchId ? ` · DTR-${String(source.batchId).padStart(4, '0')}` : '' }}</small></div><span>{{ money(source.gross) }} gross</span><span>{{ money(source.net) }} net</span></div></div>
              <p class="sheet-note">Amounts come from finalized payroll records. Cancelled payroll is excluded from this history.</p>
            </article>
          </template>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.sheet-meta-reliever{grid-template-columns:1.5fr 1fr 1fr .8fr}
.payslip-page{--ink:#112b53;--muted:#657d9f;--line:#d5e1f2;color:var(--ink);padding:34px 36px 48px;font-family:Inter,'Segoe UI',sans-serif}.page-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.eyebrow{margin:0;color:#2863db;font-size:.72rem;font-weight:850;letter-spacing:.09em}.page-head h1,.profile-head h2{margin:6px 0 5px;font-size:2rem}.page-head p:not(.eyebrow),.profile-head p:not(.eyebrow){margin:0;color:var(--muted)}.primary,.secondary{font:inherit;font-weight:750;border-radius:9px;min-height:44px;padding:0 16px;cursor:pointer}.primary{background:#2864e8;color:#fff;border:1px solid #2864e8}.secondary{background:#fff;color:#1b4b91;border:1px solid #c8d7ed}.secondary:disabled{opacity:.5;cursor:default}.notice{margin:20px 0;padding:14px 16px;background:#ebf2ff;border-left:3px solid #6895ff;border-radius:8px;color:#315486}.filters{display:grid;grid-template-columns:minmax(260px,1fr) minmax(210px,300px) auto;align-items:end;gap:14px;margin:22px 0 12px}.filters label{display:grid;gap:7px;color:#3b5478;font-size:.78rem;font-weight:750}.filters input,.filters select{min-height:48px;border:1px solid #cbd9ee;border-radius:9px;background:#fff;color:var(--ink);padding:0 14px;font:inherit;font-size:.88rem}.result-count{font-size:.78rem;color:var(--muted);margin:16px 0 10px}.error{background:#fff1f1;border:1px solid #fecaca;border-radius:8px;color:#9c2525;padding:12px}.table-wrap{overflow:auto;background:#fff;border:1px solid var(--line);border-radius:13px}.table-wrap table{width:100%;border-collapse:collapse}.table-wrap th,.table-wrap td{padding:15px 18px;text-align:left;border-bottom:1px solid #e5edf8}.table-wrap th{background:#f3f7fc;color:#526c92;font-size:.68rem;text-transform:uppercase;letter-spacing:.025em}.table-wrap td{font-size:.84rem}.table-wrap td strong,.table-wrap td small{display:block}.table-wrap td small{margin-top:4px;color:var(--muted);font-size:.72rem}.table-wrap tr:last-child td{border-bottom:0}.empty{text-align:center;color:var(--muted);padding:28px!important}.pagination{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:16px;font-size:.78rem;color:var(--muted)}.modal-backdrop{position:fixed;inset:0;z-index:1200;background:rgba(20,36,64,.52);display:flex;align-items:center;justify-content:center;padding:24px}.profile-modal{display:flex;flex-direction:column;width:min(1500px,100%);max-height:calc(100vh - 48px);background:#fff;border:1px solid var(--line);border-radius:20px;box-shadow:0 25px 75px rgba(9,31,75,.28);overflow:hidden}.profile-head{display:flex;justify-content:space-between;gap:20px;padding:30px 36px 24px;border-bottom:1px solid var(--line)}.profile-head h2{font-size:1.7rem}.close{align-self:flex-start;width:38px;height:38px;border:0;background:transparent;color:#48648d;font-size:1.75rem;cursor:pointer}.profile-body{overflow:auto;padding:24px 36px 36px;background:#fafcff}.history-head{display:flex;justify-content:space-between;align-items:end;gap:20px}.history-head h3{margin:0 0 4px;font-size:1.15rem}.history-head p,.history-hint{margin:0;color:var(--muted);font-size:.78rem}.history-tabs{display:flex;gap:9px;overflow:auto;padding:16px 0 22px}.history-tabs button{flex:0 0 auto;min-width:230px;text-align:left;padding:12px 16px;background:#fff;border:1px solid var(--line);border-radius:10px;color:var(--ink);cursor:pointer;font:inherit}.history-tabs button.active{border-color:#2864e8;background:#edf4ff;box-shadow:inset 0 0 0 1px #2864e8}.history-tabs strong,.history-tabs small{display:block}.history-tabs strong{font-size:.83rem}.history-tabs small{margin-top:5px;color:var(--muted);font-size:.7rem}.payslip-sheet{border:1px solid var(--line);border-radius:14px;background:#fff;overflow:hidden}.sheet-head{display:flex;justify-content:space-between;gap:20px;background:#f0f5ff;border-bottom:1px solid var(--line);padding:24px 26px}.sheet-head h3{margin:6px 0;font-size:1.3rem}.sheet-head p:not(.eyebrow){margin:0;color:var(--muted);font-size:.83rem}.sheet-period{text-align:right;display:grid;gap:3px}.sheet-period span,.sheet-meta span{color:var(--muted);font-size:.68rem;text-transform:uppercase;font-weight:750}.sheet-period strong{font-size:.87rem}.sheet-period small{color:var(--muted)}.sheet-meta{display:grid;grid-template-columns:1.5fr 1fr .6fr;gap:14px;padding:16px 26px;border-bottom:1px solid var(--line)}.sheet-meta div{display:grid;gap:4px}.sheet-meta strong{font-size:.82rem}.sheet-columns{display:grid;grid-template-columns:1.3fr 1fr 1fr}.sheet-section{min-width:0;padding:22px 24px;border-right:1px solid var(--line);display:flex;flex-direction:column}.sheet-section:last-child{border-right:0}.sheet-section h4{margin:0 0 12px;color:#17417c;font-size:.91rem;text-transform:uppercase;letter-spacing:.03em}.line-head,.sheet-line{display:grid;grid-template-columns:minmax(0,1fr) 62px 104px;align-items:start;gap:8px}.line-head.two,.sheet-line.two{grid-template-columns:minmax(0,1fr) 104px}.line-head{padding:8px 0;border-bottom:1px solid var(--line);color:#6b83a4;text-transform:uppercase;font-size:.65rem;font-weight:800}.line-head span:last-child,.sheet-line strong{text-align:right}.sheet-line{padding:9px 0;border-bottom:1px solid #edf1f7;font-size:.75rem}.sheet-line span:nth-child(2){text-align:right;color:var(--muted)}.sheet-line strong{font-weight:750}.subheading{margin-top:16px;color:#31588c;font-size:.7rem;font-weight:800;text-transform:uppercase}.empty-line{font-size:.75rem;color:var(--muted)}.section-total{display:flex;justify-content:space-between;gap:10px;margin-top:auto;padding-top:18px;font-size:.77rem;font-weight:800}.sheet-footer{display:flex;justify-content:flex-end;align-items:center;gap:24px;padding:16px 26px;background:#eaf2ff;border-top:1px solid var(--line)}.sheet-footer>div{display:flex;align-items:center;gap:12px}.sheet-footer span{font-size:.79rem;font-weight:800}.sheet-footer strong{font-size:.94rem}.sheet-footer .net-pay{border-left:1px solid #b7cbea;padding-left:24px}.sheet-footer .net-pay strong{font-size:1.35rem;color:#12458c}.source-block{padding:21px 26px;border-top:1px solid var(--line)}.source-block h4{margin:0 0 5px;font-size:.85rem}.source-block>p,.sheet-note{margin:0 0 12px;color:var(--muted);font-size:.73rem}.source-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:22px;padding:9px 0;border-top:1px solid #edf1f7;font-size:.75rem}.source-row strong,.source-row small{display:block}.source-row small{margin-top:3px;color:var(--muted)}.sheet-note{padding:0 26px 18px}
@media(max-width:950px){.sheet-columns{grid-template-columns:1fr}.sheet-section{border-right:0;border-bottom:1px solid var(--line)}.sheet-section:last-child{border-bottom:0}.filters{grid-template-columns:1fr 1fr}.filters button{grid-column:1/-1}.history-hint{display:none}}
@media(max-width:600px){.payslip-page{padding:24px 16px}.page-head{align-items:center}.page-head h1{font-size:1.6rem}.filters{grid-template-columns:1fr}.filters button{grid-column:auto}.modal-backdrop{padding:0}.profile-modal{max-height:100vh;height:100vh;border-radius:0}.profile-head,.profile-body{padding:20px 17px}.sheet-head,.sheet-meta{padding:18px}.sheet-head{flex-direction:column}.sheet-period{text-align:left}.sheet-meta{grid-template-columns:1fr 1fr}.sheet-footer{flex-direction:column;align-items:flex-end;gap:8px}.sheet-footer .net-pay{border-left:0;padding-left:0}.source-row{grid-template-columns:1fr auto}.source-row span:last-child{grid-column:2}}
</style>
