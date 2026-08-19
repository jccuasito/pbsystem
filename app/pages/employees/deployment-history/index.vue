<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import { formatEmployeeId, formatEmployeeLabel, formatEmployeeName, formatEmployeeNumber } from '~/utils/employee'

const items = ref<any[]>([])
const agencies = ref<any[]>([])
const employees = ref<any[]>([])
const clientRates = ref<any[]>([])
const sites = ref<any[]>([])
const shiftCodes = ref<any[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const modalOpen = ref(false)
const detailsOpen = ref(false)
const selectedEmployee = ref<any | null>(null)
const employeeSearch = ref('')
const agencyFilter = ref('')
const form = ref({ EmployeeID: '', ClientRateID: '', SiteID: '', SiteShiftID: '', DeploymentType: 'Regular', StartDate: '', EndDate: '', Remarks: '' })

const employeeGroups = computed(() => {
  const groups = new Map<string, any>()
  for (const item of items.value) {
    const key = String(item.EmployeeID)
    if (!groups.has(key)) groups.set(key, { ...item, history: [] })
    groups.get(key).history.push(item)
  }

  return Array.from(groups.values()).map((group) => {
    group.history.sort((left: any, right: any) => String(right.StartDate).localeCompare(String(left.StartDate)) || Number(right.DeploymentID) - Number(left.DeploymentID))
    group.current = group.history.find((item: any) => item.Status === 'Active') || group.history[0]
    return group
  })
})

const filteredEmployees = computed(() => {
  const query = employeeSearch.value.trim().toLowerCase()
  return employeeGroups.value.filter((group) => {
    const matchesSearch = !query || [group.EmployeeName, group.EmployeeNumber, formatEmployeeId(group.EmployeeID)]
      .some((value) => String(value || '').toLowerCase().includes(query))
    const matchesAgency = !agencyFilter.value || String(group.current.AgencyID) === agencyFilter.value
    return matchesSearch && matchesAgency
  })
})

watch(agencies, (currentAgencies) => {
  if (agencyFilter.value && !currentAgencies.some((agency) => String(agency.AgencyID) === agencyFilter.value)) agencyFilter.value = ''
})

const selectedFormEmployee = computed(() => employees.value.find((employee) => String(employee.EmployeeID) === String(form.value.EmployeeID)) || null)

const availableClientRates = computed(() => {
  if (!selectedFormEmployee.value) return []
  return clientRates.value.filter((rate) => String(rate.AgencyID) === String(selectedFormEmployee.value.AgencyID))
})

const selectedClientRate = computed(() => availableClientRates.value.find((rate) => String(rate.ClientRateID) === String(form.value.ClientRateID)) || null)

const availableSites = computed(() => {
  if (!selectedClientRate.value) return []
  return sites.value.filter((site) => String(site.ClientID) === String(selectedClientRate.value.ClientID))
})

const availableShifts = computed(() => {
  if (!form.value.SiteID) return []
  return shiftCodes.value.filter((shift) => String(shift.SiteID) === String(form.value.SiteID))
})

function reset() {
  form.value = { EmployeeID: '', ClientRateID: '', SiteID: '', SiteShiftID: '', DeploymentType: 'Regular', StartDate: '', EndDate: '', Remarks: '' }
  error.value = ''
}

function onSiteChanged() {
  form.value.SiteShiftID = ''
}

function onEmployeeChanged() {
  form.value.ClientRateID = ''
  form.value.SiteID = ''
  form.value.SiteShiftID = ''
}

function onClientRateChanged() {
  form.value.SiteID = ''
  form.value.SiteShiftID = ''
}

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    const response: any = await $fetch('/api/employees/deployments')
    items.value = response.items || []
    agencies.value = response.agencies || []
    employees.value = response.employees || []
    clientRates.value = response.clientRates || []
    sites.value = response.sites || []
    shiftCodes.value = response.shiftCodes || []
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to load deployment history.'
  } finally {
    if (!silent) loading.value = false
  }
}

async function save() {
  busy.value = true
  error.value = ''
  try {
    await $fetch('/api/employees/deployments', { method: 'POST', body: form.value })
    modalOpen.value = false
    reset()
    await load()
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to save deployment.'
  } finally {
    busy.value = false
  }
}

function display(value: any) {
  return value === null || value === undefined || value === '' ? '\u2014' : value
}

function historyStatus(item: any, history: any[]) {
  if (item.Status === 'Active') return 'Active'
  const newer = history.find((candidate: any) => String(candidate.StartDate) > String(item.StartDate))
  return newer && (newer.AgencyID !== item.AgencyID || newer.ClientRateID !== item.ClientRateID) ? 'Transferred' : 'Ended'
}

