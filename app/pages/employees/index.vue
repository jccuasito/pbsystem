<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import { formatEmployeeId, formatEmployeeName, formatEmployeeNumber } from '~/utils/employee'

const emit = defineEmits<{ (event: 'navigate', view: 'employees-documents'): void }>()

const items = ref<any[]>([])
const agencies = ref<any[]>([])
const positions = ref<any[]>([])
const agencyPositions = ref<any[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const formError = ref('')
const modalOpen = ref(false)
const transferOpen = ref(false)
const editing = ref<any>(null)
const transferring = ref<any>(null)
const transferBusy = ref(false)
const transferError = ref('')
const transferClientRates = ref<any[]>([])
const transferSites = ref<any[]>([])
const transferShiftCodes = ref<any[]>([])
const siteShiftCodes = ref<any[]>([])
const rateSearch = ref('')
const ratePickerOpen = ref(false)
const shiftSetupOpen = ref(false)
const shiftSetupBusy = ref(false)
const shiftSetupError = ref('')
const createNewShiftCode = ref(false)
const filters = ref({ agencyId: '', positionId: '' })
const search = ref('')

const form = ref({
  AgencyPositionID: '',
  EmployeeNumber: '',
  FirstName: '',
  MiddleName: '',
  LastName: '',
  Nickname: '',
  Birthday: '',
  Gender: '',
  CivilStatus: '',
  Address: '',
  Email: '',
  ContactNumber: '',
  DateHired: '',
  Status: 'Active'
})
const transferForm = ref({ ClientRateID: '', SiteID: '', SiteShiftID: '', StartDate: '', Remarks: '' })
const siteShiftForm = ref({ ShiftCodeID: '', ShiftCode: '', ShiftName: '', ShiftType: 'Day', TimeIn: '08:00', TimeOut: '17:00', RegularHours: '8', RegularOTCap: '4' })

function reset(item: any = null) {
  editing.value = item
  form.value = {
    AgencyPositionID: item?.AgencyPositionID ?? '',
    EmployeeNumber: item?.EmployeeNumber ?? '',
    FirstName: item?.FirstName ?? '',
    MiddleName: item?.MiddleName ?? '',
    LastName: item?.LastName ?? '',
    Nickname: item?.Nickname ?? '',
    Birthday: item?.Birthday?.slice?.(0, 10) ?? item?.Birthday ?? '',
    Gender: item?.Gender ?? '',
    CivilStatus: item?.CivilStatus ?? '',
    Address: item?.Address ?? '',
    Email: item?.Email ?? '',
    ContactNumber: item?.ContactNumber ?? '',
    DateHired: item?.DateHired?.slice?.(0, 10) ?? item?.DateHired ?? '',
    Status: item?.Status ?? 'Active'
  }
  error.value = ''
  formError.value = ''
}

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    const response: any = await $fetch('/api/employees', { query: { agencyId: filters.value.agencyId || undefined, positionId: filters.value.positionId || undefined } })
    items.value = response.items || []
    agencies.value = response.agencies || []
    positions.value = response.positions || []
    agencyPositions.value = response.agencyPositions || []
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to load employees.'
  } finally {
    if (!silent) loading.value = false
  }
}

async function save() {
  busy.value = true
  formError.value = ''
  try {
    await $fetch(editing.value ? `/api/employees/${editing.value.EmployeeID}` : '/api/employees', {
      method: editing.value ? 'PUT' : 'POST',
      body: editing.value ? { id: editing.value.EmployeeID, ...form.value } : form.value
    })
    modalOpen.value = false
    reset()
    await load()
  } catch (cause: any) {
    formError.value = cause.data?.statusMessage || cause.data?.message || 'Unable to save employee.'
  } finally {
    busy.value = false
  }
}

async function deactivate(item: any) {
  if (!confirm('Mark this employee as inactive?')) return
  try {
    await $fetch(`/api/employees/${item.EmployeeID}`, { method: 'DELETE', body: { id: item.EmployeeID } })
    await load()
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to deactivate employee.'
  }
}

