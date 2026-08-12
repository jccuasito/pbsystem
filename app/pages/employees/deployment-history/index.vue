<script setup lang="ts">
import { onMounted, ref } from 'vue'

const items = ref<any[]>([])
const employees = ref<any[]>([])
const clientRates = ref<any[]>([])
const sites = ref<any[]>([])
const shiftCodes = ref<any[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const modalOpen = ref(false)
const form = ref({ EmployeeID: '', ClientRateID: '', SiteID: '', SiteShiftID: '', DeploymentType: 'Regular', StartDate: '', EndDate: '', Remarks: '' })

function reset() {
  form.value = { EmployeeID: '', ClientRateID: '', SiteID: '', SiteShiftID: '', DeploymentType: 'Regular', StartDate: '', EndDate: '', Remarks: '' }
  error.value = ''
}

async function load() {
  loading.value = true
  try {
    const response: any = await $fetch('/api/employees/deployments')
    items.value = response.items || []
    employees.value = response.employees || []
    clientRates.value = response.clientRates || []
    sites.value = response.sites || []
    shiftCodes.value = response.shiftCodes || []
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to load deployment history.'
  } finally {
    loading.value = false
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
  return value === null || value === undefined || value === '' ? '—' : value
}

onMounted(load)
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

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Deployment ID</th>
            <th>Employee No</th>
            <th>Name</th>
            <th>Agency</th>
            <th>Position</th>
            <th>Client</th>
            <th>Site</th>
            <th>Shift</th>
            <th>Type</th>
            <th>Start Date</th>
            <th>End Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="12">Loading…</td></tr>
          <tr v-else-if="!items.length"><td colspan="12">No deployment history found.</td></tr>
          <tr v-for="item in items" :key="item.DeploymentID">
            <td>{{ item.DeploymentID }}</td>
            <td>{{ display(item.EmployeeNumber) }}</td>
            <td>{{ display(item.EmployeeName) }}</td>
            <td>{{ display(item.AgencyName) }}</td>
            <td>{{ display(item.PositionName) }}</td>
            <td>{{ display(item.ClientName) }}</td>
            <td>{{ display(item.SiteName) }}</td>
            <td>{{ display(item.ShiftCode) }}<template v-if="item.ShiftName"> - {{ item.ShiftName }}</template></td>
            <td>{{ display(item.DeploymentType) }}</td>
            <td>{{ display(item.StartDate) }}</td>
            <td>{{ display(item.EndDate) }}</td>
            <td><span class="status" :class="`status--${String(item.Status || '').toLowerCase()}`">{{ item.Status }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="modalOpen" class="backdrop" @click.self="!busy && (modalOpen = false)">
        <form class="modal" @submit.prevent="save">
          <button class="close" type="button" @click="modalOpen = false">×</button>
          <h2>New deployment</h2>

          <label>Employee<select v-model="form.EmployeeID" required><option value="">Select employee</option><option v-for="employee in employees" :key="employee.EmployeeID" :value="employee.EmployeeID">{{ employee.EmployeeName }} ({{ employee.EmployeeNumber }})</option></select></label>
          <label>Client rate<select v-model="form.ClientRateID" required><option value="">Select client rate</option><option v-for="rate in clientRates" :key="rate.ClientRateID" :value="rate.ClientRateID">{{ rate.ClientName }} - {{ rate.AgencyName }} — {{ rate.PositionName }}</option></select></label>
          <div class="grid">
            <label>Site<select v-model="form.SiteID" required><option value="">Select site</option><option v-for="site in sites" :key="site.SiteID" :value="site.SiteID">{{ site.ClientName }} - {{ site.SiteName }}</option></select></label>
            <label>Shift<select v-model="form.SiteShiftID" required><option value="">Select shift</option><option v-for="shift in shiftCodes" :key="shift.ShiftCodeID" :value="shift.ShiftCodeID">{{ shift.ShiftCode }} - {{ shift.ShiftName }}</option></select></label>
          </div>
          <div class="grid">
            <label>Deployment type<input v-model="form.DeploymentType" /></label>
            <label>Start date<input v-model="form.StartDate" type="date" required /></label>
          </div>
          <div class="grid">
            <label>End date<input v-model="form.EndDate" type="date" /></label>
            <label>Remarks<input v-model="form.Remarks" /></label>
          </div>

          <p v-if="error" class="error">{{ error }}</p>
          <footer><button type="button" @click="modalOpen = false">Cancel</button><button class="primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save' }}</button></footer>
        </form>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.deployments-page{padding:32px;max-width:1500px;margin:auto;color:#162033;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}.page-head p{margin:0;font-size:.75rem;font-weight:800;letter-spacing:.08em;color:#5271a5}.page-head h1{margin:4px 0 0;font-size:1.8rem}.primary{border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;background:#2349e6;color:#fff}.table-wrap{overflow:auto;border:1px solid #dce3ee;border-radius:14px;background:#fff}table{width:100%;border-collapse:collapse}th,td{padding:13px 14px;text-align:left;border-bottom:1px solid #edf1f6;font-size:.88rem;white-space:nowrap}th{background:#f8fafc;color:#526174;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}.status{padding:3px 8px;border-radius:999px;font-size:.74rem;font-weight:700}.status--active{background:#dcfce7;color:#166534}.status--ended{background:#fee2e2;color:#991b1b}.error{color:#b42318;margin:0 0 12px}.backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px}.modal{position:relative;width:min(100%,800px);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;padding:26px;display:grid;gap:12px}.modal h2{margin:0 0 4px}.modal label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#475569}.modal input,.modal select{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #cfd8e6;border-radius:8px;padding:9px 10px;font:inherit}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.5rem;cursor:pointer}.modal footer{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}@media(max-width:760px){.deployments-page{padding:20px}.grid{grid-template-columns:1fr}.page-head{flex-direction:column;align-items:flex-start}}
</style>
