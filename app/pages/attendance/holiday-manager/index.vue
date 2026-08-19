<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'

const items = ref<any[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const modalOpen = ref(false)
const editing = ref<any | null>(null)
const searchText = ref('')
const appliedSearch = ref('')
const typeFilter = ref('')
const yearFilter = ref('')
const form = ref<Record<string, any>>({})

const years = computed(() => Array.from(new Set(items.value.map((item) => String(item.HolidayDate || '').slice(0, 4)).filter(Boolean))).sort().reverse())
const filteredItems = computed(() => {
  const query = appliedSearch.value.trim().toLowerCase()
  return items.value.filter((item) => {
    const matchesSearch = !query || String(item.HolidayName || '').toLowerCase().includes(query)
    const matchesType = !typeFilter.value || item.HolidayType === typeFilter.value
    const matchesYear = !yearFilter.value || String(item.HolidayDate || '').startsWith(yearFilter.value)
    return matchesSearch && matchesType && matchesYear
  })
})

function resetForm(item: any = null) {
  editing.value = item
  form.value = {
    HolidayName: item?.HolidayName || '',
    HolidayDate: item?.HolidayDate ? String(item.HolidayDate).slice(0, 10) : '',
    HolidayType: item?.HolidayType || 'Legal',
    Recurring: Number(item?.Recurring) ? '1' : '0',
    Status: item?.Status || 'Active'
  }
  error.value = ''
}

function add() { resetForm(); modalOpen.value = true }
function edit(item: any) { resetForm(item); modalOpen.value = true }

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    const response: any = await $fetch('/api/attendance/holidays')
    items.value = response.items || []
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to load holidays.'
  } finally {
    if (!silent) loading.value = false
  }
}

async function save() {
  busy.value = true
  error.value = ''
  try {
    const body = editing.value ? { id: editing.value.HolidayID, ...form.value } : form.value
    await $fetch('/api/attendance/holidays', { method: editing.value ? 'PUT' : 'POST', body })
    modalOpen.value = false
    await load()
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to save holiday.'
  } finally {
    busy.value = false
  }
}

async function deactivate(item: any) {
  if (!confirm(`Deactivate ${item.HolidayName}?`)) return
  error.value = ''
  try {
    await $fetch('/api/attendance/holidays', { method: 'DELETE', body: { id: item.HolidayID } })
    await load()
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to deactivate holiday.'
  }
}

onMounted(load)
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !busy.value && !modalOpen.value })
</script>

<template>
  <main class="holiday-page">
    <header class="page-head"><div><p>ATTENDANCE</p><h1>Holiday Manager</h1><span>Manage legal and special holidays used in attendance and payroll.</span></div><button class="primary" @click="add">+ Add holiday</button></header>

    <form class="filters" @submit.prevent="appliedSearch = searchText">
      <label>Search holiday<input v-model="searchText" placeholder="Search holiday name" /></label>
      <label>Type<select v-model="typeFilter"><option value="">All types</option><option>Legal</option><option>Special</option></select></label>
      <label>Year<select v-model="yearFilter"><option value="">All years</option><option v-for="year in years" :key="year" :value="year">{{ year }}</option></select></label>
      <button class="secondary" type="submit">Search</button>
    </form>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="table-wrap"><table><thead><tr><th>Holiday name</th><th>Date</th><th>Type</th><th>Recurring yearly</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      <tr v-if="loading"><td colspan="6">Loading…</td></tr><tr v-else-if="!filteredItems.length"><td colspan="6">No holidays found.</td></tr>
      <tr v-for="item in filteredItems" :key="item.HolidayID"><td class="name">{{ item.HolidayName }}</td><td>{{ String(item.HolidayDate).slice(0, 10) }}</td><td><span class="type" :class="`type--${String(item.HolidayType).toLowerCase()}`">{{ item.HolidayType }}</span></td><td>{{ Number(item.Recurring) ? 'Yes' : 'No' }}</td><td><span class="status" :class="`status--${String(item.Status).toLowerCase()}`">{{ item.Status }}</span></td><td class="actions"><button @click="edit(item)">Edit</button><button :disabled="item.Status === 'Inactive'" @click="deactivate(item)">Deactivate</button></td></tr>
    </tbody></table></div>

    <Teleport to="body"><div v-if="modalOpen" class="backdrop" @click.self="!busy && (modalOpen = false)"><form class="modal" @submit.prevent="save"><button class="close" type="button" :disabled="busy" @click="modalOpen = false">×</button><h2>{{ editing ? 'Edit holiday' : 'Add holiday' }}</h2>
      <label>Holiday name<input v-model.trim="form.HolidayName" maxlength="150" placeholder="e.g. Christmas Day" required /></label>
      <div class="grid"><label>Date<input v-model="form.HolidayDate" type="date" required /></label><label>Holiday type<select v-model="form.HolidayType" required><option>Legal</option><option>Special</option></select></label></div>
      <div class="grid"><label>Recurring<select v-model="form.Recurring"><option value="0">One-time only</option><option value="1">Repeats every year</option></select></label><label>Status<select v-model="form.Status" required><option>Active</option><option>Inactive</option></select></label></div>
      <p class="hint">Recurring holidays retain the same month and day every year. Update the date for moveable holidays.</p><p v-if="error" class="error">{{ error }}</p><footer><button type="button" @click="modalOpen = false">Cancel</button><button class="primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save holiday' }}</button></footer>
    </form></div></Teleport>
  </main>