function format(value: any) {
  return value === null || value === undefined || value === '' ? '\u2014' : value
}

const availableTransferSites = computed(() => {
  const rate = transferClientRates.value.find((item) => String(item.ClientRateID) === String(transferForm.value.ClientRateID))
  return rate ? transferSites.value.filter((item) => String(item.ClientID) === String(rate.ClientID)) : []
})

const availableTransferShifts = computed(() => transferShiftCodes.value.filter((item) => String(item.SiteID) === String(transferForm.value.SiteID)))
const selectedTransferRate = computed(() => transferClientRates.value.find((item) => String(item.ClientRateID) === String(transferForm.value.ClientRateID)) || null)
const filteredTransferClientRates = computed(() => {
  const query = rateSearch.value.trim().toLowerCase()
  const results = transferClientRates.value.filter((item) => {
    const matchesSearch = !query || [item.ClientName, item.AgencyName, item.PositionName].some((value) => String(value || '').toLowerCase().includes(query))
    return matchesSearch
  })
  return results.slice(0, 8)
})
const availableSiteShiftCodes = computed(() => {
  const agencyId = selectedTransferRate.value?.AgencyID
  return siteShiftCodes.value.filter((item) => String(item.AgencyID) === String(agencyId))
})

const availablePositions = computed(() => {
  const agencyId = String(filters.value.agencyId)
  const source = agencyId ? agencyPositions.value.filter((item) => String(item.AgencyID) === agencyId) : agencyPositions.value
  const seen = new Set<string>()
  return source.filter((item) => {
    const id = String(item.PositionID)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
})

const filteredItems = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return items.value
  return items.value.filter((item) => [formatEmployeeId(item.EmployeeID), item.EmployeeNumber, formatEmployeeName(item), item.AgencyName, item.PositionName, item.SiteName]
    .some((value) => String(value || '').toLowerCase().includes(query)))
})

watch(() => filters.value.agencyId, () => {
  filters.value.positionId = ''
  void load()
})

function today() {
  const date = new Date()
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function onTransferClientRateChanged() {
  transferForm.value.SiteID = ''
  transferForm.value.SiteShiftID = ''
}

function clientRateLabel(rate: any) {
  return `${rate.ClientName} — ${rate.AgencyName} — ${rate.PositionName}`
}

function selectTransferClientRate(rate: any) {
  transferForm.value.ClientRateID = String(rate.ClientRateID)
  rateSearch.value = clientRateLabel(rate)
  ratePickerOpen.value = false
  onTransferClientRateChanged()
}

function onRateSearchInput() {
  ratePickerOpen.value = true
  transferForm.value.ClientRateID = ''
  onTransferClientRateChanged()
}

function searchTransferRates() {
  ratePickerOpen.value = true
}

function closeRatePicker() {
  ratePickerOpen.value = false
}

function onTransferSiteChanged() {
  transferForm.value.SiteShiftID = ''
}

async function openTransfer(item: any) {
  transferError.value = ''
  transferring.value = item
  transferForm.value = { ClientRateID: '', SiteID: '', SiteShiftID: '', StartDate: today(), Remarks: '' }
  rateSearch.value = ''
  try {
    const response: any = await $fetch('/api/employees/deployments')
    transferClientRates.value = response.clientRates || []
    transferSites.value = response.sites || []
    transferShiftCodes.value = response.shiftCodes || []
    transferOpen.value = true
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to load transfer options.'
  }
}

async function openShiftSetup() {
  if (!transferForm.value.ClientRateID || !transferForm.value.SiteID) return
  shiftSetupBusy.value = true
  shiftSetupError.value = ''
  try {
    const response: any = await $fetch('/api/organization/site-shift')
    siteShiftCodes.value = response.shiftCodes || []
    createNewShiftCode.value = !availableSiteShiftCodes.value.length
    siteShiftForm.value = { ShiftCodeID: '', ShiftCode: '', ShiftName: '', ShiftType: 'Day', TimeIn: '08:00', TimeOut: '17:00', RegularHours: '8', RegularOTCap: '4' }
    shiftSetupOpen.value = true
  } catch (cause: any) {
    transferError.value = cause.data?.statusMessage || 'Unable to load shift setup options.'
  } finally {
    shiftSetupBusy.value = false
  }
}

async function saveSiteShift() {
  shiftSetupBusy.value = true
  shiftSetupError.value = ''
  try {
    const body: any = { ClientRateID: transferForm.value.ClientRateID, SiteID: transferForm.value.SiteID }
    if (createNewShiftCode.value) body.newShift = { ...siteShiftForm.value }
    else body.ShiftCodeID = siteShiftForm.value.ShiftCodeID
    const response: any = await $fetch('/api/employees/site-shifts', { method: 'POST', body })
    const deployments: any = await $fetch('/api/employees/deployments')
    transferShiftCodes.value = deployments.shiftCodes || []
    transferForm.value.SiteShiftID = String(response.id)
    shiftSetupOpen.value = false
  } catch (cause: any) {
    shiftSetupError.value = cause.data?.statusMessage || cause.data?.message || 'Unable to set up this site shift.'
  } finally {
    shiftSetupBusy.value = false
  }
}

async function saveTransfer() {
  if (!transferring.value) return
  transferBusy.value = true
  transferError.value = ''
  try {
    await $fetch(`/api/employees/${transferring.value.EmployeeID}/transfer`, { method: 'POST', body: transferForm.value })
    transferOpen.value = false
    transferring.value = null
    await load()
  } catch (cause: any) {
    transferError.value = cause.data?.statusMessage || cause.data?.message || 'Unable to transfer employee.'
  } finally {
    transferBusy.value = false
  }
}

onMounted(load)
onMounted(() => document.addEventListener('click', closeRatePicker))
onBeforeUnmount(() => document.removeEventListener('click', closeRatePicker))
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !busy.value })
</script>

