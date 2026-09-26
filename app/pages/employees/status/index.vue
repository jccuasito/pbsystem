<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import SystemAlert from '../../../../components/alertmessage/SystemAlert.vue'
import type { AlertMessage } from '../../../../components/alertmessage/messages'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'

const employees = ref<any[]>([])
const deployments = ref<any[]>([])
const cutoffs = ref<any[]>([])
const dtrCutoffs = ref<any[]>([])
const history = ref<any[]>([])
const attendanceStatuses = ref<string[]>(['On-Leave', 'Vacation Leave', 'Sick Leave'])
const loading = ref(true), saving = ref(false), error = ref('')
const search = ref(''), agencyFilter = ref(''), positionFilter = ref('')
const sheetOpen = ref(false), statusOpen = ref(false), summaryOpen = ref(false)
const sheetSearch = ref(''), sheetEmployeeId = ref('')
const now = new Date(), selectedYear = ref(String(now.getFullYear()))
const selectedCutoffKey = ref(''), summaryEmployeeId = ref('')
const alert = ref<AlertMessage | null>(null)
const statusForm = ref({ EmployeeID: '', AttendanceStatus: 'On-Leave', StartDate: '', EndDate: '', Remarks: '' })

function dateOnly(value: any) { return String(value || '').slice(0, 10) }
function isoDate(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` }
function parseDate(value: string) { return new Date(`${value}T00:00:00`) }
function employeeCode(value: any) { return `EMP-${String(value || '').padStart(4, '0')}` }
function employeeNumber(value: any) { return value || 'Not yet assigned' }
function formatDate(value: any) {
  const iso = dateOnly(value)
  return iso ? parseDate(iso).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'
}
function cutoffKey(start: any, end: any) { return `${dateOnly(start)}|${dateOnly(end)}` }
function periodLabel(item: any) { return `${formatDate(item.PeriodStart)} – ${formatDate(item.PeriodEnd)}` }
function statusClass(value: any) { return `status-${String(value || '').toLowerCase().replace(/[^a-z]+/g, '-')}` }
function statusCode(value: any) {
  return ({ Present: 'P', Absent: 'A', Late: 'L', 'Half-Day': 'HD', 'On-Leave': 'OL', 'Vacation Leave': 'VL', Holiday: 'H', 'Rest Day': 'RD', Reliever: 'R', 'Sick Leave': 'SL' } as Record<string, string>)[String(value)] || '—'
}
function message(title: string, value: string, tone: AlertMessage['tone']): AlertMessage { return { title, message: value, tone } }
function generatedCutoffs(year: number) {
  return Array.from({ length: 12 }, (_, month) => {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`
    const lastDay = new Date(year, month + 1, 0).getDate()
    return [
      { PeriodStart: `${prefix}-01`, PeriodEnd: `${prefix}-15`, generated: true },
      { PeriodStart: `${prefix}-16`, PeriodEnd: `${prefix}-${lastDay}`, generated: true },
    ]
  }).flat()
}

function currentCutoffKey() {
  const year = now.getFullYear(), month = now.getMonth(), startDay = now.getDate() <= 15 ? 1 : 16
  const start = new Date(year, month, startDay)
  const end = startDay === 1 ? new Date(year, month, 15) : new Date(year, month + 1, 0)
  return cutoffKey(isoDate(start), isoDate(end))
}

