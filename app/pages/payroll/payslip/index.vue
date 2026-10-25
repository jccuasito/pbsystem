<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, ref } from 'vue'
import EmployeePayslipSheet from '../../../components/EmployeePayslipSheet.vue'

type Employee = {
  EmployeeID: number; EmployeeNumber: string | null; EmployeeName: string; Status: string
  AgencyName: string | null; PositionName: string | null; LastCutoffEnd?: string | null; CutoffCount?: number
  PublicationStatus?:string; PayrollCount?:number; PostedPayrollCount?:number
}
type Line = { section: 'earnings' | 'adjustment' | 'government' | 'other'; label: string; hours: number; amount: number }
type Cutoff = {
  key: string; periodStart: string; periodEnd: string; status: string; payrollIds: number[]
  publicationStatus?:string;postedAt?:string|null
  assignmentType: 'Regular' | 'Reliever'; siteName: string | null
  sources: Array<{ payrollId: number; batchId: number | null; siteName: string; clientName: string; gross: number; deductions: number; net: number }>
  gross: number; deductions: number; net: number; lines: Line[]
}
type ListResult = { items: Employee[]; agencies: Array<{ AgencyID: number; AgencyName: string }>; canPost?:boolean; pagination: { page: number; pageSize: number; total: number; pages: number } }
type ProfileResult = { employee: Employee; cutoffs: Cutoff[] }

