<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import ModernDateField from '../../../../components/ModernDateField.vue'
import SearchableSelect from '../../../../components/SearchableSelect.vue'
import SystemAlert from '../../../../components/alertmessage/SystemAlert.vue'
import { alertMessages, DEPLOYMENT_ALREADY_EXISTS, type AlertMessage } from '../../../../components/alertmessage/messages'
import { findDeploymentConflict } from '~~/shared/utils/deployment'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import { formatEmployeeId, formatEmployeeLabel, formatEmployeeName, formatEmployeeNumber } from '~/utils/employee'

const items = ref<any[]>([]), dtrAssignments = ref<any[]>([]), agencies = ref<any[]>([]), employees = ref<any[]>([]), siteRates = ref<any[]>([]), sites = ref<any[]>([]), shiftCodes = ref<any[]>([])
const loading = ref(true), busy = ref(false), error = ref(''), modalOpen = ref(false), detailsOpen = ref(false), rosterOpen = ref(false)
const selectedEmployee = ref<any | null>(null), selectedRoster = ref<any | null>(null)
const historyCutoff = ref(''), historyAssignment = ref('')
const employeeSearch = ref(''), agencyFilter = ref(''), clientFilter = ref(''), siteFilter = ref(''), cutoffFilter = ref('')
const historyView = ref<'deployments' | 'dtr'>('deployments')
const form = ref({ EmployeeID: '', SiteRateID: '', SiteID: '', ShiftCodeID: '', DeploymentType: 'Regular', StartDate: '', EndDate: '', Remarks: '' })
const ongoingDeployment = ref(true)
const deploymentAlert = ref<AlertMessage | null>(null)
const deploymentConflict = computed(() => findDeploymentConflict(items.value, form.value.EmployeeID, form.value.StartDate, form.value.EndDate))