const cutoffOptions = computed(() => {
  const unique = new Map<string, any>()
  const year = Number(selectedYear.value)
  const savedCutoffs = dtrCutoffs.value.filter(item => Number(dateOnly(item.PeriodStart).slice(0, 4)) === year)
  for (const item of [...savedCutoffs, ...generatedCutoffs(year)]) {
    const key = cutoffKey(item.PeriodStart, item.PeriodEnd)
    if (!unique.has(key)) unique.set(key, { ...item, key })
  }
  return [...unique.values()].sort((a, b) => String(a.PeriodStart).localeCompare(String(b.PeriodStart)))
})
const yearOptions = computed(() => {
  const years = new Set(Array.from({ length: 5 }, (_, index) => String(now.getFullYear() - 2 + index)))
  for (const item of dtrCutoffs.value) if (dateOnly(item.PeriodStart)) years.add(dateOnly(item.PeriodStart).slice(0, 4))
  return [...years].sort((a, b) => Number(b) - Number(a))
})
const selectedCutoff = computed(() => cutoffOptions.value.find(item => item.key === selectedCutoffKey.value) || cutoffOptions.value[0] || null)
const cutoffDates = computed(() => {
  if (!selectedCutoff.value) return []
  const result: string[] = [], cursor = parseDate(dateOnly(selectedCutoff.value.PeriodStart)), end = parseDate(dateOnly(selectedCutoff.value.PeriodEnd))
  while (cursor <= end) { result.push(isoDate(cursor)); cursor.setDate(cursor.getDate() + 1) }
  return result
})
const agencies = computed(() => [...new Set(employees.value.map(item => item.AgencyName).filter(Boolean))].sort())
const positions = computed(() => [...new Set(employees.value.map(item => item.PositionName).filter(Boolean))].sort())
const statusByEmployeeDate = computed(() => new Map(history.value.map(item => [`${item.EmployeeID}|${dateOnly(item.AttendanceDate)}`, item])))
const listedEmployees = computed(() => {
  const query = search.value.trim().toLowerCase()
  return employees.value.filter(employee => {
    const searchable = [employee.EmployeeName, employee.EmployeeNumber, employeeCode(employee.EmployeeID), employee.AgencyName, employee.PositionName]
    return (!query || searchable.some(value => String(value || '').toLowerCase().includes(query)))
      && (!agencyFilter.value || employee.AgencyName === agencyFilter.value)
      && (!positionFilter.value || employee.PositionName === positionFilter.value)
  })
})

function deploymentAt(employeeId: any, attendanceDate: string) {
  return deployments.value.find(item => String(item.EmployeeID) === String(employeeId)
    && dateOnly(item.StartDate) <= attendanceDate && (!item.EndDate || dateOnly(item.EndDate) >= attendanceDate)) || null
}
function cutoffAssignment(employeeId: any) {
  if (!selectedCutoff.value) return null
  return deployments.value.find(item => String(item.EmployeeID) === String(employeeId)
    && dateOnly(item.StartDate) <= dateOnly(selectedCutoff.value.PeriodEnd)
    && (!item.EndDate || dateOnly(item.EndDate) >= dateOnly(selectedCutoff.value.PeriodStart))) || null
}
const sheetEmployees = computed(() => {
  const query = sheetSearch.value.trim().toLowerCase()
  return employees.value.filter(employee => {
    const assignment = cutoffAssignment(employee.EmployeeID)
    if (!assignment) return false
    const searchable = [employee.EmployeeName, employee.EmployeeNumber, employeeCode(employee.EmployeeID), assignment.AgencyName, employee.PositionName]
    return (!query || searchable.some(value => String(value || '').toLowerCase().includes(query)))
      && (!sheetEmployeeId.value || String(employee.EmployeeID) === sheetEmployeeId.value)
  })
})
const statusEmployee = computed(() => employees.value.find(item => String(item.EmployeeID) === String(statusForm.value.EmployeeID)) || null)
const statusAssignment = computed(() => deploymentAt(statusForm.value.EmployeeID, statusForm.value.StartDate))
const sheetEmployee = computed(() => employees.value.find(item => String(item.EmployeeID) === sheetEmployeeId.value) || null)
const selectedSheetAgency = computed(() => cutoffAssignment(sheetEmployeeId.value)?.AgencyName || sheetEmployee.value?.AgencyName || 'No agency assignment')
const summaryEmployee = computed(() => employees.value.find(item => String(item.EmployeeID) === summaryEmployeeId.value) || null)
const selectedHistory = computed(() => history.value.filter(item => String(item.EmployeeID) === summaryEmployeeId.value))
const summaryCutoffs = computed(() => cutoffs.value.filter(item => String(item.EmployeeID) === summaryEmployeeId.value))
const summaryCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const row of selectedHistory.value) counts[row.AttendanceStatus] = (counts[row.AttendanceStatus] || 0) + 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1])
})
const canSaveStatus = computed(() => Boolean(statusForm.value.EmployeeID && statusForm.value.AttendanceStatus && statusForm.value.StartDate) && !saving.value)

function statusAt(employeeId: any, attendanceDate: string) { return statusByEmployeeDate.value.get(`${employeeId}|${attendanceDate}`) || null }
function isLocked(record: any) { return Boolean(record?.BatchID && record?.DtrStatus && record.DtrStatus !== 'Draft') }
function dateHeader(value: string) { return parseDate(value).toLocaleDateString('en-PH', { weekday: 'short' }) }
function latestStatus(employeeId: any) { return history.value.find(item => String(item.EmployeeID) === String(employeeId)) || null }