function openDetails(group: any) {
  selectedEmployee.value = group
  detailsOpen.value = true
}

onMounted(load)
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !busy.value })
</script>

<template>
  <main class="deployments-page">
    <header class="page-head">
      <div>
        <p>EMPLOYEE MANAGEMENT</p>
        <h1>Deployment History</h1>
      </div>
      <button class="primary" @click="reset(); modalOpen = true">+ New deployment</button>
    </header>

    <form class="filters" @submit.prevent>
      <label>
        <span>Employee</span>
        <input v-model="employeeSearch" placeholder="Search employee ID, number, or name" />
      </label>
      <label>
        <span>Agency</span>
        <select v-model="agencyFilter">
          <option value="">All agencies</option>
          <option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option>
        </select>
      </label>
      <button class="ghost" type="submit">Search</button>
    </form>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee ID</th>
            <th>Employee No.</th>
            <th>Employee Name</th>
            <th>Agency</th>
            <th>Position</th>
            <th>Client</th>
            <th>Site</th>
            <th>Type</th>
            <th>Status</th>
            <th>History</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="10">Loading...</td></tr>
          <tr v-else-if="!filteredEmployees.length"><td colspan="10">No employees found.</td></tr>
          <tr v-for="group in filteredEmployees" :key="group.EmployeeID">
            <td class="employee-id">{{ formatEmployeeId(group.EmployeeID) }}</td>
            <td>{{ formatEmployeeNumber(group.EmployeeNumber) }}</td>
            <td>{{ formatEmployeeName(group) }}</td>
            <td>{{ display(group.current.AgencyName) }}</td>
            <td>{{ display(group.current.PositionName) }}</td>
            <td>{{ display(group.current.ClientName) }}</td>
            <td>{{ display(group.current.SiteName) }}</td>
            <td><span class="type" :class="`type--${String(group.current.DeploymentType || '').toLowerCase()}`">{{ display(group.current.DeploymentType) }}</span></td>
            <td><span class="status" :class="`status--${String(group.current.Status || '').toLowerCase()}`">{{ group.current.Status }}</span></td>
            <td><button class="details" type="button" @click="openDetails(group)">Details ({{ group.history.length }})</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="modalOpen" class="backdrop" @click.self="!busy && (modalOpen = false)">
        <form class="modal" @submit.prevent="save">
          <button class="close" type="button" aria-label="Close" @click="modalOpen = false">x</button>
          <h2>New deployment</h2>

          <label>Employee
            <select v-model.number="form.EmployeeID" required @change="onEmployeeChanged">
              <option value="">Select employee</option>
              <option v-for="employee in employees" :key="employee.EmployeeID" :value="Number(employee.EmployeeID)">{{ formatEmployeeLabel(employee) }}</option>
            </select>
          </label>

          <label>Client rate
            <select v-model="form.ClientRateID" required :disabled="!selectedFormEmployee" @change="onClientRateChanged">
              <option value="">{{ selectedFormEmployee ? 'Select client rate' : 'Select an employee first' }}</option>
              <option v-for="rate in availableClientRates" :key="rate.ClientRateID" :value="rate.ClientRateID">{{ rate.ClientName }} - {{ rate.AgencyName }} - {{ rate.PositionName }}</option>
            </select>
          </label>

          <div class="grid">
            <label>Site
              <select v-model="form.SiteID" required :disabled="!selectedClientRate" @change="onSiteChanged">
                <option value="">{{ selectedClientRate ? 'Select site' : 'Select a client rate first' }}</option>
                <option v-for="site in availableSites" :key="site.SiteID" :value="site.SiteID">{{ site.ClientName }} - {{ site.SiteName }}</option>
              </select>
            </label>
            <label>Shift
              <select v-model="form.SiteShiftID" required :disabled="!form.SiteID">
                <option value="">{{ form.SiteID ? 'Select shift' : 'Select a site first' }}</option>
                <option v-for="shift in availableShifts" :key="shift.SiteShiftID" :value="shift.SiteShiftID">{{ shift.ShiftCode }} - {{ shift.ShiftName }}</option>
              </select>
            </label>
          </div>

          <div class="grid">
            <label>Deployment type
              <select v-model="form.DeploymentType" required>
                <option value="Regular">Regular</option>
                <option value="Reliever">Reliever</option>
              </select>
            </label>
            <label>Start date<input v-model="form.StartDate" type="date" required /></label>
          </div>

          <div class="grid">
            <label>End date<input v-model="form.EndDate" type="date" /></label>
            <label>Remarks<input v-model="form.Remarks" /></label>
          </div>

          <p v-if="error" class="error">{{ error }}</p>
          <footer>
            <button type="button" @click="modalOpen = false">Cancel</button>
            <button class="primary" :disabled="busy">{{ busy ? 'Saving...' : 'Save' }}</button>
          </footer>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="detailsOpen && selectedEmployee" class="backdrop" @click.self="detailsOpen = false">
        <section class="modal history-modal" aria-label="Employee deployment history">
          <button class="close" type="button" aria-label="Close" @click="detailsOpen = false">x</button>
          <p>DEPLOYMENT HISTORY</p>
          <h2>{{ formatEmployeeName(selectedEmployee) }}</h2>
          <span class="employee-id">{{ formatEmployeeId(selectedEmployee.EmployeeID) }} · {{ formatEmployeeNumber(selectedEmployee.EmployeeNumber) }}</span>
          <div class="timeline">
            <article v-for="item in selectedEmployee.history" :key="item.DeploymentID" class="timeline-item">
              <div class="timeline-head">
                <strong>{{ display(item.ClientName) }} · {{ display(item.SiteName) }}</strong>
                <span class="status" :class="`status--${historyStatus(item, selectedEmployee.history).toLowerCase()}`">{{ historyStatus(item, selectedEmployee.history) }}</span>
              </div>
              <p>{{ display(item.AgencyName) }} · {{ display(item.PositionName) }}</p>
              <p>Deployment type: <span class="type" :class="`type--${String(item.DeploymentType || '').toLowerCase()}`">{{ display(item.DeploymentType) }}</span></p>
              <p>Shift: {{ display(item.ShiftCode) }}<template v-if="item.ShiftName"> - {{ item.ShiftName }}</template></p>
              <p>{{ display(item.StartDate) }} to {{ display(item.EndDate) }}</p>
              <p v-if="item.Remarks">Remarks: {{ item.Remarks }}</p>
            </article>
          </div>
          <footer><button type="button" @click="detailsOpen = false">Close</button></footer>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.deployments-page{padding:32px;max-width:1500px;margin:auto;color:#162033;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}.page-head p,.history-modal>p{margin:0;font-size:.75rem;font-weight:800;letter-spacing:.08em;color:#5271a5}.page-head h1{margin:4px 0 0;font-size:1.8rem}.primary,.ghost,.details{border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.primary{background:#2349e6;color:#fff}.ghost,.details{background:#eef3ff;color:#2043cc}.filters{display:flex;align-items:end;gap:14px;flex-wrap:wrap;margin:0 0 16px}.filters label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#56657b}.filters input,.filters select{min-height:40px;min-width:240px;border:1px solid #ccd5e4;border-radius:8px;padding:8px 10px;background:#fff;font:inherit}.table-wrap{overflow:auto;border:1px solid #dce3ee;border-radius:14px;background:#fff}table{width:100%;border-collapse:collapse}th,td{padding:13px 14px;text-align:left;border-bottom:1px solid #edf1f6;font-size:.88rem;white-space:nowrap}th{background:#f8fafc;color:#526174;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}.employee-id{font-weight:800;color:#1f3fcf}.status,.type{padding:3px 8px;border-radius:999px;font-size:.74rem;font-weight:700}.status--active{background:#dcfce7;color:#166534}.status--ended{background:#fee2e2;color:#991b1b}.status--transferred{background:#dbeafe;color:#1d4ed8}.type--regular{background:#e0e7ff;color:#3730a3}.type--reliever{background:#fef3c7;color:#92400e}.error{color:#b42318;margin:0 0 12px}.backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px}.modal{position:relative;width:min(100%,800px);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;padding:26px;display:grid;gap:12px}.modal h2{margin:0}.modal label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#475569}.modal input,.modal select{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #cfd8e6;border-radius:8px;padding:9px 10px;font:inherit}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.1rem;cursor:pointer}.modal footer{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}.modal footer button:not(.primary){min-height:40px;border:1px solid #cfd8e6;border-radius:8px;padding:0 14px;background:#fff;font-weight:700;cursor:pointer}.timeline{display:grid;gap:10px;margin-top:8px}.timeline-item{border:1px solid #dce3ee;border-left:4px solid #5b7df0;border-radius:10px;padding:12px}.timeline-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.timeline-item p{margin:5px 0 0;color:#526174;font-size:.88rem}.history-modal{width:min(100%,680px)}@media(max-width:760px){.deployments-page{padding:20px}.grid{grid-template-columns:1fr}.page-head,.filters{flex-direction:column;align-items:stretch}.filters input,.filters select{min-width:0;width:100%}.primary,.ghost{width:100%}}
</style>
