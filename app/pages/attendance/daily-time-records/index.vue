<script setup lang="ts">
type Option = { id: string | number, label: string }

const now = new Date()
const selectedYear = ref(String(now.getFullYear()))
const search = ref('')
const agencyId = ref('')
const clientId = ref('')
const selectedCutoff = ref('')
const searched = ref(false)
const loadingFilters = ref(false)
const agencies = ref<Option[]>([])
const clients = ref<Option[]>([])

function cutoffOptions(year: number) {
  return Array.from({ length: 12 }, (_, monthIndex) => {
    const month = new Date(year, monthIndex).toLocaleString('en-PH', { month: 'long' })
    const lastDay = new Date(year, monthIndex + 1, 0).getDate()
    return [
      { value: `${year}-${String(monthIndex + 1).padStart(2, '0')}-01:${year}-${String(monthIndex + 1).padStart(2, '0')}-15`, label: `${month} 1–15, ${year}` },
      { value: `${year}-${String(monthIndex + 1).padStart(2, '0')}-16:${year}-${String(monthIndex + 1).padStart(2, '0')}-${lastDay}`, label: `${month} 16–${lastDay}, ${year}` }
    ]
  }).flat()
}

const yearOptions = computed(() => {
  const currentYear = now.getFullYear()
  return Array.from({ length: 5 }, (_, index) => String(currentYear - 2 + index))
})
const cutoffs = computed(() => cutoffOptions(Number(selectedYear.value)))
const currentCutoff = () => {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const start = now.getDate() <= 15 ? 1 : 16
  const end = start === 1 ? 15 : new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(start).padStart(2, '0')}:${year}-${String(month).padStart(2, '0')}-${end}`
}

watch(selectedYear, () => {
  selectedCutoff.value = selectedYear.value === String(now.getFullYear()) ? currentCutoff() : cutoffs.value[0]?.value || ''
})

async function loadFilters() {
  loadingFilters.value = true
  try {
    const response = await $fetch<any>('/api/attendance/dtr-lookups', { query: agencyId.value ? { agencyId: agencyId.value } : undefined })
    agencies.value = (response.agencies || []).map((item: any) => ({ id: item.AgencyID, label: item.AgencyName }))
    clients.value = (response.clients || []).map((item: any) => ({ id: item.ClientID, label: item.ClientName }))
  } catch {
    // The DTR screen remains usable while master-data lookups are unavailable.
  } finally {
    loadingFilters.value = false
  }
}

watch(agencyId, async () => {
  clientId.value = ''
  await loadFilters()
})

function runSearch() {
  searched.value = true
}

function createDtr() {
  searched.value = true
}

selectedCutoff.value = currentCutoff()
onMounted(loadFilters)
</script>

<template>
  <section class="dtr-page">
    <div class="dtr-heading">
      <div>
        <p class="dtr-eyebrow">ATTENDANCE</p>
        <h1>Daily Time Records</h1>
        <p>Review and prepare employee attendance per payroll cutoff.</p>
      </div>
      <button type="button" class="dtr-create" @click="createDtr">Create DTR</button>
    </div>

    <form class="dtr-filters" @submit.prevent="runSearch">
      <label class="dtr-search">
        <span class="sr-only">Search client, site, or DTR ID</span>
        <input v-model.trim="search" type="search" placeholder="Search client, site, or DTR ID" />
      </label>
      <select v-model="agencyId" :disabled="loadingFilters" aria-label="Agency">
        <option value="">All agencies</option>
        <option v-for="agency in agencies" :key="agency.id" :value="agency.id">{{ agency.label }}</option>
      </select>
      <select v-model="clientId" :disabled="loadingFilters" aria-label="Client">
        <option value="">All clients</option>
        <option v-for="client in clients" :key="client.id" :value="client.id">{{ client.label }}</option>
      </select>
      <select v-model="selectedYear" aria-label="Year">
        <option v-for="year in yearOptions" :key="year" :value="year">{{ year }}</option>
      </select>
      <select v-model="selectedCutoff" aria-label="Payroll cutoff">
        <option v-for="cutoff in cutoffs" :key="cutoff.value" :value="cutoff.value">{{ cutoff.label }}</option>
      </select>
      <button type="submit" class="dtr-search-button">Search</button>
    </form>

    <div class="dtr-period">Selected cutoff: <strong>{{ cutoffs.find(cutoff => cutoff.value === selectedCutoff)?.label }}</strong></div>

    <div class="dtr-table-wrap">
      <table class="dtr-table">
        <thead>
          <tr><th>DTR ID</th><th>Agency</th><th>Client</th><th>Site</th><th>Period</th><th>People</th><th>Created date</th><th>Actions</th></tr>
        </thead>
        <tbody>
          <tr>
            <td colspan="8" class="dtr-empty">
              {{ searched ? 'No Daily Time Records matched your search.' : 'No Daily Time Records yet for the selected cutoff.' }}
              <small>Create a DTR once the attendance backend is connected.</small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.dtr-page { max-width: 1420px; margin: 0 auto; }
.dtr-heading { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; margin-bottom:24px; }
.dtr-eyebrow { margin:0 0 7px; color:#4f79bd; font-size:12px; font-weight:800; letter-spacing:.09em; }
h1 { margin:0; color:#122c57; font-size:30px; line-height:1.15; }
.dtr-heading p:not(.dtr-eyebrow) { margin:7px 0 0; color:#60718f; }
.dtr-create, .dtr-search-button { border:0; border-radius:8px; background:#2867d8; color:#fff; font:inherit; font-weight:700; cursor:pointer; padding:11px 17px; white-space:nowrap; }
.dtr-filters { display:grid; grid-template-columns:minmax(230px, 1.6fr) repeat(4, minmax(120px, .7fr)) auto; gap:10px; align-items:center; }
.dtr-filters input, .dtr-filters select { box-sizing:border-box; width:100%; min-height:43px; border:1px solid #cfd9e9; border-radius:8px; background:#fff; color:#223a60; font:inherit; padding:0 12px; }
.dtr-filters input:focus, .dtr-filters select:focus { outline:2px solid rgba(40,103,216,.22); border-color:#2867d8; }
.dtr-period { margin:15px 0; color:#5d6d88; font-size:14px; }
.dtr-period strong { color:#233c62; }
.dtr-table-wrap { overflow-x:auto; border:1px solid #dce5f1; border-radius:12px; background:#fff; }
.dtr-table { width:100%; min-width:920px; border-collapse:collapse; }
.dtr-table th { padding:15px 16px; text-align:left; color:#28446e; font-size:13px; background:#f7f9fd; border-bottom:1px solid #dce5f1; white-space:nowrap; }
.dtr-empty { padding:48px 16px; text-align:center; color:#64738d; }
.dtr-empty small { display:block; margin-top:7px; color:#90a0b7; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
@media (max-width:1050px) { .dtr-filters { grid-template-columns:repeat(3, minmax(0, 1fr)); } .dtr-search { grid-column:span 3; } }
@media (max-width:650px) { .dtr-heading { display:block; } .dtr-create { margin-top:16px; } .dtr-filters { grid-template-columns:1fr; } .dtr-search { grid-column:auto; } }
</style>