watch([selectedYear, cutoffOptions], ([year, options]) => {
  if (selectedCutoffKey.value && options.some(item => item.key === selectedCutoffKey.value)) return
  const currentKey = String(year) === String(now.getFullYear()) ? currentCutoffKey() : ''
  selectedCutoffKey.value = options.find(item => item.key === currentKey)?.key || options[0]?.key || ''
}, { immediate: true })

async function load(silent = false) {
  if (!silent) loading.value = true
  error.value = ''
  try {
    const result = await $fetch<any>('/api/employees/status')
    employees.value = result.employees || []; deployments.value = result.deployments || []; cutoffs.value = result.cutoffs || []
    dtrCutoffs.value = result.dtrCutoffs || []; history.value = result.history || []
    attendanceStatuses.value = result.attendanceStatuses || attendanceStatuses.value
  } catch (cause: any) { error.value = cause.data?.statusMessage || 'Unable to load employee status records.' }
  finally { if (!silent) loading.value = false }
}
async function openStatusSheet(employee?: any) {
  sheetEmployeeId.value = employee ? String(employee.EmployeeID) : ''
  sheetSearch.value = ''; error.value = ''
  const employeeCutoff = employee ? cutoffs.value.find(item => String(item.EmployeeID) === String(employee.EmployeeID)) : null
  if (employeeCutoff) {
    selectedYear.value = dateOnly(employeeCutoff.PeriodStart).slice(0, 4)
    selectedCutoffKey.value = cutoffKey(employeeCutoff.PeriodStart, employeeCutoff.PeriodEnd)
  } else {
    selectedYear.value = String(now.getFullYear())
    selectedCutoffKey.value = currentCutoffKey()
  }
  sheetOpen.value = true
  await load(true)
}
function openStatusCell(employee: any, attendanceDate: string) {
  const record = statusAt(employee.EmployeeID, attendanceDate)
  if (!deploymentAt(employee.EmployeeID, attendanceDate) || isLocked(record)) return
  const currentStatus = attendanceStatuses.value.includes(record?.AttendanceStatus) ? record.AttendanceStatus : 'On-Leave'
  statusForm.value = { EmployeeID: String(employee.EmployeeID), AttendanceStatus: currentStatus, StartDate: attendanceDate, EndDate: attendanceDate, Remarks: record?.Remarks || '' }
  error.value = ''; statusOpen.value = true
}
async function openSummary(employee: any) {
  summaryEmployeeId.value = String(employee.EmployeeID)
  summaryOpen.value = true
  await load(true)
}
async function saveStatus() {
  if (!canSaveStatus.value) return
  saving.value = true; error.value = ''
  try {
    const result = await $fetch<any>('/api/employees/status/attendance', { method: 'POST', body: statusForm.value })
    const employeeName = statusEmployee.value?.EmployeeName || 'The employee'
    statusOpen.value = false; await load(true)
    const detail = result.pending ? 'It will be attached automatically when the DTR cutoff is created.' : 'The matching Draft DTR was updated immediately.'
    alert.value = message('Employee status updated', `${employeeName} was updated for ${formatDate(statusForm.value.StartDate)}. ${detail}`, 'success')
  } catch (cause: any) { error.value = cause.data?.statusMessage || 'Unable to update employee status.' }
  finally { saving.value = false }
}

onMounted(() => load())
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !statusOpen.value && !summaryOpen.value && !sheetOpen.value })
</script>

