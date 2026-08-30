<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'

const items = ref<any[]>([])
const agencies = ref<any[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const modalOpen = ref(false)
const editing = ref<any | null>(null)
const searchText = ref('')
const appliedSearch = ref('')
const agencyFilter = ref('')
const shiftTypeFilter = ref('')
const form = ref<Record<string, any>>({})

const filteredItems = computed(() => {
  const query = appliedSearch.value.trim().toLowerCase()
  return items.value.filter((item) => {
    const matchesAgency = !agencyFilter.value || String(item.AgencyID) === agencyFilter.value
    const matchesType = !shiftTypeFilter.value || item.ShiftType === shiftTypeFilter.value
    const matchesSearch = !query || [item.ShiftCode, item.ShiftName].some((value) => String(value || '').toLowerCase().includes(query))
    return matchesAgency && matchesType && matchesSearch
  })
})

function resetForm(item: any = null) {
  editing.value = item
  form.value = {
    AgencyID: item?.AgencyID ? String(item.AgencyID) : '',
    ShiftCode: item?.ShiftCode || '',
    ShiftName: item?.ShiftName || '',
    ShiftType: item?.ShiftType || 'DS',
    TimeIn: String(item?.TimeIn || '08:00').slice(0, 5),
    TimeOut: String(item?.TimeOut || '17:00').slice(0, 5),
    RegularHours: item?.RegularHours ?? '8',
    RegularOTCap: item?.RegularOTCap ?? '4',
    WorkdayCount: item?.WorkdayCount ?? (item?.ShiftType === 'SS' ? '2' : '1'),
    NDEnabled: Number(item?.NDEnabled) ? '1' : '0',
    NDStartTime: item?.NDStartTime ? String(item.NDStartTime).slice(0, 5) : '',
    NDEndTime: item?.NDEndTime ? String(item.NDEndTime).slice(0, 5) : '',
    Status: item?.Status || 'Active'
  }
  error.value = ''
}

function add() {
  resetForm()
  modalOpen.value = true
}

function edit(item: any) {
  resetForm(item)
  modalOpen.value = true
}

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    const response: any = await $fetch('/api/organization/shift-code')
    items.value = response.items || []
    agencies.value = response.agencies || []
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to load shift codes.'
  } finally {
    if (!silent) loading.value = false
  }
}

async function save() {
  busy.value = true
  error.value = ''
  try {
    const body = editing.value ? { id: editing.value.ShiftCodeID, ...form.value } : form.value
    await $fetch('/api/organization/shift-code', { method: editing.value ? 'PUT' : 'POST', body })
    modalOpen.value = false
    await load()
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to save shift code.'
  } finally {
    busy.value = false
  }
}

async function deactivate(item: any) {
  if (!confirm(`Deactivate ${item.ShiftCode}?`)) return
  error.value = ''
  try {
    await $fetch('/api/organization/shift-code', { method: 'DELETE', body: { id: item.ShiftCodeID } })
    await load()
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to deactivate shift code.'
  }
}

async function remove(item: any) {
  if (!confirm(`Permanently delete ${item.ShiftCode}? This cannot be undone.`)) return
  error.value = ''
  try {
    await $fetch('/api/organization/shift-code', { method: 'DELETE', body: { id: item.ShiftCodeID, permanent: true } })
    await load()
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to delete shift code.'
  }
}

function displayTime(value: unknown) {
  return value ? String(value).slice(0, 5) : '—'
}

onMounted(load)
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !busy.value && !modalOpen.value })
</script>