const list = ref<ListResult>({ items: [], agencies: [], pagination: { page: 1, pageSize: 25, total: 0, pages: 1 } })
const profile = ref<ProfileResult | null>(null)
const profileBody = ref<HTMLElement | null>(null)
const selectedPayslipKey = ref('')
const historySearch = ref('')
const historyYear = ref('')
const historyPage = ref(1)
const historyPageSize = 10
const search = ref('')
const agencyId = ref('')
const postingStatus=ref(''),profilePostingStatus=ref(''),postingBusy=ref(false)
const portalAccount=ref<any>(null),accountBusy=ref(false),recoveryCode=ref('')
const page = ref(1)
const loading = ref(false)
const profileLoading = ref(false)
const error = ref('')
const profileError = ref('')
const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0))
const date = (value?: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const period = (item: Cutoff) => `${date(item.periodStart)} – ${date(item.periodEnd)}`
const displayNumber = (employee: Employee) => employee.EmployeeNumber?.trim() || `EMP-${String(employee.EmployeeID).padStart(4, '0')}`
const isLatestPeriod = (item?: Cutoff) => Boolean(item && item.periodStart === profile.value?.cutoffs[0]?.periodStart && item.periodEnd === profile.value?.cutoffs[0]?.periodEnd)
const matchesPosting=(item:Cutoff)=>!profilePostingStatus.value||item.publicationStatus===profilePostingStatus.value
const latestCutoffs = computed(() => profile.value?.cutoffs.filter(item=>isLatestPeriod(item)&&matchesPosting(item)) || [])
const earlierCutoffs = computed(() => profile.value?.cutoffs.filter(item => !isLatestPeriod(item)&&matchesPosting(item)) || [])
const historyYears = computed(() => [...new Set(earlierCutoffs.value.map(item => item.periodEnd.slice(0, 4)))].sort().reverse())
const filteredHistory = computed(() => {
  const query = historySearch.value.trim().toLowerCase()
  return earlierCutoffs.value.filter((item) => {
    if (historyYear.value && !item.periodEnd.startsWith(historyYear.value)) return false
    if (!query) return true
    const searchable = [item.periodStart, item.periodEnd, period(item), item.assignmentType, item.siteName,
      ...item.sources.flatMap(source => [source.siteName, source.clientName])].join(' ').toLowerCase()
    return searchable.includes(query)
  })
})
const historyPageCount = computed(() => Math.max(1, Math.ceil(filteredHistory.value.length / historyPageSize)))
const pagedHistory = computed(() => filteredHistory.value.slice((historyPage.value - 1) * historyPageSize, historyPage.value * historyPageSize))
const visibleCutoffs = computed(() => [...latestCutoffs.value, ...pagedHistory.value])
const activeCutoff = computed(() => profile.value?.cutoffs.find(item => item.key === selectedPayslipKey.value) || null)
const lines = (section: Line['section']) => activeCutoff.value?.lines.filter(item => item.section === section) || []
const sum = (section: Line['section']) => lines(section).reduce((total, item) => total + Number(item.amount), 0)
const governmentTotal = computed(() => sum('government'))
const otherTotal = computed(() => sum('other'))

async function load() {
  loading.value = true; error.value = ''
  try {
    list.value = await $fetch<ListResult>('/api/payroll/payslips', {
      query: { search: search.value.trim(), agencyId: agencyId.value || undefined, postingStatus:postingStatus.value||undefined,page: page.value },
    })
  } catch (caught: any) {
    error.value = caught?.data?.statusMessage || caught?.message || 'Unable to load employees.'
  } finally { loading.value = false }
}

async function openProfile(employee: Employee) {
  profile.value = { employee, cutoffs: [] }
  selectedPayslipKey.value = ''
  historySearch.value = ''
  historyYear.value = ''
  historyPage.value = 1
  profilePostingStatus.value='';portalAccount.value=null;recoveryCode.value=''
  profileLoading.value = true; profileError.value = ''
  try {
    const result = await $fetch<ProfileResult>('/api/payroll/payslips', { query: { employeeId: employee.EmployeeID } })
    profile.value = result
    portalAccount.value=await $fetch('/api/payroll/payslips/account',{query:{employeeId:employee.EmployeeID}})
  } catch (caught: any) {
    profileError.value = caught?.data?.statusMessage || caught?.message || 'Unable to load payslip history.'
  } finally { profileLoading.value = false }
}

async function postPayslip(item:Cutoff){
  if(!profile.value||postingBusy.value)return
  const action=item.publicationStatus==='Posted'?'withdraw':'post'
  if(!confirm(action==='post'?'Post this finalized payslip for the employee to view in their portal?':'Withdraw this payslip from the employee portal?'))return
  const employee=profile.value.employee,selected=selectedPayslipKey.value
  postingBusy.value=true;profileError.value=''
  try{
    await $fetch('/api/payroll/payslips',{method:'POST',body:{employeeId:employee.EmployeeID,key:item.key,action}})
    await openProfile(employee);selectedPayslipKey.value=selected;await load()
  }catch(cause:any){profileError.value=cause?.data?.statusMessage||'Unable to change posting status.'}
  finally{postingBusy.value=false}
}
async function manageAccount(action:string){
  if(!profile.value||accountBusy.value||!confirm(action==='recovery'?'Verify this employee in person before providing a private recovery code. Continue?':`Change this employee portal account to ${action==='activate'?'Active':'Inactive'}?`))return
  accountBusy.value=true;recoveryCode.value=''
  try{
    const result:any=await $fetch('/api/payroll/payslips/account',{method:'POST',body:{employeeId:profile.value.employee.EmployeeID,action}})
    recoveryCode.value=result.recoveryCode||''
    portalAccount.value=await $fetch('/api/payroll/payslips/account',{query:{employeeId:profile.value.employee.EmployeeID}})
  }catch(cause:any){profileError.value=cause?.data?.statusMessage||'Unable to update portal access.'}
  finally{accountBusy.value=false}
}

async function viewPayslip(item: Cutoff) {
  selectedPayslipKey.value = item.key
  await nextTick()
  profileBody.value?.scrollTo({ top: 0 })
}

async function backToList() {
  selectedPayslipKey.value = ''
  await nextTick()
  profileBody.value?.scrollTo({ top: 0 })
}

function applyFilters() { page.value = 1; load() }
function changePage(next: number) { page.value = next; load() }
function changeHistoryPage(next: number) {
  historyPage.value = Math.max(1, Math.min(next, historyPageCount.value))
  profileBody.value?.scrollTo({ top: 0 })
}
onMounted(load)
let wasDeactivated = false
onDeactivated(() => { wasDeactivated = true })
onActivated(() => { if (wasDeactivated) void load(); wasDeactivated = false })
</script>

<template>
  <section class="payslip-page">
    <header class="page-head"><div><p class="eyebrow">PAYROLL</p><h1>Payslips</h1><p>Review finalized payslips and post them for employee access.</p></div><NuxtLink class="secondary portal-link" to="/employee-portal" target="_blank" rel="noopener">Employee portal</NuxtLink></header>
    <div class="notice">Regular payroll is shown by cutoff. Reliever payroll has a separate payslip for each site in the same cutoff.</div>
    <form class="filters" @submit.prevent="applyFilters">
      <label>Search employee<input v-model="search" type="search" placeholder="Employee name or number"></label>
      <label>Agency<select v-model="agencyId"><option value="">All agencies</option><option v-for="agency in list.agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option></select></label>
      <label>Payslip posting<select v-model="postingStatus"><option value="">All statuses</option><option value="posted">Posted</option><option value="not-posted">Not fully posted</option><option value="partial">Partially posted</option><option value="no-payslips">No payslips</option></select></label>
      <button type="submit" class="primary">Search</button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p class="result-count">Showing {{ list.items.length }} of {{ list.pagination.total }} employees</p>
    <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Agency / Position</th><th>Latest cutoff</th><th>Payroll cutoffs</th><th>Posting status</th><th>Action</th></tr></thead><tbody>
      <tr v-for="employee in list.items" :key="employee.EmployeeID"><td><strong>{{ employee.EmployeeName }}</strong><small>{{ displayNumber(employee) }}</small></td><td><strong>{{ employee.AgencyName || 'Unassigned agency' }}</strong><small>{{ employee.PositionName || 'Unassigned position' }}</small></td><td>{{ date(employee.LastCutoffEnd) }}</td><td>{{ employee.CutoffCount || 0 }} cutoff{{ Number(employee.CutoffCount) === 1 ? '' : 's' }}</td><td><span class="posting-badge" :class="{posted:employee.PublicationStatus==='Posted'}">{{employee.PublicationStatus || 'Not Posted'}}</span><small>{{employee.PostedPayrollCount || 0}} / {{employee.PayrollCount || 0}} payroll records posted</small></td><td><button type="button" class="secondary" @click="openProfile(employee)">View profile</button></td></tr>
      <tr v-if="!list.items.length"><td colspan="6" class="empty">{{ loading ? 'Loading employees…' : 'No employees match your search.' }}</td></tr>
    </tbody></table></div>
    <div class="pagination"><button type="button" class="secondary" :disabled="loading || page <= 1" @click="changePage(page - 1)">Previous</button><span>Page {{ list.pagination.page }} of {{ list.pagination.pages }}</span><button type="button" class="secondary" :disabled="loading || page >= list.pagination.pages" @click="changePage(page + 1)">Next</button></div>

    <div v-if="profile" class="modal-backdrop" @click.self="profile=null">
      <section class="profile-modal" role="dialog" aria-modal="true" :aria-label="`Payslips for ${profile.employee.EmployeeName}`">
        <header class="profile-head"><div><p class="eyebrow">EMPLOYEE PAYSLIPS</p><h2>{{ profile.employee.EmployeeName }}</h2><p>{{ displayNumber(profile.employee) }} · {{ profile.employee.AgencyName || 'Unassigned agency' }} · {{ profile.employee.PositionName || 'Unassigned position' }}</p></div><button type="button" class="close" aria-label="Close profile" @click="profile=null">×</button></header>
        <div ref="profileBody" class="profile-body">
          <aside v-if="portalAccount" class="portal-account">
            <strong>Employee portal: {{portalAccount.account?.Status || 'No account yet'}}</strong>
            <template v-if="portalAccount.canManage && portalAccount.account"><span>{{portalAccount.account.Email}} · {{portalAccount.account.ContactNumber}}</span><small>Agreement {{portalAccount.account.AgreementVersion}} accepted {{portalAccount.account.AgreementAcceptedAt}}</small><div class="posting-actions"><button type="button" class="secondary" :disabled="accountBusy" @click="manageAccount(portalAccount.account.Status==='Active'?'deactivate':'activate')">{{portalAccount.account.Status==='Active'?'Deactivate access':'Activate access'}}</button><button v-if="portalAccount.account.Status==='Active'" type="button" class="secondary" :disabled="accountBusy" @click="manageAccount('recovery')">Issue recovery code</button></div></template>
            <div v-if="recoveryCode" class="recovery-result" role="status"><span>6-digit recovery code</span><code>{{recoveryCode}}</code><small>Valid for 15 minutes and one use, with 5 incorrect attempts allowed. Give it directly to the verified employee together with their login email; no email or SMS is sent. Issuing a new code replaces the previous code.</small></div>
          </aside>
          <p v-if="profileError" class="error" role="alert">{{ profileError }}</p>
          <p v-if="profileLoading" class="empty">Loading payslip history…</p>
          <p v-else-if="!profile.cutoffs.length" class="empty">No finalized payslips yet for this employee.</p>
          <template v-else>
            <div v-if="!activeCutoff" class="history-list">
              <label class="posting-filter">Posting status<select v-model="profilePostingStatus" @change="historyPage=1"><option value="">All payslips</option><option value="Posted">Posted</option><option value="Not Posted">Not Posted</option></select></label>
              <div class="history-head"><div><h3>Payslip list</h3><p>Latest finalized payroll and earlier payslips for this employee.</p></div><span class="history-hint">{{ profile.cutoffs.length }} payslip{{ profile.cutoffs.length === 1 ? '' : 's' }}</span></div>
              <div v-if="earlierCutoffs.length" class="history-filters">
                <label>Search earlier payslips<input v-model="historySearch" type="search" placeholder="Cutoff, site, or client" @input="historyPage = 1"></label>
                <label>Year<select v-model="historyYear" @change="historyPage = 1"><option value="">All years</option><option v-for="year in historyYears" :key="year" :value="year">{{ year }}</option></select></label>
              </div>
              <div class="history-table-wrap"><table class="history-table">
                <thead><tr><th>Payroll cutoff</th><th>Assignment / site</th><th>Payroll sources</th><th>Gross</th><th>Deductions</th><th>Net pay</th><th>Posting</th><th>Action</th></tr></thead>
                <tbody>
                  <template v-for="(item, index) in visibleCutoffs" :key="item.key">
                    <tr v-if="index === 0" class="history-group"><td colspan="8">{{isLatestPeriod(item)?'Latest finalized cutoff':'Earlier payslips'}}</td></tr>
                    <tr v-else-if="!isLatestPeriod(item) && isLatestPeriod(visibleCutoffs[index - 1])" class="history-group"><td colspan="8">Earlier payslips</td></tr>
                    <tr :class="{ 'history-row--latest': isLatestPeriod(item) }">
                      <td><strong>{{ period(item) }}</strong><span v-if="isLatestPeriod(item)" class="latest-pill">Latest</span></td>
                      <td><strong>{{ item.assignmentType === 'Reliever' ? item.siteName || 'Unassigned site' : 'Regular' }}</strong><small v-if="item.assignmentType === 'Reliever'">Reliever</small></td>
                      <td>{{ item.sources.length }} {{ item.sources.length === 1 ? 'record' : 'records' }}</td>
                      <td>{{ money(item.gross) }}</td>
                      <td>{{ money(item.deductions) }}</td>
                      <td class="history-net">{{ money(item.net) }}</td>
                      <td><span class="posting-badge" :class="{posted:item.publicationStatus==='Posted'}">{{item.publicationStatus}}</span><small v-if="item.publicationStatus==='Posted'">{{item.postedAt}}</small></td><td><div class="posting-actions"><button type="button" class="secondary" @click="viewPayslip(item)">View payslip</button><button v-if="list.canPost" type="button" class="secondary" :disabled="postingBusy" @click="postPayslip(item)">{{item.publicationStatus==='Posted'?'Withdraw':'Post payslip'}}</button></div></td>
                    </tr>
                  </template>
                  <tr v-if="earlierCutoffs.length && !pagedHistory.length" class="history-group"><td colspan="8">Earlier payslips</td></tr>
                  <tr v-if="earlierCutoffs.length && !pagedHistory.length" class="history-empty"><td colspan="8">No earlier payslips match your search or year.</td></tr>
                </tbody>
              </table></div>
              <div v-if="earlierCutoffs.length" class="history-pagination">
                <span>{{ filteredHistory.length ? `Showing ${(historyPage - 1) * historyPageSize + 1}–${Math.min(historyPage * historyPageSize, filteredHistory.length)} of ${filteredHistory.length} earlier payslips` : 'No matching earlier payslips' }}</span>
                <div v-if="historyPageCount > 1"><button type="button" class="secondary" :disabled="historyPage <= 1" @click="changeHistoryPage(historyPage - 1)">Previous</button><span>Page {{ historyPage }} of {{ historyPageCount }}</span><button type="button" class="secondary" :disabled="historyPage >= historyPageCount" @click="changeHistoryPage(historyPage + 1)">Next</button></div>
              </div>
            </div>
            <div v-else class="payslip-detail">
              <div class="detail-toolbar"><button type="button" class="secondary" @click="backToList">Back to payslip list</button><button v-if="list.canPost" type="button" class="primary" :disabled="postingBusy" @click="postPayslip(activeCutoff)">{{activeCutoff.publicationStatus==='Posted'?'Withdraw payslip':'Post payslip'}}</button><span>{{activeCutoff.publicationStatus}} · {{ period(activeCutoff) }}{{ activeCutoff.assignmentType === 'Reliever' ? ` / ${activeCutoff.siteName || 'Reliever'}` : '' }}</span></div>
              <EmployeePayslipSheet :employee="profile.employee" :cutoff="activeCutoff" />
            </div>
          </template>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.portal-link{display:flex;align-items:center;text-decoration:none}.posting-badge{display:inline-block;padding:6px 10px;border-radius:20px;background:#fff0d5;color:#8c5c00;font-size:.74rem;font-weight:700;white-space:nowrap}.posting-badge.posted{background:#ddf8ea;color:#137844}.posting-actions{display:flex;flex-wrap:wrap;gap:8px}.portal-account{display:grid;gap:10px;margin-bottom:20px;padding:16px;border:1px solid #d5e1f2;border-radius:12px;background:#eff5ff;font-size:.82rem}.portal-account small{color:#657d9f}.portal-account code{overflow-wrap:anywhere}.posting-filter{display:grid;gap:6px;width:min(260px,100%);font-size:.8rem}.posting-filter select{min-height:42px;border:1px solid #cbd9ee;border-radius:9px;padding:8px 12px;background:#fff;color:#112b53}.payslip-page .filters{grid-template-columns:minmax(220px,1fr) minmax(180px,240px) minmax(180px,220px) auto}@media(max-width:950px){.payslip-page .filters{grid-template-columns:1fr 1fr}}@media(max-width:600px){.payslip-page .filters{grid-template-columns:1fr}}
.sheet-meta-reliever{grid-template-columns:1.5fr 1fr 1fr .8fr}
.payslip-page{--ink:#112b53;--muted:#657d9f;--line:#d5e1f2;color:var(--ink);padding:34px 36px 48px;font-family:Inter,'Segoe UI',sans-serif}.page-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.eyebrow{margin:0;color:#2863db;font-size:.72rem;font-weight:850;letter-spacing:.09em}.page-head h1,.profile-head h2{margin:6px 0 5px;font-size:2rem}.page-head p:not(.eyebrow),.profile-head p:not(.eyebrow){margin:0;color:var(--muted)}.primary,.secondary{font:inherit;font-weight:750;border-radius:9px;min-height:44px;padding:0 16px;cursor:pointer}.primary{background:#2864e8;color:#fff;border:1px solid #2864e8}.secondary{background:#fff;color:#1b4b91;border:1px solid #c8d7ed}.secondary:disabled{opacity:.5;cursor:default}.notice{margin:20px 0;padding:14px 16px;background:#ebf2ff;border-left:3px solid #6895ff;border-radius:8px;color:#315486}.filters{display:grid;grid-template-columns:minmax(260px,1fr) minmax(210px,300px) auto;align-items:end;gap:14px;margin:22px 0 12px}.filters label{display:grid;gap:7px;color:#3b5478;font-size:.78rem;font-weight:750}.filters input,.filters select{min-height:48px;border:1px solid #cbd9ee;border-radius:9px;background:#fff;color:var(--ink);padding:0 14px;font:inherit;font-size:.88rem}.result-count{font-size:.78rem;color:var(--muted);margin:16px 0 10px}.error{background:#fff1f1;border:1px solid #fecaca;border-radius:8px;color:#9c2525;padding:12px}.table-wrap{overflow:auto;background:#fff;border:1px solid var(--line);border-radius:13px}.table-wrap table{width:100%;border-collapse:collapse}.table-wrap th,.table-wrap td{padding:15px 18px;text-align:left;border-bottom:1px solid #e5edf8}.table-wrap th{background:#f3f7fc;color:#526c92;font-size:.68rem;text-transform:uppercase;letter-spacing:.025em}.table-wrap td{font-size:.84rem}.table-wrap td strong,.table-wrap td small{display:block}.table-wrap td small{margin-top:4px;color:var(--muted);font-size:.72rem}.table-wrap tr:last-child td{border-bottom:0}.empty{text-align:center;color:var(--muted);padding:28px!important}.pagination{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:16px;font-size:.78rem;color:var(--muted)}.modal-backdrop{position:fixed;inset:0;z-index:1200;background:rgba(20,36,64,.52);display:flex;align-items:center;justify-content:center;padding:24px}.profile-modal{display:flex;flex-direction:column;width:min(1500px,100%);max-height:calc(100vh - 48px);background:#fff;border:1px solid var(--line);border-radius:20px;box-shadow:0 25px 75px rgba(9,31,75,.28);overflow:hidden}.profile-head{display:flex;justify-content:space-between;gap:20px;padding:30px 36px 24px;border-bottom:1px solid var(--line)}.profile-head h2{font-size:1.7rem}.close{align-self:flex-start;width:38px;height:38px;border:0;background:transparent;color:#48648d;font-size:1.75rem;cursor:pointer}.profile-body{overflow:auto;padding:24px 36px 36px;background:#fafcff}.history-head{display:flex;justify-content:space-between;align-items:end;gap:20px}.history-head h3{margin:0 0 4px;font-size:1.15rem}.history-head p,.history-hint{margin:0;color:var(--muted);font-size:.78rem}.payslip-sheet{border:1px solid var(--line);border-radius:14px;background:#fff;overflow:hidden}.sheet-head{display:flex;justify-content:space-between;gap:20px;background:#f0f5ff;border-bottom:1px solid var(--line);padding:24px 26px}.sheet-head h3{margin:6px 0;font-size:1.3rem}.sheet-head p:not(.eyebrow){margin:0;color:var(--muted);font-size:.83rem}.sheet-period{text-align:right;display:grid;gap:3px}.sheet-period span,.sheet-meta span{color:var(--muted);font-size:.68rem;text-transform:uppercase;font-weight:750}.sheet-period strong{font-size:.87rem}.sheet-period small{color:var(--muted)}.sheet-meta{display:grid;grid-template-columns:1.5fr 1fr .6fr;gap:14px;padding:16px 26px;border-bottom:1px solid var(--line)}.sheet-meta div{display:grid;gap:4px}.sheet-meta strong{font-size:.82rem}.sheet-columns{display:grid;grid-template-columns:1.3fr 1fr 1fr}.sheet-section{min-width:0;padding:22px 24px;border-right:1px solid var(--line);display:flex;flex-direction:column}.sheet-section:last-child{border-right:0}.sheet-section h4{margin:0 0 12px;color:#17417c;font-size:.91rem;text-transform:uppercase;letter-spacing:.03em}.line-head,.sheet-line{display:grid;grid-template-columns:minmax(0,1fr) 62px 104px;align-items:start;gap:8px}.line-head.two,.sheet-line.two{grid-template-columns:minmax(0,1fr) 104px}.line-head{padding:8px 0;border-bottom:1px solid var(--line);color:#6b83a4;text-transform:uppercase;font-size:.65rem;font-weight:800}.line-head span:last-child,.sheet-line strong{text-align:right}.sheet-line{padding:9px 0;border-bottom:1px solid #edf1f7;font-size:.75rem}.sheet-line span:nth-child(2){text-align:right;color:var(--muted)}.sheet-line strong{font-weight:750}.subheading{margin-top:16px;color:#31588c;font-size:.7rem;font-weight:800;text-transform:uppercase}.empty-line{font-size:.75rem;color:var(--muted)}.section-total{display:flex;justify-content:space-between;gap:10px;margin-top:auto;padding-top:18px;font-size:.77rem;font-weight:800}.sheet-footer{display:flex;justify-content:flex-end;align-items:center;gap:24px;padding:16px 26px;background:#eaf2ff;border-top:1px solid var(--line)}.sheet-footer>div{display:flex;align-items:center;gap:12px}.sheet-footer span{font-size:.79rem;font-weight:800}.sheet-footer strong{font-size:.94rem}.sheet-footer .net-pay{border-left:1px solid #b7cbea;padding-left:24px}.sheet-footer .net-pay strong{font-size:1.35rem;color:#12458c}.source-block{padding:21px 26px;border-top:1px solid var(--line)}.source-block h4{margin:0 0 5px;font-size:.85rem}.source-block>p,.sheet-note{margin:0 0 12px;color:var(--muted);font-size:.73rem}.source-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:22px;padding:9px 0;border-top:1px solid #edf1f7;font-size:.75rem}.source-row strong,.source-row small{display:block}.source-row small{margin-top:3px;color:var(--muted)}.sheet-note{padding:0 26px 18px}
.history-list{display:grid;gap:18px}
.line-head:not(.two),.sheet-line:not(.two){column-gap:20px}
.line-head:not(.two) span:nth-child(2),.sheet-line:not(.two) span:nth-child(2){text-align:right;font-variant-numeric:tabular-nums}
.history-filters{display:grid;grid-template-columns:minmax(240px,1fr) 190px;gap:12px;align-items:end}
.history-filters label{display:grid;gap:6px;color:#3b5478;font-size:.76rem;font-weight:750}
.history-filters input,.history-filters select{box-sizing:border-box;width:100%;min-height:42px;border:1px solid #cbd9ee;border-radius:9px;padding:0 12px;background:#fff;color:var(--ink);font:inherit;font-size:.83rem}
.history-table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:13px;background:#fff}
.history-table{width:100%;min-width:950px;border-collapse:collapse}
.history-table th,.history-table td{padding:16px 18px;border-bottom:1px solid #e5edf8;text-align:left;vertical-align:middle}
.history-table th{background:#f3f7fc;color:#526c92;font-size:.68rem;text-transform:uppercase;letter-spacing:.025em}
.history-table td{font-size:.82rem}
.history-table tbody tr:last-child td{border-bottom:0}
.history-table td strong,.history-table td small{display:block}
.history-table td small{margin-top:4px;color:var(--muted);font-size:.72rem}
.history-table .history-group td{padding:10px 18px;background:#eef3fb;color:#31588c;font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.045em}
.history-table .history-empty td{padding:20px 18px;color:var(--muted);text-align:center}
.history-row--latest{background:#f3f7ff}
.latest-pill{display:inline-block;margin-top:7px;padding:4px 8px;border-radius:999px;background:#e2edff;color:#2055bd;font-size:.68rem;font-weight:800}
.history-net{font-weight:800;color:#12458c;white-space:nowrap}
.history-table .secondary{min-height:37px;padding:0 12px;white-space:nowrap;font-size:.77rem}
.history-pagination{display:flex;justify-content:space-between;align-items:center;gap:12px;color:var(--muted);font-size:.77rem}
.history-pagination>div{display:flex;align-items:center;gap:10px}
.history-pagination .secondary{min-height:36px;padding:0 11px;font-size:.76rem}
.detail-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;color:var(--muted);font-size:.81rem}
.detail-toolbar .secondary{min-height:38px;font-size:.78rem}
@media(max-width:950px){.sheet-columns{grid-template-columns:1fr}.sheet-section{border-right:0;border-bottom:1px solid var(--line)}.sheet-section:last-child{border-bottom:0}.filters{grid-template-columns:1fr 1fr}.filters button{grid-column:1/-1}.history-hint{display:none}}
@media(max-width:600px){.payslip-page{padding:24px 16px}.page-head{align-items:center}.page-head h1{font-size:1.6rem}.filters,.history-filters{grid-template-columns:1fr}.filters button{grid-column:auto}.modal-backdrop{padding:0}.profile-modal{max-height:100vh;height:100vh;border-radius:0}.profile-head,.profile-body{padding:20px 17px}.history-pagination{align-items:flex-start;flex-direction:column}.sheet-head,.sheet-meta{padding:18px}.sheet-head{flex-direction:column}.sheet-period{text-align:left}.sheet-meta{grid-template-columns:1fr 1fr}.sheet-footer{flex-direction:column;align-items:flex-end;gap:8px}.sheet-footer .net-pay{border-left:0;padding-left:0}.source-row{grid-template-columns:1fr auto}.source-row span:last-child{grid-column:2}}
.recovery-result{display:grid;justify-items:start;gap:9px;padding:16px;background:#fff;border:1px solid #d5e1f2;border-radius:10px}.recovery-result>span{font-size:.75rem;color:#526e93}.recovery-result code{font-family:'JetBrains Mono',monospace;font-size:1.8rem;font-weight:700;letter-spacing:.25em;color:#174fb4;user-select:all}.recovery-result small{max-width:650px;line-height:1.6}
</style>