<template>
  <main class="employee-status-page">
    <SystemAlert v-model="alert" />
    <header class="page-head"><div><p class="eyebrow">EMPLOYEE MANAGEMENT</p><h1>Employee Status</h1><small>Encode HR-approved leave requests and review each employee's attendance history.</small></div></header>
    <section class="filters main-filters"><label class="search-field">Search employee<input v-model="search" type="search" placeholder="Search employee ID, number, name, agency, or position"></label><label>Agency<select v-model="agencyFilter"><option value="">All Agencies</option><option v-for="agency in agencies" :key="agency">{{ agency }}</option></select></label><label>Position<select v-model="positionFilter"><option value="">All Positions</option><option v-for="position in positions" :key="position">{{ position }}</option></select></label></section>
    <p v-if="loading" class="state">Loading employee status records…</p><p v-else-if="error && !statusOpen && !sheetOpen" class="state error" role="alert">{{ error }}</p>
    <section v-else class="table-shell employee-table-shell"><table class="employee-table"><thead><tr><th>Employee ID</th><th>Employee No.</th><th>Name</th><th>Agency</th><th>Position</th><th>Latest status</th><th>Actions</th></tr></thead><tbody><tr v-for="employee in listedEmployees" :key="employee.EmployeeID"><td><strong class="employee-id">{{ employeeCode(employee.EmployeeID) }}</strong></td><td>{{ employeeNumber(employee.EmployeeNumber) }}</td><td class="employee-name">{{ employee.EmployeeName }}</td><td>{{ employee.AgencyName }}</td><td>{{ employee.PositionName }}</td><td><span v-if="latestStatus(employee.EmployeeID)" class="status-chip" :class="statusClass(latestStatus(employee.EmployeeID).AttendanceStatus)">{{ latestStatus(employee.EmployeeID).AttendanceStatus }}</span><small v-if="latestStatus(employee.EmployeeID)" class="latest-date">{{ formatDate(latestStatus(employee.EmployeeID).AttendanceDate) }}</small><span v-else class="muted">No status yet</span></td><td><div class="row-actions"><button class="action-button action-primary" type="button" @click="openStatusSheet(employee)">Update status</button><button class="action-button" type="button" @click="openSummary(employee)">View summary</button></div></td></tr><tr v-if="!listedEmployees.length"><td colspan="7" class="state">No employees match the selected filters.</td></tr></tbody></table></section>
    <footer class="list-footer">Showing {{ listedEmployees.length }} of {{ employees.length }} employees</footer>

    <div v-if="sheetOpen" class="modal-layer sheet-layer"><section class="modal sheet-modal"><button class="modal-close" type="button" aria-label="Close" @click="sheetOpen=false">×</button><header class="sheet-head"><div><p class="eyebrow">HR LEAVE ENCODING</p><h2>Employee status sheet</h2><small>Choose a generated cutoff and click a date to encode an approved leave request.</small></div></header>
      <section class="filters sheet-filters"><label class="year-field">Year<select v-model="selectedYear"><option v-for="year in yearOptions" :key="year" :value="year">{{ year }}</option></select></label><label>Cutoff<select v-model="selectedCutoffKey"><option v-for="option in cutoffOptions" :key="option.key" :value="option.key">{{ periodLabel(option) }}</option></select></label><label>Personnel<input v-model="sheetSearch" type="search" placeholder="Search employee ID, number, or name"></label><div class="agency-assignment"><span>Agency</span><strong>{{ selectedSheetAgency }}</strong></div></section>
      <p v-if="error && !statusOpen" class="error" role="alert">{{ error }}</p>
      <section v-if="selectedCutoff" class="cutoff-heading"><div><h3>{{ periodLabel(selectedCutoff) }}</h3><small>{{ sheetEmployeeId ? 'Selected employee' : 'Employees assigned during this cutoff' }}</small></div><p class="status-legend"><span v-for="status in attendanceStatuses" :key="status"><i :class="statusClass(status)"></i>{{ status }}</span></p></section>
      <section class="table-shell sheet-table-shell"><table class="status-grid"><thead><tr><th class="person-column">Name of personnel</th><th class="employee-number-column">Employee no.</th><th class="position-column">Position</th><th v-for="date in cutoffDates" :key="date" class="day-heading"><strong>{{ Number(date.slice(8, 10)) }}</strong><small>{{ dateHeader(date) }}</small></th></tr></thead><tbody><tr v-for="employee in sheetEmployees" :key="employee.EmployeeID"><td class="person-column"><button class="person-button" type="button" title="View employee status summary" @click="openSummary(employee)"><strong>{{ employee.EmployeeName }}</strong><small>{{ employeeCode(employee.EmployeeID) }}</small></button></td><td class="employee-number-column">{{ employeeNumber(employee.EmployeeNumber) }}</td><td class="position-column">{{ employee.PositionName }}</td><td v-for="date in cutoffDates" :key="date" class="day-cell"><button type="button" :disabled="!deploymentAt(employee.EmployeeID, date) || isLocked(statusAt(employee.EmployeeID, date))" :class="[statusAt(employee.EmployeeID, date) ? statusClass(statusAt(employee.EmployeeID, date).AttendanceStatus) : '', { 'outside-deployment': !deploymentAt(employee.EmployeeID, date), locked: isLocked(statusAt(employee.EmployeeID, date)) }]" :title="!deploymentAt(employee.EmployeeID, date) ? 'No agency deployment on this date' : isLocked(statusAt(employee.EmployeeID, date)) ? `${statusAt(employee.EmployeeID, date).DtrStatus} DTR — view only` : statusAt(employee.EmployeeID, date)?.AttendanceStatus || 'Click to add status'" @click="openStatusCell(employee, date)"><strong>{{ statusAt(employee.EmployeeID, date) ? statusCode(statusAt(employee.EmployeeID, date).AttendanceStatus) : deploymentAt(employee.EmployeeID, date) ? '+' : '—' }}</strong><small>{{ statusAt(employee.EmployeeID, date) ? statusAt(employee.EmployeeID, date).AttendanceStatus : deploymentAt(employee.EmployeeID, date) ? 'Click to add' : 'Not assigned' }}</small></button></td></tr><tr v-if="!sheetEmployees.length"><td :colspan="3 + cutoffDates.length" class="state">No employees are assigned during this cutoff.</td></tr></tbody></table></section>
      <footer><button class="secondary" type="button" @click="sheetOpen=false">Close</button></footer></section></div>

    <div v-if="statusOpen" class="modal-layer editor-layer"><form class="modal status-modal" @submit.prevent="saveStatus"><button class="modal-close" type="button" aria-label="Close" :disabled="saving" @click="statusOpen=false">×</button><p class="eyebrow">LEAVE REQUEST</p><h2>{{ statusEmployee?.EmployeeName }}</h2><small>{{ statusAssignment?.AgencyName }} · {{ statusEmployee?.PositionName }}</small><div class="selected-day"><span>{{ periodLabel(selectedCutoff) }}</span><strong>{{ formatDate(statusForm.StartDate) }}</strong></div><div class="status-options"><button v-for="status in attendanceStatuses" :key="status" type="button" :class="[statusClass(status), { selected: statusForm.AttendanceStatus === status }]" @click="statusForm.AttendanceStatus=status">{{ status }}</button></div><label class="remarks-field">Remarks<textarea v-model.trim="statusForm.Remarks" maxlength="255" placeholder="Reason, reference, or note"></textarea></label><p v-if="error" class="error" role="alert">{{ error }}</p><footer><button class="secondary" type="button" :disabled="saving" @click="statusOpen=false">Cancel</button><button class="primary" :disabled="!canSaveStatus">{{ saving ? 'Saving…' : 'Save status' }}</button></footer></form></div>

    <div v-if="summaryOpen" class="modal-layer editor-layer"><section class="modal summary-modal"><button class="modal-close" type="button" aria-label="Close" @click="summaryOpen=false">×</button><p class="eyebrow">EMPLOYEE STATUS SUMMARY</p><h2>{{ summaryEmployee?.EmployeeName }}</h2><small>{{ employeeCode(summaryEmployee?.EmployeeID) }} · {{ employeeNumber(summaryEmployee?.EmployeeNumber) }} · {{ summaryEmployee?.AgencyName }}</small><div class="summary-counts"><span v-for="([status, count]) in summaryCounts" :key="status" class="status-chip" :class="statusClass(status)">{{ status }}: {{ count }}</span><span v-if="!summaryCounts.length" class="muted">No status entries yet</span></div><div class="summary-grid"><section><h3>DTR cutoffs</h3><div class="timeline"><article v-for="cutoff in summaryCutoffs" :key="cutoff.BatchID"><strong>{{ periodLabel(cutoff) }}</strong><small>DTR {{ cutoff.DtrStatus }}</small></article><p v-if="!summaryCutoffs.length" class="empty-note">No DTR cutoff yet.</p></div></section><section><h3>Status history</h3><div class="timeline"><article v-for="row in selectedHistory" :key="row.AttendanceID"><div><strong>{{ formatDate(row.AttendanceDate) }}</strong><small>{{ row.BatchID ? periodLabel(row) : 'Waiting for DTR cutoff' }}<template v-if="row.Remarks"> · {{ row.Remarks }}</template></small></div><span class="status-chip" :class="statusClass(row.AttendanceStatus)">{{ row.AttendanceStatus }}</span></article><p v-if="!selectedHistory.length" class="empty-note">No employee status records yet.</p></div></section></div><footer><button class="secondary" type="button" @click="summaryOpen=false">Close</button></footer></section></div>
  </main>