function dateAfter(value: any, days: number) { const date = new Date(`${String(value).slice(0, 10)}T00:00:00`); date.setDate(date.getDate() + days); return date }
function sameOrNextDay(left: any, right: any) { return !left || dateAfter(right, 1).getTime() >= new Date(`${String(left).slice(0, 10)}T00:00:00`).getTime() }
function consolidatedPermanentHistory(entries: any[]) {
  const ordered = [...entries].sort((a, b) => String(a.StartDate).localeCompare(String(b.StartDate)) || Number(a.DeploymentID) - Number(b.DeploymentID))
  const timeline: any[] = []
  for (const item of ordered) {
    const previous = timeline[timeline.length - 1]
    const sameSite = previous && String(previous.AgencyID) === String(item.AgencyID) && String(previous.SiteID) === String(item.SiteID)
    if (sameSite && sameOrNextDay(item.StartDate, previous.EndDate)) {
      previous.EndDate = !previous.EndDate || !item.EndDate ? null : String(previous.EndDate) > String(item.EndDate) ? previous.EndDate : item.EndDate
      previous.DeploymentType = item.DeploymentType
      previous.Status = item.Status === 'Active' || previous.Status === 'Active' ? 'Active' : previous.Status
      previous.Remarks = previous.Remarks || item.Remarks
      continue
    }
    timeline.push({ ...item, DeploymentID: `permanent-${item.DeploymentID}` })
  }
  return timeline.sort((a, b) => String(b.StartDate).localeCompare(String(a.StartDate)))
}
const employeeGroups = computed(() => {
  const groups = new Map<string, any>()
  // A permanent timeline is one continuous site assignment, never one record per cutoff.
  // The raw cutoff-by-cutoff roster stays visible in the separate DTR attendance history.
  for (const item of items.value.filter(item => Number(item.IsPermanentSite) === 1)) { const key = String(item.EmployeeID); if (!groups.has(key)) groups.set(key, { ...item, history: [] }); groups.get(key).history.push(item) }
  return Array.from(groups.values()).map(group => { group.history = consolidatedPermanentHistory(group.history); group.current = group.history.find((item: any) => item.Status === 'Active') || group.history[0]; return group })
})
const cutoffOptions = computed(() => {
  const values = new Map<string, any>()
  for (const row of dtrAssignments.value) { const start = String(row.PeriodStart).slice(0, 10), end = String(row.PeriodEnd).slice(0, 10), key = `${start}|${end}`; if (!values.has(key)) values.set(key, { key, start, end }) }
  return Array.from(values.values()).sort((a, b) => b.start.localeCompare(a.start))
})
const filterClients = computed(() => {
  const values = new Map<string, any>()
  const rows = historyView.value === 'deployments' ? items.value.filter(row => Number(row.IsPermanentSite) === 1) : dtrAssignments.value
  for (const row of rows) if (!values.has(String(row.ClientID))) values.set(String(row.ClientID), { ClientID: row.ClientID, ClientName: row.ClientName })
  return Array.from(values.values()).sort((a, b) => String(a.ClientName).localeCompare(String(b.ClientName)))
})
const filterSites = computed(() => {
  const values = new Map<string, any>()
  const rows = historyView.value === 'deployments' ? items.value.filter(row => Number(row.IsPermanentSite) === 1) : dtrAssignments.value
  for (const row of rows) {
    if (clientFilter.value && String(row.ClientID) !== clientFilter.value) continue
    if (!values.has(String(row.SiteID))) values.set(String(row.SiteID), { SiteID: row.SiteID, SiteName: row.SiteName })
  }
  return Array.from(values.values()).sort((a, b) => String(a.SiteName).localeCompare(String(b.SiteName)))
})
const filteredAssignments = computed(() => {
  const query = employeeSearch.value.trim().toLowerCase()
  return dtrAssignments.value.filter(row => {
    const key = `${String(row.PeriodStart).slice(0, 10)}|${String(row.PeriodEnd).slice(0, 10)}`
    const employeeMatches = !query || [row.EmployeeName, row.EmployeeNumber, formatEmployeeId(row.EmployeeID)].some(value => String(value || '').toLowerCase().includes(query))
    return employeeMatches && (!agencyFilter.value || String(row.AgencyID) === agencyFilter.value) && (!clientFilter.value || String(row.ClientID) === clientFilter.value) && (!siteFilter.value || String(row.SiteID) === siteFilter.value) && (!cutoffFilter.value || key === cutoffFilter.value)
  })
})
const siteRosters = computed(() => {
  const groups = new Map<string, any>(); for (const row of filteredAssignments.value) { const key = String(row.BatchID); if (!groups.has(key)) groups.set(key, { ...row, people: [] }); groups.get(key).people.push(row) }
  return Array.from(groups.values()).map(group => ({ ...group, people: group.people.sort((a: any, b: any) => String(a.EmployeeName).localeCompare(String(b.EmployeeName))), regularCount: group.people.filter((p: any) => p.AttendanceType === 'Regular').length, relieverCount: group.people.filter((p: any) => p.AttendanceType === 'Reliever').length })).sort((a, b) => String(b.PeriodStart).localeCompare(String(a.PeriodStart)) || String(a.SiteName).localeCompare(String(b.SiteName)))
})
const filteredEmployees = computed(() => {
  const query = employeeSearch.value.trim().toLowerCase()
  return employeeGroups.value.filter(group => {
    const current = group.current || {}
    const employeeMatches = !query || [group.EmployeeName, group.EmployeeNumber, formatEmployeeId(group.EmployeeID)].some(value => String(value || '').toLowerCase().includes(query))
    return employeeMatches
      && (!agencyFilter.value || String(current.AgencyID) === agencyFilter.value)
      && (!clientFilter.value || String(current.ClientID) === clientFilter.value)
      && (!siteFilter.value || String(current.SiteID) === siteFilter.value)
  })
})
const selectedEmployeeDtrHistory = computed(() => selectedEmployee.value ? dtrAssignments.value.filter(row => String(row.EmployeeID) === String(selectedEmployee.value.EmployeeID)).sort((a, b) => String(b.PeriodStart).localeCompare(String(a.PeriodStart))) : [])
const employeeHistoryCutoffs = computed(() => {
  const values = new Map<string, { key: string; start: string; end: string }>()
  for (const row of selectedEmployeeDtrHistory.value) {
    const start = String(row.PeriodStart).slice(0, 10), end = String(row.PeriodEnd).slice(0, 10), key = `${start}|${end}`
    if (!values.has(key)) values.set(key, { key, start, end })
  }
  return Array.from(values.values()).sort((a, b) => b.start.localeCompare(a.start))
})
const historyFiltersActive = computed(() => Boolean(historyCutoff.value || historyAssignment.value))
const selectedHistoryCutoff = computed(() => employeeHistoryCutoffs.value.find(item => item.key === historyCutoff.value))
function matchesHistoryCutoff(startValue: any, endValue: any) {
  const cutoff = selectedHistoryCutoff.value
  if (!cutoff) return true
  const start = String(startValue || '').slice(0, 10), end = String(endValue || '').slice(0, 10)
  return (!start || start <= cutoff.end) && (!end || end >= cutoff.start)
}
const filteredFixedHistory = computed(() => (selectedEmployee.value?.history || []).filter((item: any) => matchesHistoryCutoff(item.StartDate, item.EndDate) && (!historyAssignment.value || item.DeploymentType === historyAssignment.value)))
const filteredEmployeeDtrHistory = computed(() => selectedEmployeeDtrHistory.value.filter(item => (!historyCutoff.value || `${String(item.PeriodStart).slice(0, 10)}|${String(item.PeriodEnd).slice(0, 10)}` === historyCutoff.value) && (!historyAssignment.value || item.AttendanceType === historyAssignment.value)))
function clearHistoryFilters() { historyCutoff.value = ''; historyAssignment.value = '' }
watch(employeeHistoryCutoffs, options => { if (historyCutoff.value && !options.some(item => item.key === historyCutoff.value)) historyCutoff.value = '' })
const selectedFormEmployee = computed(() => employees.value.find(employee => String(employee.EmployeeID) === String(form.value.EmployeeID)) || null)
const availableSiteRates = computed(() => selectedFormEmployee.value?.AgencyPositionID ? siteRates.value.filter(rate => String(rate.AgencyPositionID) === String(selectedFormEmployee.value.AgencyPositionID) && String(rate.AgencyID) === String(selectedFormEmployee.value.AgencyID)) : [])
const selectedSiteRate = computed(() => availableSiteRates.value.find(rate => String(rate.SiteRateID) === String(form.value.SiteRateID)) || null)
const availableSites = computed(() => selectedSiteRate.value ? sites.value.filter(site => String(site.SiteID) === String(selectedSiteRate.value.SiteID)) : [])
const availableShifts = computed(() => selectedFormEmployee.value && form.value.SiteID ? shiftCodes.value.filter(shift => String(shift.AgencyID) === String(selectedFormEmployee.value.AgencyID)) : [])
const employeeOptions = computed(() => employees.value.map(employee => ({ value: String(employee.EmployeeID), label: formatEmployeeLabel(employee), search: `${employee.AgencyName || ''} ${employee.PositionName || ''}` })))
const siteRateOptions = computed(() => availableSiteRates.value.map(rate => ({ value: String(rate.SiteRateID), label: `${rate.SiteName} — ${rate.ClientName} — ${rate.AgencyName} — ${rate.PositionName}${rate.RegionName ? ' — '+rate.RegionName : ''}` })))
const siteOptions = computed(() => availableSites.value.map(site => ({ value: String(site.SiteID), label: `${site.ClientName} — ${site.SiteName}` })))
const shiftOptions = computed(() => availableShifts.value.map(shift => ({ value: String(shift.ShiftCodeID), label: `${shift.ShiftCode} — ${shift.ShiftName}${shift.TimeIn && shift.TimeOut ? ' ('+String(shift.TimeIn).slice(0,5)+'–'+String(shift.TimeOut).slice(0,5)+')' : ''}` })))
const lookupLoading = ref(false)
const canSave = computed(() => !busy.value
  && !lookupLoading.value
  && selectedFormEmployee.value
  && selectedSiteRate.value
  && availableSites.value.some(site => String(site.SiteID) === String(form.value.SiteID))
  && availableShifts.value.some(shift => String(shift.ShiftCodeID) === String(form.value.ShiftCodeID))
  && Boolean(form.value.StartDate)
  && (ongoingDeployment.value || Boolean(form.value.EndDate))
  && (!form.value.EndDate || form.value.EndDate >= form.value.StartDate))
