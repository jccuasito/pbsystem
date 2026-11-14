<script setup lang="ts">
import { requestErrorMessage } from '~~/shared/utils/requestError'

import { computed, onMounted, ref } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import ModernDateField from '~~/components/ModernDateField.vue'
import { holidayDisplayDate, holidayWeekday, legalHolidayYears, legalHolidaySources } from '~~/shared/utils/philippineLegalHolidays'

const items = ref<any[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const modalOpen = ref(false)
const editing = ref<any | null>(null)
const searchText = ref('')
const appliedSearch = ref('')
const typeFilter = ref('')
const currentYear = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric' }).format(new Date()))
let lastCurrentYear = currentYear()
const yearFilter = ref(String(lastCurrentYear))
const form = ref<Record<string, any>>({})
const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
function formatHolidayDate(date: string) {
  return date ? dateFormatter.format(new Date(`${date}T00:00:00Z`)) : '\u2014'
}


const years = computed(() => Array.from(new Set([...items.value.map(item => String(item.HolidayDate || '').slice(0, 4)).filter(Boolean), ...legalHolidayYears.map(String), ...Array.from({ length: 7 }, (_, index) => String(currentYear() - 3 + index))])).sort().reverse())
const filteredItems = computed(() => {
  const query = appliedSearch.value.trim().toLowerCase()
  return items.value.map(item => ({ ...item, DisplayDate: holidayDisplayDate(item.HolidayDate, item.Recurring, yearFilter.value ? Number(yearFilter.value) : undefined) })).filter((item) => {
    const matchesSearch = !query || String(item.HolidayName || '').toLowerCase().includes(query)
    const matchesType = !typeFilter.value || item.HolidayType === typeFilter.value
    const matchesYear = !yearFilter.value || item.DisplayDate.startsWith(yearFilter.value)
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
  const year = currentYear()
  if (year !== lastCurrentYear) {
    if (yearFilter.value === String(lastCurrentYear)) yearFilter.value = String(year)
    lastCurrentYear = year
  }
  if (!silent) loading.value = true
  try {
    const response: any = await $fetch('/api/attendance/holidays')
    items.value = response.items || []
  } catch (cause: any) {
    error.value = requestErrorMessage(cause, 'Unable to load holidays.')
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
    error.value = requestErrorMessage(cause, 'Unable to save holiday.')
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
    error.value = requestErrorMessage(cause, 'Unable to deactivate holiday.')
  }
}

onMounted(load)
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !busy.value && !modalOpen.value })
</script>

<template>
  <main class="holiday-page">
    <header class="page-head"><div><p>ATTENDANCE</p><h1>Holiday Manager</h1><span>Manage legal and special holidays used in attendance and payroll.</span></div><button class="primary" @click="add">+ Add holiday</button></header>

    <form class="filters" @submit.prevent="appliedSearch = searchText">
      <label>Search holiday<input v-model="searchText" type="search" placeholder="Search holiday name" /></label>
      <label>Type<select v-model="typeFilter" aria-label="Type"><option value="">All types</option><option>Legal</option><option>Special</option></select></label>
      <label>Year<select v-model="yearFilter" aria-label="Year"><option value="">All years</option><option v-for="year in years" :key="year" :value="year">{{ year }}</option></select></label>
      <button class="secondary" type="submit">Search</button>
    </form>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="yearFilter" class="calendar-note">Recurring dates and weekdays follow {{ yearFilter }}.<template v-if="legalHolidaySources[Number(yearFilter)]">&nbsp;<a :href="legalHolidaySources[Number(yearFilter)]" target="_blank" rel="noopener noreferrer">Legal holiday reference</a>.</template><template v-if="yearFilter === '2027'"> Eid dates will be added once officially declared.</template><template v-else-if="!legalHolidaySources[Number(yearFilter)]"> Official movable holiday dates for this year are not yet installed.</template></p>
    <div class="table-wrap"><table><thead><tr><th>Holiday name</th><th>Date</th><th>Type</th><th>Recurring yearly</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      <tr v-if="loading"><td colspan="6">Loading…</td></tr><tr v-else-if="!filteredItems.length"><td colspan="6">No holidays found.</td></tr>
      <tr v-for="item in filteredItems" :key="item.HolidayID">
        <td class="name" data-label="Holiday name">{{ item.HolidayName }}</td>
        <td data-label="Date">{{ formatHolidayDate(item.DisplayDate) }}<small class="holiday-weekday">{{ holidayWeekday(item.DisplayDate) }}</small></td>
        <td data-label="Type"><span class="type" :class="`type--${String(item.HolidayType).toLowerCase()}`">{{ item.HolidayType }}</span></td>
        <td data-label="Recurring yearly">{{ Number(item.Recurring) ? 'Yes' : 'No' }}</td>
        <td data-label="Status"><span class="status" :class="`status--${String(item.Status).toLowerCase()}`">{{ item.Status }}</span></td>
        <td data-label="Actions"><div class="row-actions">
          <button class="action-icon" type="button" :aria-label="`Edit ${item.HolidayName}`" title="Edit holiday" @click="edit(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5M4 20l4-1 12-12a2.1 2.1 0 0 0-3-3L5 16l-1 4ZM4 21h16" /></svg></button>
          <button class="action-icon action-icon--deactivate" type="button" :aria-label="`Deactivate ${item.HolidayName}`" title="Deactivate holiday" :disabled="item.Status === 'Inactive'" @click="deactivate(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></svg></button>
        </div></td>
      </tr>
    </tbody></table></div>

    <Teleport to="body">
      <div v-if="modalOpen" class="backdrop" @click.self="!busy && (modalOpen = false)">
        <form class="modal holiday-modal" role="dialog" aria-modal="true" aria-labelledby="holiday-form-title" @submit.prevent="save" @keydown.esc="!busy && (modalOpen = false)">
          <button class="close" type="button" aria-label="Close holiday form" :disabled="busy" @click="modalOpen = false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          <h2 id="holiday-form-title">{{ editing ? 'Edit holiday' : 'Add holiday' }}</h2>
          <section class="holiday-form-section">
            <div class="form-section-heading"><span>BASIC INFORMATION</span><h3>Holiday details</h3></div>
            <label>Holiday name<input v-model.trim="form.HolidayName" maxlength="150" placeholder="e.g. Christmas Day" required /></label>
            <div class="grid">
              <ModernDateField v-model="form.HolidayDate" label="Date" placeholder="Select holiday date" :initial-year="Number(yearFilter) || currentYear()" required />
              <label>Holiday type<select v-model="form.HolidayType" aria-label="Holiday type" required><option>Legal</option><option>Special</option></select></label>
            </div>
            <div class="grid">
              <label>Recurring<select v-model="form.Recurring" aria-label="Recurring"><option value="0">One-time only</option><option value="1">Repeats every year</option></select></label>
              <label>Status<select v-model="form.Status" aria-label="Status" required><option>Active</option><option>Inactive</option></select></label>
            </div>
            <p class="hint">Recurring holidays retain the same month and day every year. Update the date for moveable holidays.</p>
          </section>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <footer>
            <button class="cancel-button" type="button" :disabled="busy" @click="modalOpen = false">Cancel</button>
            <button class="primary" type="submit" :disabled="busy">{{ busy ? 'Saving...' : 'Save holiday' }}</button>
          </footer>
        </form>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.holiday-page {
  padding: 32px;
  max-width: 1400px;
  margin: auto;
  color:var(--theme-ink,#162033);
  font-family: Inter, system-ui, sans-serif;
}
.page-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 22px; }
.page-head p { margin: 0; color:var(--theme-accent,#5271a5); font-size: .75rem; font-weight: 800; letter-spacing: .08em; }
.page-head h1 { margin: 4px 0 6px; font-size: 1.8rem; }
.page-head span { color:var(--theme-muted,#64748b); line-height: 1.5; }
.primary, .secondary { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 10px 14px; border: 1px solid transparent; border-radius: 10px; font: inherit; font-size: .85rem; font-weight: 700; cursor: pointer; }
.primary { background: #2349e6; color: #fff; }
.primary:hover:not(:disabled) { background: #1d3dcb; }
.secondary { background:var(--theme-soft,#eef3ff); color:var(--theme-accent,#2043cc); }
.filters { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(160px, 220px) minmax(140px, 180px) auto; gap: 14px; align-items: end; margin-bottom: 16px; }
.filters label, .holiday-modal label { display: grid; min-width: 0; gap: 6px; color:var(--theme-muted,#56657b); font-size: .8rem; font-weight: 700; }
.filters input, .filters select, .holiday-modal input, .holiday-modal select { box-sizing: border-box; width: 100%; min-width: 0; min-height: 42px; padding: 9px 11px; border:1px solid var(--theme-line,#cfd8e6); border-radius: 8px; background:var(--theme-surface,#fff); color:var(--theme-ink,#162033); font: inherit; }
.filters input:focus-visible, .filters select:focus-visible, .holiday-modal input:focus-visible, .holiday-modal select:focus-visible { outline:2px solid var(--theme-line,#afc5f5); outline-offset: 2px; }
.calendar-note { margin: 0 0 16px; color:var(--theme-muted,#64748b); font-size: .78rem; line-height: 1.6; }
.calendar-note a { color:var(--theme-accent,#315da1); }
.calendar-note a:hover { text-decoration: underline; }
.table-wrap { overflow: auto; border:1px solid var(--theme-line,#dce3ee); border-radius: 14px; background:var(--theme-surface,#fff); }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 14px; text-align: left; border-bottom:1px solid var(--theme-line,#edf1f6); font-size: .86rem; vertical-align: middle; }
th { background:var(--theme-soft,#f8fafc); color:var(--theme-muted,#526174); font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; }
th:last-child, td:last-child { text-align: center; width: 112px; }
tbody tr:last-child td { border-bottom: 0; }
.name { color:var(--theme-ink,#25364d); font-weight: 700; line-height: 1.5; }
.holiday-weekday { display: block; margin-top: 4px; color:var(--theme-muted,#66758b); font-size: .74rem; }
.status, .type { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: .74rem; font-weight: 700; white-space: nowrap; }
.status--active { background: #dcfce7; color: #166534; }
.status--inactive { background: #fee2e2; color: #991b1b; }
.type--legal { background:var(--theme-soft,#dbeafe); color:var(--theme-accent,#1d4ed8); }
.type--special { background: #fef3c7; color: #92400e; }
.row-actions { display: flex; align-items: center; justify-content: center; gap: 7px; }
.action-icon { display: inline-grid; flex: 0 0 34px; width: 34px; height: 34px; padding: 0; place-items: center; border:1px solid var(--theme-line,#d3dcea); border-radius: 8px; background:var(--theme-surface,#fff); color:var(--theme-muted,#315173); cursor: pointer; transition: background-color .16s, border-color .16s, color .16s; }
.action-icon:hover:not(:disabled) { border-color: #9cb5dc; background:var(--theme-soft,#edf4ff); color:var(--theme-accent,#174ea6); }
.action-icon svg, .close svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.action-icon--deactivate { color: #9a6700; }
.action-icon--deactivate:hover:not(:disabled) { border-color: #f3c969; background: #fff8e5; color: #7a4e00; }
button:disabled { opacity: .45; cursor: not-allowed; }
.error { margin: 0; color: #b42318; font-size: .84rem; line-height: 1.5; }
.backdrop { position: fixed; inset: 0; z-index: 300; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .58); }
.holiday-modal {
  box-sizing: border-box;
  position: relative;
  display: grid;
  gap: 18px;
  width: min(100%, 680px);
  max-height: 90dvh;
  overflow: auto;
  padding: 28px;
  border-radius: 16px;
  background:var(--theme-soft,#f7f9fc);
  color:var(--theme-ink,#162033);
  font-family: Inter, system-ui, sans-serif;
  font-size: .9rem;
  box-shadow: 0 24px 60px rgba(15, 23, 42, .2);
}
.holiday-modal h2 { margin: 0; padding-right: 38px; color:var(--theme-ink,#14233c); font-family: inherit; font-size: 1.55rem; line-height: 1.25; }
.close { position: absolute; top: 16px; right: 16px; display: grid; width: 36px; height: 36px; padding: 0; place-items: center; border: 0; border-radius: 9px; background: transparent; color:var(--theme-muted,#53657d); cursor: pointer; }
.close:hover:not(:disabled) { background:var(--theme-soft,#edf3fa); color:var(--theme-ink,#17375f); }
.close svg { width: 19px; height: 19px; stroke-width: 2; }
.holiday-form-section { display: grid; gap: 16px; min-width: 0; padding: 20px; border:1px solid var(--theme-line,#dce4ef); border-radius: 14px; background:var(--theme-surface,#fff); box-shadow: 0 4px 14px rgba(30, 54, 85, .035); }
.form-section-heading { padding-bottom: 12px; border-bottom:1px solid var(--theme-line,#edf1f6); }
.form-section-heading span { color:var(--theme-accent,#3767ba); font-size: .68rem; font-weight: 900; letter-spacing: .09em; }
.form-section-heading h3 { margin: 3px 0 0; color:var(--theme-ink,#1d304d); font-family: inherit; font-size: 1rem; }
.holiday-modal label { color:var(--theme-muted,#475569); }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 14px; }
.holiday-modal input, .holiday-modal select { min-height: 44px; font-family: inherit; }
.holiday-modal :deep(.modern-date-field__trigger) { min-height: 44px; border-radius: 8px; }
.hint { margin: 0; padding: 12px; border:1px solid var(--theme-line,#dce8fb); border-radius: 9px; background:var(--theme-soft,#eff6ff); color:var(--theme-accent,#335884); font-size: .78rem; font-weight: 400; line-height: 1.6; }
.holiday-modal > footer { position: sticky; z-index: 3; bottom: -28px; display: flex; justify-content: flex-end; gap: 10px; margin: 0 -28px -28px; padding: 16px 28px; border-top:1px solid var(--theme-line,#dce4ef); background: var(--theme-surface,rgba(255, 255, 255, .97)); box-shadow: 0 -8px 20px rgba(30, 54, 85, .05); }
.holiday-modal > footer > button { min-height: 42px; padding: 9px 17px; border:1px solid var(--theme-line,#cfd8e6); border-radius: 9px; font: inherit; font-size: .85rem; font-weight: 800; cursor: pointer; }
.holiday-modal > footer > .primary { border-color: #2349e6; }
.cancel-button { background:var(--theme-soft,#f8fafc); color:var(--theme-muted,#334e6f); }
.cancel-button:hover:not(:disabled) { border-color: #94a8c2; background:var(--theme-soft,#eef3f8); }
@media (max-width: 900px) { .filters { grid-template-columns: minmax(0, 1fr) minmax(140px, 180px); } table { min-width: 760px; } }
@media (max-width: 760px) {
  .holiday-page { padding: 20px; }
  .page-head { flex-direction: column; align-items: flex-start; }
  .filters { grid-template-columns: 1fr; }
  .filters .secondary { justify-self: start; min-width: 100px; }
  .backdrop { padding: 10px; }
  .holiday-modal { max-height: calc(100dvh - 20px); padding: 22px 14px; gap: 16px; }
  .holiday-modal h2 { font-size: 1.35rem; }
  .holiday-form-section { padding: 14px; }
  .holiday-modal > footer { bottom: -22px; margin: 0 -14px -22px; padding: 14px; }
  table, tbody { display: block; min-width: 0; }
  thead { display: none; }
  tbody tr { display: block; padding: 10px 14px; border-bottom:1px solid var(--theme-line,#dce3ee); }
  tbody tr:last-child { border-bottom: 0; }
  td { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 4px 10px; padding: 9px 0; border: 0; overflow-wrap: anywhere; }
  td::before { content: attr(data-label); grid-column: 1; grid-row: 1 / 3; color:var(--theme-muted,#66758b); font-size: .75rem; font-weight: 600; }
  td > * { grid-column: 2; justify-self: start; }
  td:last-child { width: auto; text-align: left; }
  .row-actions { justify-content: flex-start; }
  tr:has(td[colspan]) td { display: block; }
  tr:has(td[colspan]) td::before { display: none; }
}
@media (max-width: 600px) { .grid { grid-template-columns: 1fr; } .holiday-modal :deep(.modern-date-field__panel) { width: 100%; } }
</style>