</template>

<style scoped>
.employee-status-page{box-sizing:border-box;min-height:100%;padding:34px;color:#172642}.page-head,.sheet-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:25px}.eyebrow{margin:0 0 7px;color:#3262c9;font-size:12px;font-weight:900;letter-spacing:.09em}.page-head h1{margin:0 0 7px;font-size:36px;line-height:1.1}.page-head small,.modal small{color:#6d7d96}.filters{display:grid;gap:16px}.main-filters{grid-template-columns:minmax(320px,1fr) 270px 270px;margin-bottom:20px}.sheet-filters{grid-template-columns:260px minmax(260px,1fr) 230px;margin:18px 0}.filters label,.remarks-field{display:grid;gap:7px;color:#50617c;font-size:13px;font-weight:800}.filters input,.filters select,.remarks-field textarea{box-sizing:border-box;width:100%;min-height:46px;border:1px solid #ccd7e8;border-radius:10px;padding:0 13px;background:#fff;color:#17243d;font:inherit}.primary,.secondary,.action-button{min-height:42px;border:1px solid #cbd8ea;border-radius:10px;padding:0 17px;background:#fff;color:#24446c;font:inherit;font-weight:800;cursor:pointer}.primary,.action-primary{border-color:#2d53e8;background:#2d53e8;color:#fff}.primary:disabled{opacity:.55}.table-shell{max-width:100%;overflow:auto;border:1px solid #cfd9e7;border-radius:14px;background:#fff}.employee-table{width:100%;min-width:1120px;border-collapse:collapse}.employee-table th{padding:15px 17px;background:#f7f9fc;color:#53647c;font-size:12px;text-align:left;text-transform:uppercase}.employee-table td{padding:15px 17px;border-top:1px solid #e5ebf3;color:#233652;font-size:13px}.employee-id{color:#173e77}.employee-name{font-weight:900}.latest-date{display:block;margin-top:5px;font-size:10px}.row-actions{display:flex;gap:7px;white-space:nowrap}.action-button{min-height:36px;padding:0 12px;font-size:12px}.state{padding:30px;text-align:center}.error{color:#b42318;font-weight:700}.list-footer{padding:14px 2px;color:#697993;font-size:13px}.modal-layer{position:fixed;z-index:90;inset:0;display:grid;place-items:center;padding:20px;background:#0d1d3b99}.editor-layer{z-index:110}.modal{position:relative;box-sizing:border-box;width:min(760px,100%);max-height:calc(100dvh - 40px);overflow:auto;border:1px solid #d8e2ef;border-radius:18px;padding:28px;background:#fff;color:#172642;box-shadow:0 25px 70px #08152f55}.sheet-modal{width:min(1500px,calc(100vw - 70px))}.status-modal{width:min(600px,100%)}.summary-modal{width:min(950px,100%)}.modal-close{position:absolute;right:18px;top:14px;border:0;background:transparent;color:#38506e;font-size:27px;cursor:pointer}.modal h2{margin:0 0 7px}.sheet-head{align-items:center;margin-right:36px}.sheet-head h2{font-size:28px}.cutoff-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin:20px 0 10px}.cutoff-heading h3{margin:0 0 4px}.status-legend{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px 11px;margin:0;color:#566984;font-size:10px}.status-legend span{display:inline-flex;align-items:center;gap:4px}.status-legend i{width:10px;height:10px;border-radius:3px}.status-grid{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0}.status-grid th,.status-grid td{border-right:1px solid #dce3ec;border-bottom:1px solid #dce3ec;text-align:center}.status-grid th{height:52px;padding:5px 8px;background:#fff200;color:#172033;font-size:10px;text-transform:uppercase}.status-grid tbody tr:last-child td{border-bottom:0}.person-column,.employee-number-column,.agency-column,.position-column{box-sizing:border-box;background:#fff!important;text-align:left!important}.person-column{position:sticky;left:0;z-index:3;width:210px;min-width:210px}.employee-number-column{width:120px;min-width:120px}.agency-column{width:180px;min-width:180px}.position-column{width:135px;min-width:135px}.status-grid thead .person-column,.status-grid thead .employee-number-column,.status-grid thead .agency-column,.status-grid thead .position-column{background:#fff200!important}.person-button{width:100%;min-height:60px;border:0;background:transparent;padding:8px 10px;color:#163762;text-align:left;cursor:pointer}.person-button strong,.person-button small{display:block}.person-button strong{font-size:11px}.person-button small{margin-top:4px;font-size:9px}.day-heading,.day-cell{box-sizing:border-box;width:60px;min-width:60px}.day-heading strong,.day-heading small,.day-cell strong,.day-cell small{display:block}.day-heading strong{font-size:13px}.day-cell{padding:0!important}.day-cell button{width:100%;min-height:60px;border:0;background:#fff;color:#18375e;padding:4px 2px;cursor:pointer}.day-cell button:hover{background:#edf4ff}.day-cell button:disabled{cursor:not-allowed}.day-cell small{margin-top:3px;color:inherit;font-size:8px;line-height:1.1}.outside-deployment{background:#f1f5f9!important;color:#94a3b8!important}.locked{background-image:repeating-linear-gradient(135deg,transparent,transparent 5px,#0000000b 5px,#0000000b 9px)!important}.sheet-modal>footer,.modal>footer{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}.selected-day{display:flex;justify-content:space-between;gap:12px;margin-top:20px;border-radius:10px;padding:13px 15px;background:#eef4ff;color:#284b7a;font-size:12px}.status-options{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}.status-options button{min-height:40px;border:2px solid transparent;border-radius:9px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.status-options button.selected{border-color:#244be8;box-shadow:0 0 0 2px #244be822}.remarks-field textarea{min-height:82px;padding:10px 12px;resize:vertical}.status-chip{display:inline-flex;border-radius:999px;padding:5px 9px;background:#eef2f7;color:#43536b;font-size:11px;font-weight:900}.status-present{background:#dcfce7!important;color:#167443!important}.status-absent{background:#fee2e2!important;color:#991b1b!important}.status-late{background:#ffedd5!important;color:#9a3412!important}.status-half-day{background:#e2e8f0!important;color:#334155!important}.status-on-leave{background:#ede9fe!important;color:#5b21b6!important}.status-holiday{background:#fef3c7!important;color:#92400e!important}.status-rest-day{background:#e0f2fe!important;color:#075985!important}.status-reliever{background:#d1fae5!important;color:#065f46!important}.status-sick-leave{background:#ffe4e6!important;color:#9f1239!important}.summary-counts{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0}.summary-grid{display:grid;grid-template-columns:.75fr 1.25fr;gap:18px}.summary-grid>section{border:1px solid #e0e7f0;border-radius:12px;padding:15px}.summary-grid h3{margin:0 0 10px}.timeline{display:grid;gap:8px;max-height:410px;overflow:auto}.timeline article{display:flex;justify-content:space-between;gap:12px;border:1px solid #dee6f1;border-radius:9px;padding:10px}.timeline article>div{display:grid;gap:3px}.muted,.empty-note{color:#7a879b}
.status-vacation-leave{background:#fef3c7!important;color:#854d0e!important}

/* Keep this workflow visually compact even when dashboard-wide table/modal rules load later. */
.employee-status-page .employee-table{width:100%;min-width:1080px;border-collapse:collapse;font-family:inherit}
.employee-status-page .employee-table th{padding:13px 15px;background:#f6f8fc;color:#52627a;font:800 12px/1.2 inherit;text-align:left;text-transform:uppercase;letter-spacing:.02em}
.employee-status-page .employee-table td{padding:14px 15px;border-top:1px solid #e4eaf2;color:#223550;font:500 13px/1.35 inherit;vertical-align:middle}
.employee-status-page .action-button{appearance:none;min-height:34px;border:1px solid #cad6e7;border-radius:8px;padding:0 11px;background:#fff;color:#24446c;font:800 12px/1 inherit}
.employee-status-page .action-primary{border-color:#2d53e8;background:#2d53e8;color:#fff}
.employee-status-page .sheet-modal{display:flex;width:min(1180px,calc(100vw - 32px))!important;max-width:none!important;max-height:calc(100dvh - 32px);min-width:0;flex-direction:column;overflow:hidden;padding:20px}
.employee-status-page .sheet-head{flex:0 0 auto;align-items:flex-start;margin:0 34px 12px 0}
.employee-status-page .sheet-head h2{font-size:24px}
.employee-status-page .sheet-filters{grid-template-columns:90px 250px minmax(210px,1fr) 220px;gap:10px;margin:8px 0 10px}
.employee-status-page .agency-assignment{display:grid;min-width:0;gap:7px;color:#50617c;font-size:13px;font-weight:800}
.employee-status-page .agency-assignment strong{box-sizing:border-box;display:flex;align-items:center;min-height:46px;overflow:hidden;border:1px solid #ccd7e8;border-radius:10px;padding:0 13px;background:#f4f7fc;color:#17243d;white-space:nowrap;text-overflow:ellipsis}
.employee-status-page .cutoff-heading{align-items:center;margin:10px 0 8px}
.employee-status-page .cutoff-heading h3{font-size:16px}
.employee-status-page .status-legend{gap:5px 10px;font-size:10px}
.employee-status-page .sheet-table-shell{box-sizing:border-box;width:100%;min-width:0;max-height:330px;overflow:auto}
.employee-status-page .person-column{width:150px;min-width:150px}
.employee-status-page .employee-number-column{width:90px;min-width:90px}
.employee-status-page .position-column{width:95px;min-width:95px}
.employee-status-page .day-heading,.employee-status-page .day-cell{width:44px;min-width:44px}
.employee-status-page .status-grid th{height:42px;padding:3px 4px;background:#fff200;color:#172033;font:800 9px/1.1 inherit}
.employee-status-page .person-button,.employee-status-page .day-cell button{min-height:50px}
.employee-status-page .sheet-modal>footer{flex:0 0 auto;margin-top:12px}
.employee-status-page .status-modal{width:min(500px,100%);padding:22px}
.employee-status-page .status-options{grid-template-columns:repeat(3,minmax(0,1fr));margin:14px 0}

:global(html[data-theme='dark']) .employee-status-page{color:#e9efff}:global(html[data-theme='dark']) .table-shell,:global(html[data-theme='dark']) .modal,:global(html[data-theme='dark']) .summary-grid>section{border-color:#2b3b5b;background:#15223f;color:#edf3ff}:global(html[data-theme='dark']) .employee-table th{background:#1d2d4c;color:#b8c7df}:global(html[data-theme='dark']) .employee-table td{border-color:#293958;color:#e2eaf7}:global(html[data-theme='dark']) .status-grid tbody .person-column,:global(html[data-theme='dark']) .status-grid tbody .employee-number-column,:global(html[data-theme='dark']) .status-grid tbody .agency-column,:global(html[data-theme='dark']) .status-grid tbody .position-column,:global(html[data-theme='dark']) .day-cell button{background:#15223f;color:#e1eaff}:global(html[data-theme='dark']) .filters input,:global(html[data-theme='dark']) .filters select,:global(html[data-theme='dark']) .remarks-field textarea,:global(html[data-theme='dark']) .agency-assignment strong{border-color:#385070;background:#0e1b34;color:#f2f6ff}:global(html[data-theme='dark']) .secondary,:global(html[data-theme='dark']) .action-button:not(.action-primary){border-color:#405477;background:#1b2c4e;color:#dce8ff}:global(html[data-theme='dark']) .timeline article{border-color:#344867;background:#182946}
@media(max-width:900px){.employee-status-page{padding:22px 15px 60px}.page-head{align-items:stretch;flex-direction:column}.page-head h1{font-size:29px}.main-filters,.employee-status-page .sheet-filters{grid-template-columns:1fr}.sheet-modal{width:calc(100vw - 20px);padding:23px 12px}.sheet-head,.cutoff-heading{align-items:flex-start;flex-direction:column}.status-legend{justify-content:flex-start}.employee-number-column,.agency-column,.position-column{position:static}.person-column{width:175px;min-width:175px}.day-heading,.day-cell{width:52px;min-width:52px}.summary-grid{grid-template-columns:1fr}.status-options{grid-template-columns:repeat(2,1fr)}.modal>footer{position:sticky;bottom:-20px;margin:20px -16px -20px;padding:12px 16px;border-top:1px solid #dce4ef;background:inherit}.modal>footer button{flex:1}}
</style>