async function openNewDeployment() { reset(); modalOpen.value = true; lookupLoading.value = true; try { await load(true) } finally { lookupLoading.value = false } }
watch(agencies, current => { if (agencyFilter.value && !current.some(agency => String(agency.AgencyID) === agencyFilter.value)) agencyFilter.value = '' })
watch(clientFilter, () => { siteFilter.value = '' })
watch(historyView, () => { clientFilter.value = ''; siteFilter.value = ''; cutoffFilter.value = historyView.value === 'dtr' ? cutoffOptions.value[0]?.key || '' : '' })
watch(ongoingDeployment, ongoing => { if (ongoing) form.value.EndDate = '' })

function reset() { form.value = { EmployeeID: '', SiteRateID: '', SiteID: '', ShiftCodeID: '', DeploymentType: 'Regular', StartDate: '', EndDate: '', Remarks: '' }; ongoingDeployment.value = true; error.value = '' }
function onSiteChanged() { form.value.ShiftCodeID = '' }
function onEmployeeChanged() { form.value.SiteRateID = ''; form.value.SiteID = ''; form.value.ShiftCodeID = '' }
function onSiteRateChanged() { form.value.SiteID = selectedSiteRate.value?.SiteID ? String(selectedSiteRate.value.SiteID) : ''; form.value.ShiftCodeID = '' }
function display(value: any) { return value === null || value === undefined || value === '' ? '—' : value }
function formatDeploymentDate(value: any) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return display(value)
  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date)
}
function deploymentPeriod(start: any, end: any) {
  return `${formatDeploymentDate(start)} – ${end ? formatDeploymentDate(end) : 'Ongoing'}`
}
function deploymentConflictDescription(conflict: any) {
  if (!conflict) return ''
  const site = sites.value.find(item => String(item.SiteID) === String(conflict.SiteID))
  const rate = siteRates.value.find(item => String(item.SiteRateID) === String(conflict.SiteRateID))
  const clientName = conflict.ClientName || site?.ClientName || rate?.ClientName
  const siteName = conflict.SiteName || site?.SiteName
  const location = [clientName, siteName].filter(Boolean).join(' — ')
  const period = conflict.StartDate ? deploymentPeriod(conflict.StartDate, conflict.EndDate) : ''
  if (location && period) return `at ${location} (${period})`
  if (location) return `at ${location}`
  if (period) return `for ${period}`
  return ''
}
function showDeploymentConflict(conflict: any) {
  deploymentAlert.value = alertMessages.deploymentAlreadyExists(
    formatEmployeeLabel(selectedFormEmployee.value),
    deploymentConflictDescription(conflict),
  )
}
function shiftDisplay(item: any) {
  const code = String(item.ShiftCode || '').trim()
  const name = String(item.ShiftName || '').trim()
  if (!code && !name) return display('')
  return code && name && code !== name ? `${code} - ${name}` : (code || name)
}
function cutoffLabel(start: any, end: any) {
  const toDate = (value: any) => new Date(`${String(value).slice(0, 10)}T00:00:00`)
  const startDate = toDate(start), endDate = toDate(end)
  const month = new Intl.DateTimeFormat('en-US', { month: 'long' })
  const year = new Intl.DateTimeFormat('en-US', { year: 'numeric' })
  if (startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth()) return `${month.format(startDate)} ${startDate.getDate()}–${endDate.getDate()}, ${year.format(endDate)}`
  if (startDate.getFullYear() === endDate.getFullYear()) return `${month.format(startDate)} ${startDate.getDate()}–${month.format(endDate)} ${endDate.getDate()}, ${year.format(endDate)}`
  return `${month.format(startDate)} ${startDate.getDate()}, ${year.format(startDate)}–${month.format(endDate)} ${endDate.getDate()}, ${year.format(endDate)}`
}
function historyStatus(item: any, history: any[]) {
  // A DTR assignment may be a technical deployment only. When the employee's
  // current agency differs from this permanent deployment, show the real
  // employment movement without treating the DTR row itself as a transfer.
  if (item.CurrentEmployeeAgencyID && String(item.CurrentEmployeeAgencyID) !== String(item.AgencyID)) return 'Transferred'
  if (item.Status === 'Scheduled') return 'Scheduled'
  if (item.Status === 'Active') return 'Active'
  const newer = history.find((candidate: any) => String(candidate.StartDate) > String(item.StartDate))
  return newer && (newer.AgencyID !== item.AgencyID || newer.SiteRateID !== item.SiteRateID || newer.SiteID !== item.SiteID) ? 'Transferred' : 'Ended'
}
function openDetails(group: any) { clearHistoryFilters(); selectedEmployee.value = group; detailsOpen.value = true }
function openEmployeeDetails(person: any) {
  const group = employeeGroups.value.find(candidate => String(candidate.EmployeeID) === String(person.EmployeeID))
  // A reliever can exist only in a cutoff DTR roster and have no permanent
  // deployment yet. Keep the permanent timeline empty in that case, but still
  // open the shared employee-history modal so their DTR assignment is visible.
  openDetails(group || { ...person, history: [] })
}
function openRoster(roster: any) { selectedRoster.value = roster; rosterOpen.value = true }
async function load(silent = false) { if (!silent) loading.value = true; try { const response: any = await $fetch('/api/employees/deployments'); items.value = response.items || []; dtrAssignments.value = response.dtrAssignments || []; agencies.value = response.agencies || []; employees.value = response.employees || []; siteRates.value = response.siteRates || []; sites.value = response.sites || []; shiftCodes.value = response.agencyShiftCodes || []; if (!cutoffFilter.value && cutoffOptions.value[0]) cutoffFilter.value = cutoffOptions.value[0].key } catch (cause: any) { error.value = cause.data?.statusMessage || 'Unable to load deployment history.' } finally { if (!silent) loading.value = false } }
async function save() {
  if (!canSave.value) return
  if (deploymentConflict.value) {
    showDeploymentConflict(deploymentConflict.value)
    return
  }
  busy.value = true
  error.value = ''
  try {
    await $fetch('/api/employees/deployments', { method: 'POST', body: form.value })
    modalOpen.value = false
    historyView.value = 'deployments'
    employeeSearch.value = ''
    agencyFilter.value = ''
    clientFilter.value = ''
    siteFilter.value = ''
    cutoffFilter.value = ''
    reset()
    await load()
  } catch (cause: any) {
    if (cause.data?.data?.code === DEPLOYMENT_ALREADY_EXISTS) {
      showDeploymentConflict(cause.data?.data?.existingDeployment || deploymentConflict.value)
      await load(true)
    } else error.value = cause.data?.statusMessage || 'Unable to save deployment.'
  } finally { busy.value = false }
}
onMounted(load); useRealtimeRefresh(() => load(true), { shouldRefresh: () => !busy.value })
</script>