<template>
  <main class="shift-page">
    <header class="page-head">
      <div><p>ATTENDANCE</p><h1>Shift Codes</h1><span>Define work schedules per agency.</span></div>
      <button class="primary" @click="add">+ Add shift code</button>
    </header>

    <form class="filters" @submit.prevent="appliedSearch = searchText">
      <label>Search shift code or name
        <input v-model="searchText" placeholder="e.g. DS0700 or day shift" />
      </label>
      <label>Agency
        <select v-model="agencyFilter">
          <option value="">All agencies</option>
          <option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option>
        </select>
      </label>
      <label>Shift type
        <select v-model="shiftTypeFilter"><option value="">All types</option><option value="DS">DS — Day Shift</option><option value="NS">NS — Night Shift</option><option value="MS">MS — Mid Shift</option><option value="SS">SS — Straight Shift</option><option>Flexible</option></select>
      </label>
      <button class="secondary" type="submit">Search</button>
    </form>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Shift code</th><th>Shift name</th><th>Agency</th><th>Type</th><th>Time in</th><th>Time out</th><th>Regular hrs</th><th>OT cap</th><th>ND window</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-if="loading"><td colspan="11">Loading…</td></tr>
          <tr v-else-if="!filteredItems.length"><td colspan="11">No shift codes found.</td></tr>
          <tr v-for="item in filteredItems" :key="item.ShiftCodeID">
            <td class="code">{{ item.ShiftCode }}</td><td>{{ item.ShiftName }}</td><td>{{ item.AgencyName }}</td><td>{{ item.ShiftType }}</td><td>{{ displayTime(item.TimeIn) }}</td><td>{{ displayTime(item.TimeOut) }}</td><td>{{ item.RegularHours }}</td><td>{{ item.RegularOTCap }}</td>
            <td>{{ Number(item.NDEnabled) ? `${displayTime(item.NDStartTime)}–${displayTime(item.NDEndTime)}` : 'Disabled' }}</td>
            <td><span class="status" :class="`status--${String(item.Status).toLowerCase()}`">{{ item.Status }}</span></td>
            <td class="actions"><button @click="edit(item)">Edit</button><button :disabled="item.Status === 'Inactive'" @click="deactivate(item)">Deactivate</button><button class="delete" @click="remove(item)">Delete</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="modalOpen" class="backdrop" @click.self="!busy && (modalOpen = false)">
        <form class="modal" @submit.prevent="save">
          <button class="close" type="button" :disabled="busy" @click="modalOpen = false">×</button>
          <h2>{{ editing ? 'Edit shift code' : 'Add shift code' }}</h2>
          <label>Agency<select v-model="form.AgencyID" required><option value="">Select agency</option><option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option></select></label>
          <div class="grid"><label>Shift code<input v-model.trim="form.ShiftCode" maxlength="20" placeholder="e.g. DS0700-1900" required /></label><label>Shift name<input v-model.trim="form.ShiftName" maxlength="100" placeholder="e.g. Day duty 7 AM–7 PM" required /></label></div>
          <div class="grid"><label>Shift type<select v-model="form.ShiftType" required><option value="DS">DS — Day Shift</option><option value="NS">NS — Night Shift</option><option value="MS">MS — Mid Shift</option><option value="SS">SS — Straight Shift</option><option>Flexible</option></select></label><label>Status<select v-model="form.Status" required><option>Active</option><option>Inactive</option></select></label></div>
          <div class="grid"><label>Time in<input v-model="form.TimeIn" type="time" required /></label><label>Time out<input v-model="form.TimeOut" type="time" required /></label></div>
          <div class="grid"><label>Regular hours<input v-model="form.RegularHours" type="number" min="0" max="24" step="0.25" required /></label><label>Regular OT cap<input v-model="form.RegularOTCap" type="number" min="0" max="24" step="0.25" required /></label></div>
          <label>Payable DTR days<input v-model="form.WorkdayCount" type="number" min="1" max="31" step="1" required /></label>
          <label>Night Differential<select v-model="form.NDEnabled"><option value="0">Disabled</option><option value="1">Enabled for this shift code</option></select></label>
          <div v-if="form.NDEnabled === '1'" class="grid"><label>ND start time<input v-model="form.NDStartTime" type="time" required /></label><label>ND end time<input v-model="form.NDEndTime" type="time" required /></label></div>
          <p class="hint">ND hours will later be calculated from actual Time In/Out and this shift code's own ND window, including qualifying overtime. No ND time is pre-filled.</p>
          <p v-if="error" class="error">{{ error }}</p>
          <footer><button type="button" @click="modalOpen = false">Cancel</button><button class="primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save shift code' }}</button></footer>
        </form>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.shift-page{padding:32px;max-width:1450px;margin:auto;color:#162033;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:24px}.page-head p{margin:0;color:#5271a5;font-size:.75rem;letter-spacing:.08em;font-weight:800}.page-head h1{margin:4px 0;font-size:1.8rem}.page-head span{color:#64748b}.primary,.secondary{border:0;border-radius:9px;padding:10px 14px;font-weight:700;cursor:pointer}.primary{background:#2349e6;color:#fff}.secondary{background:#edf2ff;color:#2349c9}.filters{display:flex;align-items:end;gap:14px;flex-wrap:wrap;margin-bottom:16px}.filters label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#56657b}.filters input,.filters select{min-height:40px;min-width:220px;border:1px solid #ccd5e4;border-radius:8px;padding:8px 10px;background:#fff;font:inherit}.table-wrap{overflow:auto;border:1px solid #dce3ee;border-radius:14px;background:#fff}table{width:100%;border-collapse:collapse}th,td{padding:13px 14px;text-align:left;border-bottom:1px solid #edf1f6;font-size:.88rem;white-space:nowrap}th{background:#f8fafc;color:#526174;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}.code{font-weight:800;color:#1f3fcf}.status{padding:3px 8px;border-radius:999px;font-size:.74rem;font-weight:700}.status--active{background:#dcfce7;color:#166534}.status--inactive{background:#fee2e2;color:#991b1b}.actions{display:flex;gap:8px}.actions button,footer button{border:1px solid #cfd8e6;border-radius:7px;padding:7px 10px;background:#fff;font-weight:700;cursor:pointer}.actions .delete{border-color:#fecaca;color:#b42318}.actions button:disabled{opacity:.5;cursor:not-allowed}.error{color:#b42318;margin:0 0 12px}.backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px}.modal{position:relative;width:min(100%,700px);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;padding:26px;display:grid;gap:12px}.modal h2{margin:0 0 4px}.modal label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#475569}.modal input,.modal select{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #cfd8e6;border-radius:8px;padding:9px 10px;font:inherit}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.hint{margin:0;padding:10px 12px;background:#eff6ff;border-radius:8px;color:#335884;font-size:.84rem}.close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.5rem;cursor:pointer}.modal footer{display:flex;justify-content:flex-end;gap:10px;margin-top:5px}@media(max-width:700px){.shift-page{padding:20px}.page-head,.filters{flex-direction:column;align-items:stretch}.filters input,.filters select,.primary,.secondary{width:100%;min-width:0}.grid{grid-template-columns:1fr}}
</style>