</template>

<style scoped>
.holiday-page{padding:32px;max-width:1350px;margin:auto;color:#162033;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:24px}.page-head p{margin:0;color:#5271a5;font-size:.75rem;letter-spacing:.08em;font-weight:800}.page-head h1{margin:4px 0;font-size:1.8rem}.page-head span{color:#64748b}.primary,.secondary{border:0;border-radius:9px;padding:10px 14px;font-weight:700;cursor:pointer}.primary{background:#2349e6;color:#fff}.secondary{background:#edf2ff;color:#2349c9}.filters{display:flex;align-items:end;gap:14px;flex-wrap:wrap;margin-bottom:16px}.filters label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#56657b}.filters input,.filters select{min-height:40px;min-width:210px;border:1px solid #ccd5e4;border-radius:8px;padding:8px 10px;background:#fff;font:inherit}.table-wrap{overflow:auto;border:1px solid #dce3ee;border-radius:14px;background:#fff}table{width:100%;border-collapse:collapse}th,td{padding:13px 14px;text-align:left;border-bottom:1px solid #edf1f6;font-size:.88rem;white-space:nowrap}th{background:#f8fafc;color:#526174;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}.name{font-weight:800;color:#1f3fcf}.status,.type{padding:3px 8px;border-radius:999px;font-size:.74rem;font-weight:700}.status--active{background:#dcfce7;color:#166534}.status--inactive{background:#fee2e2;color:#991b1b}.type--legal{background:#dbeafe;color:#1d4ed8}.type--special{background:#fef3c7;color:#92400e}.actions{display:flex;gap:8px}.actions button,footer button{border:1px solid #cfd8e6;border-radius:7px;padding:7px 10px;background:#fff;font-weight:700;cursor:pointer}.actions button:disabled{opacity:.5;cursor:not-allowed}.error{color:#b42318;margin:0 0 12px}.backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px}.modal{position:relative;width:min(100%,620px);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;padding:26px;display:grid;gap:12px}.modal h2{margin:0 0 4px}.modal label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#475569}.modal input,.modal select{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #cfd8e6;border-radius:8px;padding:9px 10px;font:inherit}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.hint{margin:0;padding:10px 12px;background:#eff6ff;border-radius:8px;color:#335884;font-size:.84rem}.close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.5rem;cursor:pointer}.modal footer{display:flex;justify-content:flex-end;gap:10px;margin-top:5px}@media(max-width:700px){.holiday-page{padding:20px}.page-head,.filters{flex-direction:column;align-items:stretch}.filters input,.filters select,.primary,.secondary{width:100%;min-width:0}.grid{grid-template-columns:1fr}}
</style>