<template>
  <main class="deployments-page">
    <SystemAlert v-model="deploymentAlert" />
    <header class="page-head"><div><p>EMPLOYEE MANAGEMENT</p><h1>Deployment History</h1><small>Review saved deployments and cutoff-specific DTR assignments.</small></div><button class="primary" @click="openNewDeployment">+ New deployment</button></header>
    <nav class="history-tabs" aria-label="Deployment history view">
      <button type="button" :class="{ active: historyView === 'deployments' }" @click="historyView = 'deployments'">Deployment records</button>
      <button type="button" :class="{ active: historyView === 'dtr' }" @click="historyView = 'dtr'">DTR cutoff rosters</button>
    </nav>
    <form class="filters" @submit.prevent><label><span>Employee</span><input v-model="employeeSearch" placeholder="Search employee ID, number, or name" /></label><label><span>Agency</span><select v-model="agencyFilter"><option value="">All agencies</option><option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option></select></label><label><span>Client</span><select v-model="clientFilter"><option value="">All clients</option><option v-for="client in filterClients" :key="client.ClientID" :value="String(client.ClientID)">{{ client.ClientName }}</option></select></label><label><span>Site</span><select v-model="siteFilter"><option value="">All sites</option><option v-for="site in filterSites" :key="site.SiteID" :value="String(site.SiteID)">{{ site.SiteName }}</option></select></label><label v-if="historyView === 'dtr'"><span>Cutoff</span><select v-model="cutoffFilter"><option value="">All cutoffs</option><option v-for="cutoff in cutoffOptions" :key="cutoff.key" :value="cutoff.key">{{ cutoffLabel(cutoff.start, cutoff.end) }}</option></select></label><button class="ghost" type="submit">Search</button></form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <section v-if="historyView === 'deployments'" class="records-section">
      <p class="view-note">Showing saved deployment records. Open Details to review the complete timeline.</p>
      <div class="table-wrap records-wrap">
        <table class="responsive-table deployment-records-table">
          <thead><tr><th>Employee</th><th>Agency</th><th>Assignment</th><th>Period</th><th>Status</th><th>History</th></tr></thead>
          <tbody>
            <tr v-if="loading" class="message-row"><td colspan="6">Loading...</td></tr>
            <tr v-else-if="!filteredEmployees.length" class="message-row"><td colspan="6">No deployment records found.</td></tr>
            <tr v-for="group in filteredEmployees" :key="group.EmployeeID">
              <td data-label="Employee"><strong class="record-name">{{ formatEmployeeName(group) }}</strong><span class="record-meta"><b>{{ formatEmployeeId(group.EmployeeID) }}</b><span aria-hidden="true">&middot;</span>{{ formatEmployeeNumber(group.EmployeeNumber) }}</span></td>
              <td data-label="Agency">{{ display(group.current.AgencyName) }}</td>
              <td data-label="Assignment"><strong class="record-client">{{ display(group.current.ClientName) }}</strong><span class="record-meta">{{ display(group.current.SiteName) }}</span></td>
              <td data-label="Period" class="period-cell">{{ deploymentPeriod(group.current.StartDate, group.current.EndDate) }}</td>
              <td data-label="Status"><span class="status">{{ historyStatus(group.current, group.history) }}</span></td>
              <td data-label="History" class="action-cell"><button class="details" type="button" @click="openDetails(group)">Details ({{ group.history.length }})</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <section v-else class="records-section">
      <p class="view-note">{{ cutoffFilter ? 'Showing the DTR roster for the selected cutoff.' : 'Showing all saved DTR cutoffs.' }}</p>
      <div class="table-wrap records-wrap">
        <table class="responsive-table cutoff-rosters-table">
          <thead><tr><th>Client / site</th><th>Agency</th><th>Cutoff</th><th>People</th><th>DTR status</th><th>Roster</th></tr></thead>
          <tbody>
            <tr v-if="loading" class="message-row"><td colspan="6">Loading...</td></tr>
            <tr v-else-if="!siteRosters.length" class="message-row"><td colspan="6">No DTR assignments found for this search and cutoff.</td></tr>
            <tr v-for="roster in siteRosters" :key="roster.BatchID">
              <td data-label="Client / site"><strong class="record-client">{{ roster.ClientName }}</strong><span class="record-meta">{{ roster.SiteName }}</span></td>
              <td data-label="Agency">{{ roster.AgencyName }}</td>
              <td data-label="Cutoff" class="period-cell">{{ cutoffLabel(roster.PeriodStart, roster.PeriodEnd) }}</td>
              <td data-label="People"><span class="roster-count">{{ roster.people.length }} assigned</span><span class="roster-breakdown"><span class="type type--regular">{{ roster.regularCount }} Regular</span><span class="type type--reliever">{{ roster.relieverCount }} Reliever</span></span></td>
              <td data-label="DTR status"><span class="status">{{ roster.DtrStatus }}</span></td>
              <td data-label="Roster" class="action-cell"><button class="details" type="button" @click="openRoster(roster)">View people ({{ roster.people.length }})</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <Teleport to="body"><div v-if="modalOpen" class="backdrop" @click.self="!busy && (modalOpen = false)">
      <form class="modal deployment-form" @submit.prevent="save">
        <button class="close" type="button" aria-label="Close new deployment" :disabled="busy" @click="modalOpen = false">×</button>
        <header class="form-intro">
          <p>EMPLOYEE DEPLOYMENT</p>
          <h2>New deployment</h2>
          <small>Choose the employee and assignment, then set how long the deployment will run.</small>
        </header>
        <p v-if="lookupLoading" class="view-note" role="status">Loading employees and agency shifts...</p>
        <section class="form-section">
          <div class="section-heading"><span class="section-number">1</span><div><h3>Employee and rate</h3><p>The employee position automatically limits the available site rates.</p></div></div>
          <SearchableSelect v-model="form.EmployeeID" label="Employee" placeholder="Search employee name, ID, or employee number" :options="employeeOptions" :disabled="busy || lookupLoading" required @change="onEmployeeChanged" />
          <div v-if="selectedFormEmployee" class="employee-position" role="status"><strong>{{ selectedFormEmployee.PositionName }}</strong> · {{ selectedFormEmployee.AgencyName }}<small>Position from Employee List. Only matching site rates are shown.</small></div>
          <SearchableSelect v-model="form.SiteRateID" label="Site rate" placeholder="Search site, client, or rate" :options="siteRateOptions" :disabled="busy || lookupLoading || !selectedFormEmployee" empty-text="No active site rates match this employee's agency and position." required @change="onSiteRateChanged" />
          <div v-if="selectedFormEmployee && !lookupLoading && !availableSiteRates.length" class="deployment-warning" role="status">No matching site rate. Add an active site rate for {{ selectedFormEmployee.PositionName }} under {{ selectedFormEmployee.AgencyName }} before creating this deployment.</div>
        </section>
        <section class="form-section">
          <div class="section-heading"><span class="section-number">2</span><div><h3>Assignment details</h3><p>Select the site, agency shift, and deployment type.</p></div></div>
          <div class="assignment-grid">
            <SearchableSelect v-model="form.SiteID" label="Site" placeholder="Search site name" :options="siteOptions" :disabled="busy || lookupLoading || !selectedSiteRate" required @change="onSiteChanged" />
            <SearchableSelect v-model="form.ShiftCodeID" label="Agency shift" placeholder="Search shift code or name" :options="shiftOptions" :disabled="busy || lookupLoading || !form.SiteID" empty-text="No active shifts for this agency. Add one in Attendance > Shift Codes." required />
            <label>Deployment type<select v-model="form.DeploymentType"><option>Regular</option><option>Reliever</option></select></label>
            <label><span>Remarks <small class="optional-label">Optional</small></span><input v-model="form.Remarks" placeholder="Add a note about this assignment"></label>
          </div>
          <p v-if="form.SiteID && !lookupLoading && !availableShifts.length" class="error" role="alert">No active shift codes for this employee's agency. Add a shift in Attendance &gt; Shift Codes first.</p>
        </section>
        <section class="form-section period-section">
          <div class="section-heading"><span class="section-number">3</span><div><h3>Deployment period</h3><p>Enter the first day. Turn off Ongoing only when the last day is already known.</p></div></div>
          <div class="date-range">
            <div class="date-field"><ModernDateField v-model="form.StartDate" label="Start date" placeholder="Select start date" required /><small>First day assigned</small></div>
            <span class="date-arrow" aria-hidden="true">&rarr;</span>
            <div class="date-field" :class="{ 'date-field--disabled': ongoingDeployment }"><ModernDateField v-model="form.EndDate" label="End date" placeholder="Select end date" :min="form.StartDate || undefined" :required="!ongoingDeployment" :disabled="ongoingDeployment" align="end" /><small>{{ ongoingDeployment ? 'No end date yet' : 'Last day assigned' }}</small></div>
          </div>
          <label class="ongoing-toggle"><input v-model="ongoingDeployment" type="checkbox"><span><strong>Ongoing deployment</strong><small>Keep this checked if the employee has no confirmed end date.</small></span></label>
        </section>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div v-if="deploymentConflict" class="deployment-warning" role="status">Existing deployment: {{ deploymentConflict.ClientName ? `${deploymentConflict.ClientName} — ` : '' }}{{ deploymentConflict.SiteName || 'assigned site' }} ({{ deploymentPeriod(deploymentConflict.StartDate, deploymentConflict.EndDate) }}). The selected dates overlap this record. Check the history or use Transfer to change sites.</div>
        <footer><button type="button" :disabled="busy" @click="modalOpen = false">Cancel</button><button class="primary" :disabled="!canSave">{{ busy ? 'Saving...' : 'Save' }}</button></footer>
      </form>
    </div></Teleport>
    <Teleport to="body"><div v-if="rosterOpen && selectedRoster" class="backdrop" @click.self="rosterOpen = false"><section class="modal roster-modal"><button class="close" type="button" @click="rosterOpen = false">×</button><p>SITE DTR ROSTER</p><h2>{{ selectedRoster.ClientName }} — {{ selectedRoster.SiteName }}</h2><small>{{ selectedRoster.AgencyName }} · {{ cutoffLabel(selectedRoster.PeriodStart, selectedRoster.PeriodEnd) }} · {{ selectedRoster.DtrStatus }}</small><div class="roster-summary"><span>{{ selectedRoster.people.length }} assigned</span><span class="type type--regular">{{ selectedRoster.regularCount }} Regular</span><span class="type type--reliever">{{ selectedRoster.relieverCount }} Reliever</span></div><div class="table-wrap"><table><thead><tr><th>Employee ID</th><th>Employee no.</th><th>Name</th><th>Position</th><th>DTR type</th><th>History</th></tr></thead><tbody><tr v-for="person in selectedRoster.people" :key="person.EmployeeID"><td class="employee-id">{{ formatEmployeeId(person.EmployeeID) }}</td><td>{{ formatEmployeeNumber(person.EmployeeNumber) }}</td><td>{{ person.EmployeeName }}</td><td>{{ display(person.PositionName) }}</td><td><span class="type" :class="`type--${String(person.AttendanceType).toLowerCase()}`">{{ person.AttendanceType }}</span></td><td><button class="details" @click="openEmployeeDetails(person)">Employee details</button></td></tr></tbody></table></div><footer><button type="button" @click="rosterOpen = false">Close</button></footer></section></div></Teleport>
    <Teleport to="body">
      <div v-if="detailsOpen && selectedEmployee" class="backdrop" @click.self="detailsOpen = false">
        <section class="modal history-modal" role="dialog" aria-modal="true" aria-labelledby="employee-history-title" @keydown.esc.stop="detailsOpen = false">
          <button class="close" type="button" aria-label="Close deployment history" @click="detailsOpen = false">×</button>
          <header class="history-header">
            <p>EMPLOYEE DEPLOYMENT HISTORY</p>
            <h2 id="employee-history-title">{{ formatEmployeeName(selectedEmployee) }}</h2>
            <span class="employee-id">{{ formatEmployeeId(selectedEmployee.EmployeeID) }} · {{ formatEmployeeNumber(selectedEmployee.EmployeeNumber) }}</span>
          </header>
          <div class="history-content">
            <form class="history-filters" @submit.prevent>
              <label class="history-cutoff-filter">Cutoff<select v-model="historyCutoff" :disabled="!employeeHistoryCutoffs.length" aria-describedby="history-filter-help"><option value="">All recorded cutoffs</option><option v-for="cutoff in employeeHistoryCutoffs" :key="cutoff.key" :value="cutoff.key">{{ cutoffLabel(cutoff.start, cutoff.end) }}</option></select></label>
              <label>Assignment<select v-model="historyAssignment" aria-describedby="history-filter-help"><option value="">All assignments</option><option value="Regular">Regular</option><option value="Reliever">Reliever</option></select></label>
              <button class="history-clear" type="button" :disabled="!historyFiltersActive" @click="clearHistoryFilters">Clear filters</button>
              <p id="history-filter-help" class="history-filter-help">Filters both lists by cutoff and assignment.</p>
            </form>
            <section aria-labelledby="fixed-history-title">
              <div class="history-section-heading"><h3 id="fixed-history-title">Fixed deployment history</h3><span>{{ filteredFixedHistory.length }}<template v-if="historyFiltersActive"> of {{ selectedEmployee.history.length }}</template> {{ selectedEmployee.history.length === 1 ? 'record' : 'records' }}</span></div>
              <p v-if="!filteredFixedHistory.length" class="empty-history">{{ selectedEmployee.history.length ? 'No fixed deployments match these filters.' : 'No fixed deployment recorded.' }}</p>
              <div v-else class="history-list-scroll" role="region" aria-label="Fixed deployment history list" tabindex="0">
                <table class="history-list">
                  <thead><tr><th scope="col">Period</th><th scope="col">Client / site</th><th scope="col">Agency / position</th><th scope="col">Assignment / shift</th><th scope="col">Status</th></tr></thead>
                  <tbody><tr v-for="item in filteredFixedHistory" :key="item.DeploymentID">
                    <td class="history-period"><strong>{{ formatDeploymentDate(item.StartDate) }}</strong><span class="history-secondary">to {{ item.EndDate ? formatDeploymentDate(item.EndDate) : 'Ongoing' }}</span></td>
                    <td><strong>{{ display(item.SiteName) }}</strong><span class="history-secondary">{{ display(item.ClientName) }}</span><details v-if="item.Remarks" class="history-row-remarks"><summary>Remarks</summary><p>{{ item.Remarks }}</p></details></td>
                    <td><strong>{{ display(item.PositionName) }}</strong><span class="history-secondary">{{ display(item.AgencyName) }}</span></td>
                    <td><span>{{ display(item.DeploymentType) }} / {{ Number(item.IsPermanentSite)===1?'Fixed':'Cutoff-only' }}</span><span class="history-secondary">{{ shiftDisplay(item) }}</span></td>
                    <td><span class="status">{{ historyStatus(item, selectedEmployee.history) }}</span></td>
                  </tr></tbody>
                </table>
              </div>
            </section>
            <section aria-labelledby="dtr-history-title">
              <div class="history-section-heading"><h3 id="dtr-history-title">DTR attendance history</h3><span>{{ filteredEmployeeDtrHistory.length }}<template v-if="historyFiltersActive"> of {{ selectedEmployeeDtrHistory.length }}</template> {{ selectedEmployeeDtrHistory.length === 1 ? 'record' : 'records' }}</span></div>
              <p v-if="!filteredEmployeeDtrHistory.length" class="empty-history">{{ selectedEmployeeDtrHistory.length ? 'No DTR assignments match these filters.' : 'No DTR attendance assignment yet.' }}</p>
              <div v-else class="history-list-scroll" role="region" aria-label="DTR attendance history list" tabindex="0">
                <table class="history-list">
                  <thead><tr><th scope="col">Cutoff</th><th scope="col">Client / site</th><th scope="col">Agency / position</th><th scope="col">Assignment</th><th scope="col">DTR status</th></tr></thead>
                  <tbody><tr v-for="entry in filteredEmployeeDtrHistory" :key="`${entry.BatchID}-${entry.EmployeeID}`">
                    <td class="history-period"><strong>{{ cutoffLabel(entry.PeriodStart, entry.PeriodEnd) }}</strong></td>
                    <td><strong>{{ display(entry.SiteName) }}</strong><span class="history-secondary">{{ display(entry.ClientName) }}</span></td>
                    <td><strong>{{ display(entry.PositionName) }}</strong><span class="history-secondary">{{ display(entry.AgencyName) }}</span></td>
                    <td><span class="type" :class="`type--${String(entry.AttendanceType).toLowerCase()}`">{{ entry.AttendanceType }}</span><span class="history-secondary">{{ Number(entry.IsPermanentSite)===1?'Fixed':'Cutoff-only' }}</span></td>
                    <td>{{ entry.DtrStatus }}</td>
                  </tr></tbody>
                </table>
              </div>
            </section>
          </div>
          <footer><button type="button" @click="detailsOpen = false">Close</button></footer>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.deployment-form{width:min(100%,920px);font-family:'Plus Jakarta Sans','Inter',system-ui,sans-serif;gap:16px;background:#f8fafc}
.history-tabs{display:inline-flex;gap:5px;margin:0 0 16px;padding:4px;border:1px solid #d8e1ef;border-radius:11px;background:#eef3fa}
.history-tabs button{min-height:36px;border:0;border-radius:8px;padding:7px 14px;background:transparent;color:#59708f;font:inherit;font-size:.82rem;font-weight:800;cursor:pointer}
.history-tabs button.active{background:#fff;color:#2043cc;box-shadow:0 1px 4px rgba(30,55,90,.12)}
.form-intro{padding:0 34px 2px 0}
.form-intro p,.history-header p{margin:0 0 5px;font-size:.72rem;font-weight:800;letter-spacing:.09em;color:#2f67c9}
.form-intro h2{font-size:1.65rem;color:#122a50}
.form-intro small{display:block;margin-top:6px;color:#64748b;line-height:1.5}
.form-section{display:grid;gap:12px;padding:16px;border:1px solid #dce5f2;border-radius:12px;background:#fff}
.section-heading{display:flex;align-items:flex-start;gap:10px}
.section-number{display:grid;place-items:center;flex:0 0 26px;height:26px;border-radius:50%;background:#e8efff;color:#2349e6;font-size:.78rem;font-weight:800}
.section-heading h3{margin:1px 0 2px;color:#172b4d;font-size:.95rem}
.section-heading p{margin:0;color:#6b7a90;font-size:.78rem;line-height:1.45}
.assignment-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.assignment-grid>*{min-width:0}
.optional-label{display:inline;color:#8491a4;font-weight:500;margin-left:4px}
.employee-position{padding:10px 12px;border-radius:8px;background:#f1f5fb;color:#334155;font-size:.85rem;line-height:1.5}
.employee-position small{display:block;color:#64748b;margin-top:3px}
.deployment-warning{padding:12px;border:1px solid #fcd34d;border-radius:8px;background:#fffbeb;color:#92400e;font-size:.85rem;line-height:1.5}
.period-section{background:#f6f9ff;border-color:#cddcf6}
.date-range{display:grid;grid-template-columns:minmax(0,1fr) 34px minmax(0,1fr);align-items:end;gap:10px}
.date-field{display:grid;gap:5px;padding:12px;border:1px solid #ccd8eb;border-radius:10px;background:#fff}
.date-field>small{color:#718096;font-size:.72rem;font-weight:500}
.date-field--disabled{background:#eef2f7;color:#8290a3}
.date-arrow{align-self:center;text-align:center;color:#5271a5;font-size:1.3rem;font-weight:700}
.ongoing-toggle{display:flex!important;align-items:center;gap:10px;width:max-content;max-width:100%;padding:8px 10px;border-radius:8px;cursor:pointer}
.deployment-form .ongoing-toggle input{width:18px;min-height:18px;margin:0;accent-color:#2349e6}
.ongoing-toggle span{display:grid;gap:1px}.ongoing-toggle strong{color:#23395d;font-size:.82rem}.ongoing-toggle small{color:#6b7a90;font-weight:500;font-size:.72rem}
.deployments-page{padding:32px;max-width:1500px;margin:auto;color:#162033;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}.page-head p,.modal>p{margin:0;font-size:.75rem;font-weight:800;letter-spacing:.08em;color:#5271a5}.page-head h1{margin:4px 0;font-size:1.8rem}.page-head small,.view-note{color:#64748b}.primary,.ghost,.details{border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.primary{background:#2349e6;color:#fff}.ghost,.details{background:#eef3ff;color:#2043cc}.filters{display:flex;align-items:end;gap:14px;flex-wrap:wrap;margin:0 0 16px}.filters label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#56657b}.filters input,.filters select{min-height:40px;min-width:180px;border:1px solid #ccd5e4;border-radius:8px;padding:8px 10px;background:#fff;font:inherit}.filters label:first-child input{min-width:300px}.view-note{margin:0 0 12px;font-size:.9rem}.table-wrap{overflow:auto;border:1px solid #dce3ee;border-radius:14px;background:#fff}table{width:100%;border-collapse:collapse}th,td{padding:13px 14px;text-align:left;border-bottom:1px solid #edf1f6;font-size:.88rem;white-space:nowrap}th{background:#f8fafc;color:#526174;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}.employee-id{font-weight:800;color:#1f3fcf}.status,.type{padding:3px 8px;border-radius:999px;font-size:.74rem;font-weight:700;white-space:nowrap}.status{background:#e0e7ff;color:#3730a3}.type--regular{background:#e0e7ff;color:#3730a3}.type--reliever{background:#fef3c7;color:#92400e}.error{color:#b42318;margin:0 0 12px}.backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px}.modal{position:relative;width:min(100%,800px);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;padding:26px;display:grid;gap:12px}.modal h2{margin:0}.modal label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#475569}.modal input,.modal select{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #cfd8e6;border-radius:8px;padding:9px 10px;font:inherit}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.4rem;cursor:pointer}.modal footer{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}.modal footer button:not(.primary){min-height:40px;border:1px solid #cfd8e6;border-radius:8px;padding:0 14px;background:#fff;font-weight:700;cursor:pointer}.roster-modal{width:min(100%,880px)}.roster-summary{display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:#475569;font-weight:700;font-size:.88rem}@media(max-width:760px){.deployments-page{padding:20px}.grid{grid-template-columns:1fr}.page-head,.filters{flex-direction:column;align-items:stretch}.filters input,.filters select,.filters label:first-child input{min-width:0;width:100%}.primary,.ghost{width:100%}}
.site-status{padding:3px 8px;border-radius:999px;font-size:.74rem;font-weight:700;white-space:nowrap}.site-status--permanent{background:#dcfce7;color:#166534}.site-status--cutoff{background:#f1f5f9;color:#475569}
.history-modal{box-sizing:border-box;width:min(1160px,100%);max-height:90dvh;display:flex;flex-direction:column;gap:0;padding:0;overflow:hidden;color:#183352;font-family:'Plus Jakarta Sans','Inter',system-ui,sans-serif}
.history-modal>.close{top:16px;right:18px;z-index:1}
.history-header{flex-shrink:0;padding:22px 58px 18px 24px;border-bottom:1px solid #e1e8f1}
.history-header h2{margin:0 0 5px;color:#122a50;font-size:1.35rem;line-height:1.3;overflow-wrap:anywhere}
.history-header .employee-id{font-size:.85rem}
.history-content{min-height:0;overflow:auto;scrollbar-gutter:stable;padding:20px 24px;display:flex;flex-direction:column;gap:24px}
.history-filters{flex-shrink:0;display:grid;grid-template-columns:minmax(220px,1.8fr) minmax(150px,1fr) auto;align-items:end;gap:10px 12px;margin:0;padding:14px;border:1px solid #dce5f2;border-radius:10px;background:#f8faff}
.history-modal .history-filters label{min-width:0;font-size:.74rem}
.history-modal .history-filters select{min-width:0;font-size:.77rem;background:#fff}
.history-clear{min-height:40px;padding:8px 12px;border:1px solid #cfd8e6;border-radius:8px;background:#fff;color:#31518a;font:inherit;font-size:.74rem;font-weight:700;white-space:nowrap;cursor:pointer}
.history-clear:disabled{opacity:.45;cursor:default}
.history-filter-help{grid-column:1 / -1;margin:0;font-size:.71rem;line-height:1.45;color:#64748b}
@media(max-width:760px){.history-filters{grid-template-columns:minmax(0,1fr);padding:12px}.history-clear{justify-self:end}}
.history-content>section{flex-shrink:0;min-width:0}
.history-section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px}
.history-modal .history-section-heading h3{margin:0;color:#183352;font-size:.95rem}
.history-section-heading>span{flex-shrink:0;color:#718096;font-size:.74rem}
.history-list-scroll{width:100%;overflow:auto;border:1px solid #dce3ee;border-radius:10px}
.history-list-scroll:focus-visible{outline:2px solid #3863d8;outline-offset:3px}
.history-list{table-layout:fixed;width:100%;min-width:820px}
.history-list th:nth-child(1){width:18%}.history-list th:nth-child(2),.history-list th:nth-child(3){width:25%}.history-list th:nth-child(4){width:18%}.history-list th:nth-child(5){width:14%}
.history-modal .history-list th,.history-modal .history-list td{padding:11px 12px;white-space:normal;vertical-align:top;font-size:.78rem;line-height:1.45;overflow-wrap:anywhere}
.history-modal .history-list th{padding-top:10px;padding-bottom:10px;color:#62738b;font-size:.65rem;letter-spacing:.03em}
.history-list td>strong{display:block;color:#1d3557;font-weight:700}
.history-secondary{display:block;margin-top:3px;color:#6b7a90;font-size:.72rem;line-height:1.45}
.history-list tbody tr:last-child td{border-bottom:0}.history-list tbody tr:hover{background:#f8faff}
.history-list .status,.history-list .type{display:inline-block;font-size:.67rem;padding:3px 7px}
.history-row-remarks{margin-top:5px;color:#526174;font-size:.72rem}
.history-row-remarks summary{width:max-content;max-width:100%;color:#315fcc;cursor:pointer}
.history-row-remarks p{margin:6px 0 0;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.history-modal .empty-history{margin:0;padding:16px;border:1px dashed #dce3ee;border-radius:9px;color:#64748b;font-size:.82rem}
.history-modal>footer{flex-shrink:0;margin:0;padding:13px 24px;border-top:1px solid #e1e8f1;background:#fff}
@media(max-width:760px){.history-modal{max-height:92dvh}.history-header{padding:18px 48px 14px 16px}.history-header h2{font-size:1.12rem}.history-header .employee-id{font-size:.75rem}.history-content{padding:16px;gap:20px}.history-modal>footer{padding:12px 16px}}
.records-wrap{overflow:hidden}.responsive-table{table-layout:fixed}.responsive-table th,.responsive-table td{white-space:normal;vertical-align:middle;line-height:1.35}.deployment-records-table th:nth-child(1){width:21%}.deployment-records-table th:nth-child(2){width:20%}.deployment-records-table th:nth-child(3){width:20%}.deployment-records-table th:nth-child(4){width:19%}.deployment-records-table th:nth-child(5){width:8%}.deployment-records-table th:nth-child(6){width:12%}.cutoff-rosters-table th:nth-child(1){width:22%}.cutoff-rosters-table th:nth-child(2){width:21%}.cutoff-rosters-table th:nth-child(3){width:18%}.cutoff-rosters-table th:nth-child(4){width:19%}.cutoff-rosters-table th:nth-child(5){width:8%}.cutoff-rosters-table th:nth-child(6){width:12%}.record-name,.record-client{display:block;color:#172b4d;font-size:.88rem}.record-meta{display:flex;align-items:center;gap:5px;margin-top:4px;color:#6b7a90;font-size:.72rem}.record-meta b{color:#2349e6}.period-cell{color:#334155}.action-cell{text-align:right}.action-cell .details{white-space:nowrap;padding:9px 12px}.roster-count{display:block;font-size:.78rem;font-weight:700;color:#334155}.roster-breakdown{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.roster-breakdown .type{font-size:.67rem;padding:2px 6px}
@media(max-width:900px){.records-wrap{overflow:visible;border:0;background:transparent}.responsive-table,.responsive-table tbody{display:block;width:100%}.responsive-table thead{display:none}.responsive-table tbody{display:grid;gap:10px}.responsive-table tr:not(.message-row){display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 14px;padding:14px;border:1px solid #dce3ee;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(28,48,80,.04)}.responsive-table td{display:block;padding:0;border:0;min-width:0}.responsive-table td::before{content:attr(data-label);display:block;margin-bottom:3px;color:#7b8799;font-size:.64rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.responsive-table td:first-child{grid-column:1 / -1;padding-bottom:10px;border-bottom:1px solid #edf1f6}.responsive-table .period-cell{grid-column:1 / -1}.responsive-table .action-cell{grid-column:1 / -1;text-align:stretch}.responsive-table .action-cell::before{display:none}.responsive-table .action-cell .details{width:100%;min-height:40px}.responsive-table .message-row{display:block;padding:16px;border:1px solid #dce3ee;border-radius:12px;background:#fff}.responsive-table .message-row td{display:block}.responsive-table .message-row td::before{display:none}.record-name,.record-client{font-size:.84rem}.record-meta{font-size:.7rem}.cutoff-rosters-table td:nth-child(2),.deployment-records-table td:nth-child(2){grid-column:1 / -1}.roster-breakdown{margin-top:5px}}
@media(max-width:760px){.deployment-form{padding:20px}.history-tabs{display:grid;grid-template-columns:1fr 1fr;width:100%;box-sizing:border-box}.assignment-grid,.date-range{grid-template-columns:1fr}.date-arrow{transform:rotate(90deg)}.ongoing-toggle{width:auto}}
</style>
