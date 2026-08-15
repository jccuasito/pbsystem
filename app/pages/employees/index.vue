<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { formatEmployeeId, formatEmployeeName, formatEmployeeNumber } from '~/utils/employee'

const items = ref<any[]>([])
const agencies = ref<any[]>([])
const positions = ref<any[]>([])
const agencyPositions = ref<any[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const formError = ref('')
const modalOpen = ref(false)
const editing = ref<any>(null)
const filters = ref({ agencyId: '', positionId: '' })

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

async function load() {
  loading.value = true
  try {
    const response: any = await $fetch('/api/employees', { query: { agencyId: filters.value.agencyId || undefined, positionId: filters.value.positionId || undefined } })
    items.value = response.items || []
    agencies.value = response.agencies || []
    positions.value = response.positions || []
    agencyPositions.value = response.agencyPositions || []
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to load employees.'
  } finally {
    loading.value = false
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

onMounted(load)
</script>

<template>
  <main class="employees-page">
    <header class="page-head">
      <div>
        <p>EMPLOYEE MANAGEMENT</p>
        <h1>Employee List</h1>
      </div>
      <div class="actions-row">
        <NuxtLink class="ghost" to="/employees/documents">Employee Documents</NuxtLink>
        <button class="primary" @click="reset(); modalOpen = true">+ Add employee</button>
      </div>
    </header>

    <section class="filters">
      <label>
        <span>Agency</span>
        <select v-model="filters.agencyId" @change="load">
          <option value="">All Agencies</option>
          <option v-for="agency in agencies" :key="agency.AgencyID" :value="agency.AgencyID">{{ agency.AgencyName }}</option>
        </select>
      </label>
      <label>
        <span>Position</span>
        <select v-model="filters.positionId" @change="load">
          <option value="">All Positions</option>
          <option v-for="position in positions" :key="position.PositionID" :value="position.PositionID">{{ position.PositionName }}</option>
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
          <tr v-else-if="!items.length"><td colspan="9">No employees found.</td></tr>
          <tr v-for="item in items" :key="item.EmployeeID">
            <td class="employee-id">{{ formatEmployeeId(item.EmployeeID) }}</td>
            <td>{{ formatEmployeeNumber(item.EmployeeNumber) }}</td>
            <td>{{ formatEmployeeName(item) }}</td>
            <td>{{ format(item.AgencyName) }}</td>
            <td>{{ format(item.PositionName) }}</td>
            <td>{{ format(item.SiteName) }}</td>
            <td><span class="status" :class="`status--${String(item.DeploymentStatus || 'unassigned').toLowerCase()}`">{{ item.DeploymentStatus }}</span></td>
            <td><span class="status" :class="`status--${String(item.Status || '').toLowerCase()}`">{{ item.Status }}</span></td>
            <td class="row-actions"><button @click="reset(item); modalOpen = true">Edit</button><button :disabled="item.Status === 'Inactive'" @click="deactivate(item)">Deactivate</button></td>
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
  </main>
</template>

<style scoped>
.employees-page{padding:32px;max-width:1400px;margin:auto;color:#162033;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}.page-head p{margin:0;font-size:.75rem;font-weight:800;letter-spacing:.08em;color:#5271a5}.page-head h1{margin:4px 0 0;font-size:1.8rem}.actions-row{display:flex;gap:10px;flex-wrap:wrap}.primary,.ghost{border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.primary{background:#2349e6;color:#fff}.ghost{background:#eef3ff;color:#2043cc}.filters{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 16px}.filters label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#56657b}.filters select{min-height:40px;border:1px solid #ccd5e4;border-radius:8px;padding:8px 10px;background:#fff}.table-wrap{overflow:auto;border:1px solid #dce3ee;border-radius:14px;background:#fff}table{width:100%;border-collapse:collapse}th,td{padding:13px 14px;text-align:left;border-bottom:1px solid #edf1f6;font-size:.88rem;white-space:nowrap}th{background:#f8fafc;color:#526174;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}.row-actions{display:flex;gap:8px}button:disabled{opacity:.45;cursor:not-allowed}.status{padding:3px 8px;border-radius:999px;font-size:.74rem;font-weight:700}.status--active,.status--unassigned{background:#dcfce7;color:#166534}.status--inactive,.status--ended{background:#fee2e2;color:#991b1b}.error{color:#b42318;margin:0 0 12px}.backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px}.modal{position:relative;width:min(100%,760px);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;padding:26px;display:grid;gap:12px}.modal h2{margin:0 0 4px}.modal label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#475569}.modal input,.modal select,.modal textarea{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #cfd8e6;border-radius:8px;padding:9px 10px;font:inherit}.modal textarea{resize:vertical;min-height:90px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.1rem;cursor:pointer}.modal footer{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}@media(max-width:760px){.employees-page{padding:20px}.grid{grid-template-columns:1fr}.page-head{flex-direction:column;align-items:flex-start}}
</style>