<template>
  <main class="employees-page">
    <header class="page-head">
      <div>
        <p>EMPLOYEE MANAGEMENT</p>
        <h1>Employee List</h1>
      </div>
      <div class="actions-row">
        <button class="ghost" type="button" @click="emit('navigate', 'employees-documents')">Employee Documents</button>
        <button class="primary" @click="reset(); modalOpen = true">+ Add employee</button>
      </div>
    </header>

    <section class="filters">
      <label class="search-field">
        <span>Search employee</span>
        <input v-model.trim="search" placeholder="Search employee ID, name, agency, position, or site" />
      </label>
      <label>
        <span>Agency</span>
        <select v-model="filters.agencyId">
          <option value="">All Agencies</option>
          <option v-for="agency in agencies" :key="agency.AgencyID" :value="agency.AgencyID">{{ agency.AgencyName }}</option>
        </select>
      </label>
      <label>
        <span>Position</span>
        <select v-model="filters.positionId" @change="load">
          <option value="">All Positions</option>
          <option v-for="position in availablePositions" :key="position.PositionID" :value="position.PositionID">{{ position.PositionName }}</option>
        </select>
      </label>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee ID</th>
            <th>Employee No.</th>
            <th>Name</th>
            <th>Agency</th>
            <th>Position</th>
            <th>Current Site</th>
            <th>Deployment Status</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="9">Loading...</td></tr>
          <tr v-else-if="!filteredItems.length"><td colspan="9">No employees found.</td></tr>
          <tr v-for="item in filteredItems" :key="item.EmployeeID">
            <td class="employee-id">{{ formatEmployeeId(item.EmployeeID) }}</td>
            <td>{{ formatEmployeeNumber(item.EmployeeNumber) }}</td>
            <td>{{ formatEmployeeName(item) }}</td>
            <td>{{ format(item.AgencyName) }}</td>
            <td>{{ format(item.PositionName) }}</td>
            <td>{{ format(item.SiteName) }}</td>
            <td><span class="status" :class="`status--${String(item.DeploymentStatus || 'unassigned').toLowerCase()}`">{{ item.DeploymentStatus }}</span></td>
            <td><span class="status" :class="`status--${String(item.Status || '').toLowerCase()}`">{{ item.Status }}</span></td>
            <td class="row-actions"><button @click="reset(item); modalOpen = true">Edit</button><button :disabled="item.Status === 'Inactive'" @click="openTransfer(item)">Transfer</button><button :disabled="item.Status === 'Inactive'" @click="deactivate(item)">Deactivate</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="modalOpen" class="backdrop" @click.self="!busy && (modalOpen = false)">
        <form class="modal" @submit.prevent="save">
          <button class="close" type="button" @click="modalOpen = false">x</button>
          <h2>{{ editing ? 'Edit employee' : 'Add employee' }}</h2>

          <label>Employee number <small>Optional badge/reference</small><input v-model="form.EmployeeNumber" placeholder="Assign later if unavailable" /></label>
          <label>Agency position<select v-model="form.AgencyPositionID" required><option value="">Select agency position</option><option v-for="item in agencyPositions" :key="item.AgencyPositionID" :value="item.AgencyPositionID">{{ item.AgencyName }} - {{ item.PositionName }}</option></select></label>
          <div class="grid">
            <label>First name<input v-model="form.FirstName" required /></label>
            <label>Middle name<input v-model="form.MiddleName" /></label>
          </div>
          <div class="grid">
            <label>Last name<input v-model="form.LastName" required /></label>
            <label>Nickname<input v-model="form.Nickname" /></label>
          </div>
          <div class="grid">
            <label>Birthday<input v-model="form.Birthday" type="date" /></label>
            <label>Date hired<input v-model="form.DateHired" type="date" /></label>
          </div>
          <div class="grid">
            <label>Gender<input v-model="form.Gender" /></label>
            <label>Civil status<input v-model="form.CivilStatus" /></label>
          </div>
          <label>Address<textarea v-model="form.Address" rows="3" /></label>
          <div class="grid">
            <label>Email<input v-model="form.Email" type="email" /></label>
            <label>Contact number<input v-model="form.ContactNumber" /></label>
          </div>
          <label>Status<select v-model="form.Status"><option>Active</option><option>Inactive</option></select></label>

          <p v-if="formError" class="error">{{ formError }}</p>
          <footer><button type="button" @click="modalOpen = false">Cancel</button><button class="primary" :disabled="busy">{{ busy ? 'Saving...' : 'Save' }}</button></footer>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="transferOpen" class="backdrop" @click.self="!transferBusy && (transferOpen = false)">
        <form class="modal" @submit.prevent="saveTransfer">
          <button class="close" type="button" @click="transferOpen = false">x</button>
          <h2>Transfer employee</h2>
          <p class="transfer-subtitle">{{ transferring ? formatEmployeeName(transferring) : '' }}</p>
          <p class="transfer-note">The current deployment closes the day before the effective date. Previous attendance and payroll remain under that deployment.</p>

          <label class="rate-picker" @click.stop>Find new assignment
            <input v-model="rateSearch" type="search" autocomplete="off" placeholder="Search client, agency, or position" @focus="ratePickerOpen = true" @input="onRateSearchInput" />
            <button type="button" class="rate-search-button" @click="searchTransferRates">Search</button>
            <div v-if="ratePickerOpen" class="rate-picker__results">
              <button v-for="rate in filteredTransferClientRates" :key="rate.ClientRateID" type="button" @click="selectTransferClientRate(rate)">
                <strong>{{ rate.ClientName }}</strong><span>{{ rate.AgencyName }} — {{ rate.PositionName }}</span>
              </button>
              <p v-if="!filteredTransferClientRates.length">No matching client rate.</p>
            </div>
            <small v-if="selectedTransferRate">Selected: {{ clientRateLabel(selectedTransferRate) }}</small>
          </label>
          <div class="grid">
            <label>New site
              <select v-model="transferForm.SiteID" required :disabled="!transferForm.ClientRateID" @change="onTransferSiteChanged">
                <option value="">Select site</option>
                <option v-for="site in availableTransferSites" :key="site.SiteID" :value="site.SiteID">{{ site.SiteName }}</option>
              </select>
            </label>
            <label>New shift <small>Optional</small>
              <select v-model="transferForm.SiteShiftID" :disabled="!transferForm.SiteID">
                <option value="">No shift for now</option>
                <option v-for="shift in availableTransferShifts" :key="shift.SiteShiftID" :value="shift.SiteShiftID">{{ shift.ShiftCode }} — {{ shift.ShiftName }}</option>
              </select>
            </label>
          </div>
          <div v-if="transferForm.SiteID && !availableTransferShifts.length" class="shift-missing">
            <strong>No active shift is linked to this site.</strong>
            <span>You can continue without one; attendance hours will need manual review until a shift is set up.</span>
            <button type="button" @click="openShiftSetup">+ Set up shift for this site</button>
          </div>
          <label>Effective date<input v-model="transferForm.StartDate" type="date" :max="today()" required /></label>
          <label>Transfer remarks<textarea v-model="transferForm.Remarks" rows="3" placeholder="Reason or notes for this transfer" /></label>
          <p v-if="transferError" class="error">{{ transferError }}</p>
          <footer><button type="button" @click="transferOpen = false">Cancel</button><button class="primary" :disabled="transferBusy">{{ transferBusy ? 'Transferring...' : 'Save transfer' }}</button></footer>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="shiftSetupOpen" class="backdrop" @click.self="!shiftSetupBusy && (shiftSetupOpen = false)">
        <form class="modal shift-setup-modal" @submit.prevent="saveSiteShift">
          <button class="close" type="button" @click="shiftSetupOpen = false">x</button>
          <h2>Set up shift for site</h2>
          <p class="transfer-note">The shift will be available immediately for this transfer and future employees assigned to this site.</p>
          <div v-if="availableSiteShiftCodes.length" class="shift-choice">
            <button type="button" :class="{ active: !createNewShiftCode }" @click="createNewShiftCode = false">Use existing shift code</button>
            <button type="button" :class="{ active: createNewShiftCode }" @click="createNewShiftCode = true">Create new shift code</button>
          </div>
          <label v-if="!createNewShiftCode">Existing shift code
            <select v-model="siteShiftForm.ShiftCodeID" required>
              <option value="">Select shift code</option>
              <option v-for="shift in availableSiteShiftCodes" :key="shift.ShiftCodeID" :value="shift.ShiftCodeID">{{ shift.ShiftCode }} — {{ shift.ShiftName }}</option>
            </select>
          </label>
          <template v-else>
            <div class="grid"><label>Shift code<input v-model.trim="siteShiftForm.ShiftCode" placeholder="e.g. DAY-08" required /></label><label>Shift name<input v-model.trim="siteShiftForm.ShiftName" placeholder="e.g. Day shift" required /></label></div>
            <div class="grid"><label>Shift type<select v-model="siteShiftForm.ShiftType"><option>Day</option><option>Night</option><option>Split</option><option>Flexible</option></select></label><label>Regular hours<input v-model="siteShiftForm.RegularHours" type="number" min="0" max="24" step=".25" required /></label></div>
            <div class="grid"><label>Time in<input v-model="siteShiftForm.TimeIn" type="time" required /></label><label>Time out<input v-model="siteShiftForm.TimeOut" type="time" required /></label></div>
            <label>Regular OT cap<input v-model="siteShiftForm.RegularOTCap" type="number" min="0" max="24" step=".25" required /></label>
          </template>
          <p v-if="shiftSetupError" class="error">{{ shiftSetupError }}</p>
          <footer><button type="button" @click="shiftSetupOpen = false">Cancel</button><button class="primary" :disabled="shiftSetupBusy">{{ shiftSetupBusy ? 'Saving...' : 'Save site shift' }}</button></footer>
        </form>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.employees-page{padding:32px;max-width:1400px;margin:auto;color:#162033;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}.page-head p{margin:0;font-size:.75rem;font-weight:800;letter-spacing:.08em;color:#5271a5}.page-head h1{margin:4px 0 0;font-size:1.8rem}.actions-row{display:flex;gap:10px;flex-wrap:wrap}.primary,.ghost{border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.primary{background:#2349e6;color:#fff}.ghost{background:#eef3ff;color:#2043cc}.filters{display:grid;grid-template-columns:minmax(280px,1fr) minmax(180px,220px) minmax(180px,220px);gap:14px;margin:0 0 16px}.filters label{display:grid;min-width:0;gap:6px;font-size:.8rem;font-weight:700;color:#56657b}.filters input,.filters select{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #ccd5e4;border-radius:8px;padding:8px 10px;background:#fff;font:inherit}.table-wrap{overflow:auto;border:1px solid #dce3ee;border-radius:14px;background:#fff}table{width:100%;border-collapse:collapse}th,td{padding:13px 14px;text-align:left;border-bottom:1px solid #edf1f6;font-size:.88rem;white-space:nowrap}th{background:#f8fafc;color:#526174;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}.row-actions{display:flex;gap:8px}.row-actions button{border:1px solid #cfd8e6;border-radius:7px;background:#fff;padding:7px 9px;color:#24415f;font-weight:700;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.status{padding:3px 8px;border-radius:999px;font-size:.74rem;font-weight:700}.status--active,.status--unassigned{background:#dcfce7;color:#166534}.status--inactive,.status--ended{background:#fee2e2;color:#991b1b}.error{color:#b42318;margin:0 0 12px}.backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px}.modal{position:relative;width:min(100%,760px);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;padding:26px;display:grid;gap:12px}.modal h2{margin:0 0 4px}.modal label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#475569}.modal input,.modal select,.modal textarea{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #cfd8e6;border-radius:8px;padding:9px 10px;font:inherit}.modal textarea{resize:vertical;min-height:90px}.transfer-subtitle{margin:-5px 0 0;color:#405675;font-weight:700}.transfer-note{margin:0;padding:10px 12px;border-radius:8px;background:#eff6ff;color:#315887;font-size:.85rem;line-height:1.4}.rate-picker{position:relative}.rate-picker input{padding-right:86px}.rate-picker small{color:#637287;font-weight:600}.rate-search-button{position:absolute;right:6px;top:27px;border:0;border-radius:6px;background:#2349e6;color:#fff;padding:7px 11px;font-weight:800;cursor:pointer}.rate-picker__results{position:absolute;z-index:4;top:100%;left:0;right:0;max-height:270px;overflow:auto;border:1px solid #bfcee4;border-radius:8px;background:#fff;box-shadow:0 12px 26px rgba(15,23,42,.16)}.rate-picker__results button{display:grid;width:100%;gap:3px;padding:10px 12px;border:0;border-bottom:1px solid #edf1f6;background:#fff;text-align:left;cursor:pointer;color:#1d3557}.rate-picker__results button:hover{background:#eff6ff}.rate-picker__results span{font-size:.8rem;color:#61708a}.rate-picker__results p{margin:0;padding:12px;color:#66758b;font-weight:600}.shift-missing{display:grid;gap:5px;padding:12px;border:1px solid #f5c978;border-radius:9px;background:#fff9ed;color:#80530b;font-size:.85rem}.shift-missing span{color:#8a6a30}.shift-missing button{justify-self:start;border:0;border-radius:7px;background:#f59e0b;color:#fff;padding:7px 10px;font-weight:800;cursor:pointer}.shift-choice{display:flex;gap:8px;flex-wrap:wrap}.shift-choice button{border:1px solid #cfd8e6;border-radius:7px;background:#fff;padding:8px 10px;font-weight:700;cursor:pointer}.shift-choice button.active{border-color:#2349e6;background:#eef3ff;color:#2043cc}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.1rem;cursor:pointer}.modal footer{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}@media(max-width:760px){.employees-page{padding:20px}.filters,.grid{grid-template-columns:1fr}.page-head{flex-direction:column;align-items:flex-start}}
</style>
