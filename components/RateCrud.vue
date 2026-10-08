<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import RateMoneyFields from './RateMoneyFields.vue'
import SearchableSelect from './SearchableSelect.vue'
import ModernDateField from './ModernDateField.vue'
import { rateFormFields as moneyFields } from '~~/shared/utils/rateFields'

const props = defineProps<{ resource: 'payroll-rate' | 'billing-rate'; title: string }>()
const items = ref<any[]>([]); const agencyPositions = ref<any[]>([]); const regions = ref<any[]>([])
const search = ref(''); const agencyFilter = ref(''); const positionFilter = ref(''); const regionFilter = ref(''); const statusFilter = ref('')
const form = ref<any>({}); const open = ref(false); const busy = ref(false); const loading = ref(true); const error = ref('')
const selectedAgencyId = ref<string | number>('')
const editingCurrent = ref<any>(null); const editForm = ref<any>({}); const editBusy = ref(false); const editError = ref('')
const updating = ref<any>(null); const updateForm = ref<any>({}); const updateBusy = ref(false); const updateError = ref('')
const viewingHistory = ref<any>(null)
const modalTitle = computed(() => `Add ${props.title.slice(0, -1)}`)
const idKey = computed(() => props.resource === 'payroll-rate' ? 'PayrollRateID' : 'BillingRateID')
const agencyOptions = computed(() => [...new Map(agencyPositions.value.map(item => [String(item.AgencyID), { value: String(item.AgencyID), label: String(item.AgencyName) }])).values()].sort((a, b) => a.label.localeCompare(b.label)))
const formPositionOptions = computed(() => agencyPositions.value.filter(item => String(item.AgencyID) === String(selectedAgencyId.value)).map(item => ({ value: item.AgencyPositionID, label: String(item.PositionName) })).sort((a, b) => a.label.localeCompare(b.label)))
const agencies = computed(() => [...new Set(items.value.map(item => String(item.AgencyName || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
const positions = computed(() => [...new Set(items.value.filter(item => !agencyFilter.value || item.AgencyName === agencyFilter.value).map(item => String(item.PositionName || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
const rateRegions = computed(() => [...new Map(items.value.filter(item => item.RegionID != null).map(item => [String(item.RegionID), { id: String(item.RegionID), name: String(item.RegionName || item.RegionCode || '') }])).values()].sort((a, b) => a.name.localeCompare(b.name)))
const historyEntries = computed(() => {
  const item = viewingHistory.value
  if (!item) return []
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const currentDate = String(item.CurrentRate?.EffectiveDate || item.EffectiveDate || '').slice(0, 10)
  const entries = [{ ...item, isOriginal: true }, ...(item.Versions || []).map((version: any) => ({ ...version, isOriginal: false }))]
  return entries.reverse().map(entry => {
    const date = String(entry.EffectiveDate || '').slice(0, 10)
    return { ...entry, state: date > today ? 'Scheduled' : date === currentDate ? 'Current' : 'Previous' }
  })
})
const filteredItems = computed(() => {
  const words = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return items.value.filter(item => {
    const searchable = [item.AgencyName, item.PositionName, item.RegionCode, item.RegionName].join(' ').toLocaleLowerCase()
    return words.every(word => searchable.includes(word))
      && (!agencyFilter.value || item.AgencyName === agencyFilter.value)
      && (!positionFilter.value || item.PositionName === positionFilter.value)
      && (!regionFilter.value || String(item.RegionID ?? '') === regionFilter.value)
      && (!statusFilter.value || item.Status === statusFilter.value)
  })
})
function clearFilters() { search.value = ''; agencyFilter.value = ''; positionFilter.value = ''; regionFilter.value = ''; statusFilter.value = '' }
function changeAgency() { positionFilter.value = '' }
function changeFormAgency() { form.value.AgencyPositionID = '' }
function formatDate(value: unknown) {
  const day = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '—'
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
}
function openCurrentEdit(item: any) {
  editingCurrent.value = item
  const current = item.CurrentRate || item
  editForm.value = Object.fromEntries(moneyFields.map(({ key }) => [key, current[key] ?? 0]))
  editError.value = ''
}
async function saveCurrentEdit() {
  if (!editingCurrent.value || editBusy.value) return
  editBusy.value = true; editError.value = ''
  try {
    await $fetch(`/api/rates/${props.resource}`, { method: 'PUT', body: { id: editingCurrent.value[idKey.value], mode: 'current', ...editForm.value } })
    editingCurrent.value = null
    await load()
  } catch (e: any) { editError.value = e.data?.statusMessage || 'Unable to edit the current rate.' }
  finally { editBusy.value = false }
}
function openUpdate(item: any) {
  updating.value = item
  const latest = item.Versions?.at(-1) || item
  updateForm.value = { EffectiveDate: '', Reason: '', ...Object.fromEntries(moneyFields.map(({ key }) => [key, latest[key] ?? 0])) }
  updateError.value = ''
}
const minimumUpdateDate = computed(() => {
  const value = updating.value?.Versions?.at(-1)?.EffectiveDate || updating.value?.EffectiveDate
  const day = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined
  const next = new Date(`${day}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
})
async function saveUpdate() {
  if (!updating.value || updateBusy.value) return
  updateBusy.value = true; updateError.value = ''
  try {
    await $fetch('/api/rates/versions', { method: 'POST', body: { resource: props.resource, id: updating.value[idKey.value], ...updateForm.value } })
    updating.value = null
    await load()
  } catch (e: any) { updateError.value = e.data?.statusMessage || 'Unable to update rate.' }
  finally { updateBusy.value = false }
}
function reset() { selectedAgencyId.value = ''; form.value = { AgencyPositionID: '', RegionID: '', EffectiveDate: '', Status: 'Active', ...Object.fromEntries(moneyFields.map(({ key }) => [key, 0])) }; error.value = '' }
async function load(silent = false) { if (!silent) loading.value = true; try { const r: any = await $fetch(`/api/rates/${props.resource}`); items.value = r.items || []; agencyPositions.value = r.agencyPositions || []; regions.value = r.regions || []; if (viewingHistory.value) viewingHistory.value = items.value.find(item => item[idKey.value] === viewingHistory.value[idKey.value]) || null } catch (e: any) { error.value = e.data?.statusMessage || 'Unable to load rates.' } finally { if (!silent) loading.value = false } }
async function save() { busy.value = true; error.value = ''; try { await $fetch(`/api/rates/${props.resource}`, { method: 'POST', body: form.value }); open.value = false; await load() } catch (e: any) { error.value = e.data?.statusMessage || 'Unable to save rate.' } finally { busy.value = false } }
async function deactivate(item: any) { if (!confirm('Mark this rate as inactive?')) return; try { await $fetch(`/api/rates/${props.resource}`, { method: 'DELETE', body: { id: item[idKey.value] } }); await load() } catch (e: any) { error.value = e.data?.statusMessage || 'Unable to deactivate rate.' } }
const currency = (value: any) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value) || 0)
onMounted(load)
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !busy.value })
</script>
<template>
  <main class="rates-page">
    <header class="page-head">
      <div><p>RATES</p><h1>{{ title }}</h1><small>Manage {{ resource === 'payroll-rate' ? 'payroll' : 'billing' }} rates by agency position and region.</small></div>
      <button class="primary" type="button" @click="reset(); open = true">+ Add rate</button>
    </header>

    <section class="filters" :aria-label="title + ' filters'">
      <label class="search-field"><span>Search rates</span><input v-model.trim="search" type="search" placeholder="Search agency, position, or region"></label>
      <label><span>Agency</span><select v-model="agencyFilter" @change="changeAgency"><option value="">All agencies</option><option v-for="agency in agencies" :key="agency" :value="agency">{{ agency }}</option></select></label>
      <label><span>Position</span><select v-model="positionFilter"><option value="">All positions</option><option v-for="position in positions" :key="position" :value="position">{{ position }}</option></select></label>
      <label><span>Region</span><select v-model="regionFilter"><option value="">All regions</option><option v-for="region in rateRegions" :key="region.id" :value="region.id">{{ region.name }}</option></select></label>
      <label><span>Status</span><select v-model="statusFilter"><option value="">All statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
    </section>
    <div class="list-summary">
      <span>{{ loading ? 'Loading rates…' : 'Showing ' + filteredItems.length + ' of ' + items.length + ' rates' }}</span>
      <button v-if="search || agencyFilter || positionFilter || regionFilter || statusFilter" type="button" @click="clearFilters">Clear filters</button>
    </div>
    <p v-if="error && !open" class="error" role="alert">{{ error }}</p>

    <div class="table-wrap">
      <table>
        <thead><tr><th>Agency position</th><th>Region</th><th>Regular rate</th><th>Effective date</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-if="loading" class="table-message"><td colspan="6">Loading rates…</td></tr>
          <tr v-else-if="!filteredItems.length" class="table-message"><td colspan="6">{{ items.length ? 'No rates match the current filters.' : 'No rates found.' }}</td></tr>
          <tr v-for="item in loading ? [] : filteredItems" :key="item[idKey]">
            <td><strong>{{ item.AgencyName }}</strong><small>{{ item.PositionName }}</small></td>
            <td>{{ item.RegionName || 'All regions' }}</td>
            <td class="rate-amount">{{ currency(item.CurrentRate?.RegularRate ?? item.RegularRate) }}</td>
            <td>{{ formatDate(item.CurrentRate?.EffectiveDate ?? item.EffectiveDate) }}<small v-if="item.NextEffectiveDate">Next: {{ formatDate(item.NextEffectiveDate) }}</small></td>
            <td><span class="status" :class="'status--' + String(item.Status || '').toLowerCase()">{{ item.Status }}</span></td>
            <td><div class="row-actions">
              <button class="rate-icon-action" type="button" title="Edit current rate" :aria-label="`Edit current ${item.AgencyName} ${item.PositionName} rate`" :disabled="item.Status === 'Inactive'" @click="openCurrentEdit(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4L16.5 3.5Z" /></svg></button>
              <button class="rate-icon-action" type="button" title="Update rate with effective date" :aria-label="`Update ${item.AgencyName} ${item.PositionName} rate with effective date`" :disabled="item.Status === 'Inactive'" @click="openUpdate(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M12 14v4M10 16h4" /></svg></button>
              <button class="rate-icon-action" type="button" title="View rate history" :aria-label="`View ${item.AgencyName} ${item.PositionName} rate history`" @click="viewingHistory = item"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></button>
              <button class="rate-icon-action rate-icon-action--danger" type="button" title="Deactivate rate" :aria-label="`Deactivate ${item.AgencyName} ${item.PositionName} rate`" :disabled="item.Status === 'Inactive'" @click="deactivate(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6 18.4 18.4" /></svg></button>
            </div></td>
          </tr>
        </tbody>
      </table>
    </div>

    <section class="mobile-list" :aria-label="title">
      <p v-if="loading" class="mobile-message">Loading rates…</p>
      <p v-else-if="!filteredItems.length" class="mobile-message">{{ items.length ? 'No rates match the current filters.' : 'No rates found.' }}</p>
      <article v-for="item in loading ? [] : filteredItems" :key="item[idKey]" class="rate-card">
        <header><div><strong>{{ item.AgencyName }}</strong><span>{{ item.PositionName }}</span></div><span class="status" :class="'status--' + String(item.Status || '').toLowerCase()">{{ item.Status }}</span></header>
        <dl><div><dt>Region</dt><dd>{{ item.RegionName || 'All regions' }}</dd></div><div><dt>Regular rate</dt><dd>{{ currency(item.CurrentRate?.RegularRate ?? item.RegularRate) }}</dd></div><div><dt>Effective</dt><dd>{{ formatDate(item.CurrentRate?.EffectiveDate ?? item.EffectiveDate) }}<small v-if="item.NextEffectiveDate">Next: {{ formatDate(item.NextEffectiveDate) }}</small></dd></div></dl>
        <footer class="row-actions">
          <button class="rate-icon-action" type="button" title="Edit current rate" :aria-label="`Edit current ${item.AgencyName} ${item.PositionName} rate`" :disabled="item.Status === 'Inactive'" @click="openCurrentEdit(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4L16.5 3.5Z" /></svg></button>
          <button class="rate-icon-action" type="button" title="Update rate with effective date" :aria-label="`Update ${item.AgencyName} ${item.PositionName} rate with effective date`" :disabled="item.Status === 'Inactive'" @click="openUpdate(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M12 14v4M10 16h4" /></svg></button>
          <button class="rate-icon-action" type="button" title="View rate history" :aria-label="`View ${item.AgencyName} ${item.PositionName} rate history`" @click="viewingHistory = item"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></button>
          <button class="rate-icon-action rate-icon-action--danger" type="button" title="Deactivate rate" :aria-label="`Deactivate ${item.AgencyName} ${item.PositionName} rate`" :disabled="item.Status === 'Inactive'" @click="deactivate(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6 18.4 18.4" /></svg></button>
        </footer>
      </article>
    </section>
    <Teleport to="body">
      <div v-if="editingCurrent" class="backdrop" @click.self="!editBusy && (editingCurrent = null)">
        <form class="modal rate-form-modal" role="dialog" aria-modal="true" aria-labelledby="rate-edit-title" @submit.prevent="saveCurrentEdit">
          <header class="rate-modal-header">
            <div><p>CURRENT RATE</p><h2 id="rate-edit-title">Edit current {{ resource === 'payroll-rate' ? 'payroll' : 'billing' }} rate</h2><span>Correct the amounts in the rate that applies now.</span></div>
            <button class="rate-modal-close" type="button" aria-label="Close current rate editor" :disabled="editBusy" @click="editingCurrent = null"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          </header>
          <div class="rate-modal-body">
            <section class="rate-modal-section">
              <div class="rate-section-heading"><div><span>ASSIGNMENT</span><h3>Current rate</h3></div></div>
              <div class="rate-context"><strong>{{ editingCurrent.AgencyName }} · {{ editingCurrent.PositionName }}</strong><span>{{ editingCurrent.RegionName || 'All regions' }} · Effective {{ formatDate(editingCurrent.CurrentRate?.EffectiveDate || editingCurrent.EffectiveDate) }}</span></div>
              <p class="rate-note">Editing these amounts also changes recalculations for work dates covered by this current version. Earlier and scheduled versions stay unchanged. To preserve the old rate before a specific date, use the calendar Update action.</p>
            </section>
            <section class="rate-modal-section">
              <div class="rate-section-heading"><div><span>RATE AMOUNTS</span><h3>Current amounts</h3></div><small>PHP amounts for the current rate</small></div>
              <RateMoneyFields v-model="editForm" />
            </section>
            <p v-if="editError" class="error rate-modal-error" role="alert">{{ editError }}</p>
          </div>
          <footer class="rate-modal-footer"><button type="button" :disabled="editBusy" @click="editingCurrent = null">Cancel</button><button class="primary" :disabled="editBusy">{{ editBusy ? 'Saving…' : 'Save current rate' }}</button></footer>
        </form>
      </div>
    </Teleport>
    <Teleport to="body">
      <div v-if="viewingHistory" class="backdrop" @click.self="viewingHistory = null">
        <section class="modal rate-form-modal rate-history-modal" role="dialog" aria-modal="true" aria-labelledby="rate-history-title">
          <header class="rate-modal-header">
            <div><p>RATE HISTORY</p><h2 id="rate-history-title">{{ resource === 'payroll-rate' ? 'Payroll' : 'Billing' }} rate history</h2><span>{{ viewingHistory.AgencyName }} · {{ viewingHistory.PositionName }} · {{ viewingHistory.RegionName || 'All regions' }}</span></div>
            <button class="rate-modal-close" type="button" aria-label="Close rate history" @click="viewingHistory = null"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          </header>
          <div class="rate-modal-body">
            <p class="rate-history-intro">{{ viewingHistory.Versions?.length || 0 }} {{ viewingHistory.Versions?.length === 1 ? 'update' : 'updates' }} saved. The original rate and every new version remain available for their effective dates.</p>
            <article v-for="(entry, index) in historyEntries" :key="entry.isOriginal ? 'original' : entry.PayrollRateVersionID || entry.BillingRateVersionID" class="rate-history-entry">
              <div class="rate-history-entry__head"><div><span>{{ entry.isOriginal ? 'ORIGINAL RATE' : 'RATE UPDATE' }}</span><h3>{{ formatDate(entry.EffectiveDate) }}</h3></div><span class="rate-history-state" :class="`rate-history-state--${entry.state.toLowerCase()}`">{{ entry.state }}</span></div>
              <p v-if="entry.Reason" class="rate-history-reason">{{ entry.Reason }}</p>
              <div class="rate-history-highlight"><span>Regular <strong>{{ currency(entry.RegularRate) }}</strong></span><span>OT <strong>{{ currency(entry.OTRate) }}</strong></span></div>
              <details :open="index === 0"><summary>View all rate amounts</summary><dl><div v-for="field in moneyFields" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ currency(entry[field.key]) }}</dd></div></dl></details>
            </article>
          </div>
          <footer class="rate-modal-footer"><button type="button" @click="viewingHistory = null">Close</button></footer>
        </section>
      </div>
    </Teleport>
    <Teleport to="body">
      <div v-if="updating" class="backdrop" @click.self="!updateBusy && (updating = null)">
        <form class="modal rate-form-modal" role="dialog" aria-modal="true" aria-labelledby="rate-update-title" @submit.prevent="saveUpdate">
          <header class="rate-modal-header">
            <div><p>DATED RATE UPDATE</p><h2 id="rate-update-title">Update {{ resource === 'payroll-rate' ? 'payroll' : 'billing' }} rate</h2><span>Set the new amounts and the work date when they begin.</span></div>
            <button class="rate-modal-close" type="button" aria-label="Close rate update" :disabled="updateBusy" @click="updating = null"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          </header>
          <div class="rate-modal-body">
            <section class="rate-modal-section">
              <div class="rate-section-heading"><div><span>ASSIGNMENT</span><h3>Rate being updated</h3></div></div>
              <div class="rate-context"><strong>{{ updating.AgencyName }} · {{ updating.PositionName }}</strong><span>{{ updating.RegionName || 'All regions' }} · {{ updating.LinkedSites || 0 }} linked {{ Number(updating.LinkedSites) === 1 ? 'site' : 'sites' }}</span></div>
              <p class="rate-note">Every linked site uses these amounts for work dates on or after the effective date. Earlier work dates keep the previous rate; saved DTR attendance hours stay unchanged.</p>
            </section>
            <section class="rate-modal-section">
              <div class="rate-section-heading"><div><span>WHEN &amp; WHY</span><h3>Effective date and reference</h3></div></div>
              <div class="rate-fields-grid">
                <div class="rate-date-field"><ModernDateField v-model="updateForm.EffectiveDate" label="Effective date" placeholder="Select effective date" :min="minimumUpdateDate" required /><small v-if="minimumUpdateDate">After {{ formatDate(updating.Versions?.at(-1)?.EffectiveDate || updating.EffectiveDate) }}</small></div>
                <label class="rate-control"><span>Reason / reference <em>(optional)</em></span><input v-model="updateForm.Reason" type="text" maxlength="500" placeholder="e.g. DOLE wage order"><small>Helps explain this change in the rate history.</small></label>
              </div>
            </section>
            <section class="rate-modal-section">
              <div class="rate-section-heading"><div><span>RATE AMOUNTS</span><h3>Updated amounts</h3></div><small>PHP amounts for this rate version</small></div>
              <RateMoneyFields v-model="updateForm" />
            </section>
            <p v-if="updateError" class="error rate-modal-error" role="alert">{{ updateError }}</p>
          </div>
          <footer class="rate-modal-footer"><button type="button" :disabled="updateBusy" @click="updating = null">Cancel</button><button class="primary" :disabled="updateBusy">{{ updateBusy ? 'Saving…' : 'Save rate update' }}</button></footer>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="open" class="backdrop" @click.self="!busy && (open = false)">
        <form class="modal rate-form-modal" role="dialog" aria-modal="true" aria-labelledby="rate-form-title" @submit.prevent="save">
          <header class="rate-modal-header">
            <div><p>RATE SETUP</p><h2 id="rate-form-title">{{ modalTitle }}</h2><span>Choose an agency and one of its positions, then enter the rate details.</span></div>
            <button class="rate-modal-close" type="button" aria-label="Close rate form" :disabled="busy" @click="open = false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          </header>
          <div class="rate-modal-body">
            <section class="rate-modal-section">
              <div class="rate-section-heading"><div><span>ASSIGNMENT</span><h3>Agency, position, and region</h3></div><small>Positions are limited to the selected agency.</small></div>
              <div class="rate-fields-grid rate-fields-grid--three">
                <SearchableSelect v-model="selectedAgencyId" label="Agency" placeholder="Search agency" :options="agencyOptions" required empty-text="No active agencies with positions found." @change="changeFormAgency" />
                <SearchableSelect v-model="form.AgencyPositionID" label="Position" :placeholder="selectedAgencyId ? 'Search position' : 'Select agency first'" :options="formPositionOptions" :disabled="!selectedAgencyId" required empty-text="No active positions for this agency." />
                <label class="rate-control"><span>Region</span><select v-model="form.RegionID"><option value="">All regions</option><option v-for="option in regions" :key="option.RegionID" :value="option.RegionID">{{ option.RegionCode }} — {{ option.RegionName }}</option></select></label>
              </div>
            </section>
            <section class="rate-modal-section">
              <div class="rate-section-heading"><div><span>AVAILABILITY</span><h3>Effective date and status</h3></div></div>
              <div class="rate-fields-grid"><ModernDateField v-model="form.EffectiveDate" label="Effective date" placeholder="Select effective date" /><label class="rate-control"><span>Status</span><select v-model="form.Status"><option>Active</option><option>Inactive</option></select></label></div>
            </section>
            <section class="rate-modal-section">
              <div class="rate-section-heading"><div><span>RATE AMOUNTS</span><h3>Starting amounts</h3></div><small>PHP amounts for this rate</small></div>
              <RateMoneyFields v-model="form" />
            </section>
            <p v-if="error" class="error rate-modal-error" role="alert">{{ error }}</p>
          </div>
          <footer class="rate-modal-footer"><button type="button" :disabled="busy" @click="open = false">Cancel</button><button class="primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save rate' }}</button></footer>
        </form>
      </div>
    </Teleport>
  </main></template>
<style scoped>
.rates-page{padding:32px;max-width:1200px;margin:auto;color:#172033;font-family:Inter,system-ui,sans-serif}.rates-page header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}.rates-page header p{margin:0;color:#5271a5;font-size:.75rem;font-weight:800;letter-spacing:.08em}.rates-page h1{margin:3px 0 0;font-size:1.7rem}.primary{border:0;border-radius:8px;background:#2563eb;color:#fff;padding:10px 15px;font-weight:700;cursor:pointer}.table-wrap{overflow:auto;border:1px solid #dfe5ef;border-radius:10px}table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:13px 14px;text-align:left;border-bottom:1px solid #edf1f6;font-size:.88rem;white-space:nowrap}th{background:#f8fafc;color:#526174;font-size:.75rem;text-transform:uppercase}td button,footer button{border:1px solid #cfd8e6;background:#fff;border-radius:6px;padding:6px 9px;margin-right:6px;cursor:pointer}.status{padding:3px 8px;border-radius:999px;font-size:.74rem;font-weight:700}.status--active{background:#dcfce7;color:#166534}.status--inactive{background:#fee2e2;color:#991b1b}.error{color:#b42318}.backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px}.modal{box-sizing:border-box;font-family:Inter,system-ui,sans-serif;color:#172033;position:relative;width:min(100%,820px);max-height:90vh;overflow:auto;background:#fff;border-radius:12px;padding:26px;display:grid;gap:12px}.modal h2{margin:0}.modal label{display:grid;gap:5px;font-size:.8rem;font-weight:700;color:#475569}.modal input,.modal select{min-height:40px;border:1px solid #cfd8e6;border-radius:7px;padding:8px;font:inherit}.money-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.5rem;cursor:pointer}.modal footer{display:flex;justify-content:flex-end;margin-top:6px}@media(max-width:600px){.rates-page{padding:20px}.money-grid{grid-template-columns:1fr}}
.rates-page{box-sizing:border-box;width:100%;max-width:1500px}
.rates-page .page-head{align-items:flex-start;gap:18px;margin-bottom:24px}
.page-head small{display:block;margin-top:6px;color:#64748b;font-size:.85rem}
.primary{min-height:42px;border-radius:9px;padding:10px 16px;font:inherit;font-weight:800}
.filters{display:grid;grid-template-columns:minmax(280px,2fr) repeat(4,minmax(145px,.7fr));align-items:end;gap:12px;margin-bottom:12px}
.filters label{display:grid;min-width:0;gap:6px}
.filters label>span{color:#475569;font-size:.78rem;font-weight:800}
.filters input,.filters select{box-sizing:border-box;width:100%;min-width:0;min-height:42px;border:1px solid #cbd6e5;border-radius:9px;padding:8px 11px;background:#fff;color:#172033;font:inherit}
.filters input:focus,.filters select:focus{border-color:#7798d0;box-shadow:0 0 0 3px rgba(35,73,230,.1);outline:0}
.list-summary{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 1px 10px;color:#64748b;font-size:.78rem}
.list-summary button{border:0;background:transparent;color:#2458c4;font:inherit;font-weight:800;cursor:pointer}
.table-wrap{overflow:auto;border-radius:12px;background:#fff}
table{table-layout:fixed;min-width:1040px}
th,td{padding:11px 12px;vertical-align:middle;white-space:normal;overflow-wrap:break-word}
th{font-size:.69rem;letter-spacing:.025em}
th:first-child{width:30%}th:nth-child(2){width:15%}th:nth-child(3){width:13%}th:nth-child(4){width:17%}th:nth-child(5){width:10%}th:last-child{width:15%}
tbody tr:last-child td{border-bottom:0}
td strong,td small{display:block}
td strong{color:#17375f;font-size:.84rem}
td small{margin-top:3px;color:#64748b;font-size:.76rem}
.rate-amount{font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
.table-message td{padding:24px;text-align:center;color:#64748b}
.row-actions{display:flex;align-items:center;flex-wrap:nowrap;gap:7px}
.row-actions .rate-icon-action{display:grid;place-items:center;flex:none;box-sizing:border-box;width:38px;height:38px;min-height:38px;margin:0;border:1px solid #cfd8e6;border-radius:9px;padding:0;background:#fff;color:#29486e;cursor:pointer}
.row-actions .rate-icon-action:hover:not(:disabled),.row-actions .rate-icon-action:focus-visible{border-color:#91afe5;background:#edf3ff;color:#1e4fb0;outline:0}
.row-actions .rate-icon-action--danger:hover:not(:disabled),.row-actions .rate-icon-action--danger:focus-visible{border-color:#efb0b0;background:#fff1f2;color:#b42318}
.rate-icon-action svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.row-actions button:disabled,.rate-card footer button:disabled{opacity:.45;cursor:not-allowed}
.status{display:inline-flex;align-items:center;padding:4px 9px;font-size:.7rem;font-weight:800}
.status--inactive{background:#f1f5f9;color:#64748b}
.mobile-list{display:none}
.rates-page .rate-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin:0;padding:13px 14px;border-bottom:1px solid #edf1f6}
.rate-card,.mobile-message{border:1px solid #dce3ee;border-radius:12px;background:#fff}
.mobile-message{margin:0;padding:20px;text-align:center;color:#64748b}
.rate-card>header>div{display:grid;gap:3px}
.rate-card>header strong{color:#17375f;font-size:.9rem}
.rate-card>header div span{color:#64748b;font-size:.78rem}
.rate-card dl{display:grid;gap:8px;margin:0;padding:12px 14px}
.rate-card dl>div{display:grid;grid-template-columns:90px minmax(0,1fr);gap:8px}
.rate-card dt{color:#64748b;font-size:.69rem;font-weight:800;text-transform:uppercase}
.rate-card dd{margin:0;color:#273a55;font-size:.82rem}
.rate-card footer.row-actions{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid #edf1f6}
@media(max-width:1150px){.filters{grid-template-columns:repeat(4,minmax(0,1fr))}.search-field{grid-column:1/-1}}
@media(max-width:850px){.rates-page{padding:22px 18px}.table-wrap{display:none}.mobile-list{display:grid;gap:10px}.filters{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){.rates-page{padding:16px 12px}.rates-page .page-head{align-items:stretch;flex-direction:column;margin-bottom:18px}.page-head .primary{width:100%}.filters{grid-template-columns:1fr;gap:9px}.search-field{grid-column:auto}.list-summary{align-items:flex-start;flex-direction:column;gap:5px}}
.rate-form-modal{width:min(100%,1080px);max-height:min(92dvh,1080px);padding:0;display:flex;flex-direction:column;gap:0;overflow:visible;border:1px solid #d9e3f2;border-radius:18px;background:#f7f9fd;box-shadow:0 24px 70px rgba(12,30,60,.22)}
.rate-modal-header{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin:0;padding:24px 28px 20px;border-bottom:1px solid #e0e7f1;background:#fff;border-radius:18px 18px 0 0}
.rate-modal-header>div{min-width:0}.rate-modal-header p{margin:0 0 5px;color:#2563eb;font-size:.76rem;font-weight:800;letter-spacing:.08em}.rate-modal-header h2{margin:0;color:#112a4e;font-size:1.65rem;line-height:1.25}.rate-modal-header span{display:block;margin-top:7px;color:#62738e;font-size:.88rem;line-height:1.45}
.rate-modal-close{flex:none;display:grid;place-items:center;width:34px;height:34px;border:0;border-radius:8px;background:transparent;color:#526783;cursor:pointer}.rate-modal-close:hover{background:#eef3fb}.rate-modal-close svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.rate-modal-body{min-height:0;overflow-y:auto;overscroll-behavior:contain;display:grid;align-content:start;gap:16px;padding:20px 28px}
.rate-modal-section{min-width:0;padding:20px 22px;border:1px solid #d9e5f4;border-radius:14px;background:#fff}
.rate-section-heading{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e9eef5}.rate-section-heading span{color:#2563eb;font-size:.72rem;font-weight:800;letter-spacing:.08em}.rate-section-heading h3{margin:4px 0 0;color:#18365c;font-size:1rem}.rate-section-heading small{color:#71839d;font-size:.76rem;text-align:right}
.rate-fields-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:14px}.rate-fields-grid--three{grid-template-columns:repeat(3,minmax(0,1fr))}
.rate-control,.rate-date-field{min-width:0;display:grid;align-content:start;gap:6px}.rate-form-modal .rate-control>span{color:#475569;font-size:.85rem;font-weight:700}.rate-control em{color:#718096;font-size:.76rem;font-style:normal;font-weight:500}.rate-form-modal .rate-control input,.rate-form-modal .rate-control select{box-sizing:border-box;width:100%;min-width:0;min-height:44px;border:1px solid #cfd8e6;border-radius:9px;padding:9px 12px;background:#fff;color:#172033;font-size:.88rem}.rate-control small,.rate-date-field small{color:#71839d;font-size:.75rem;font-weight:500}
.rate-context{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 18px;color:#18365c}.rate-context strong{font-size:.93rem}.rate-context span{color:#526b91;font-size:.82rem}.rate-note{margin:14px 0 0;padding:11px 14px;border-radius:10px;background:#eaf2ff;color:#36577f;font-size:.8rem;line-height:1.5}
.rate-form-modal :deep(.rate-money-grid){grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.rate-form-modal :deep(.rate-money-grid label){color:#475569;font-size:.85rem}.rate-form-modal :deep(.rate-money-grid input){min-height:44px;border-radius:9px;padding:9px 12px;font-size:.88rem}
.rate-form-modal :deep(input:focus),.rate-form-modal :deep(select:focus){outline:0;border-color:#5684e9;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
.rate-history-modal{width:min(100%,760px)}.rate-history-intro{margin:0;color:#526b91;font-size:.85rem;line-height:1.5}
.rate-history-entry{padding:18px 20px;border:1px solid #d9e5f4;border-radius:13px;background:#fff}.rate-history-entry__head{display:flex;align-items:center;justify-content:space-between;gap:12px}.rate-history-entry__head>div>span{color:#2563eb;font-size:.71rem;font-weight:800;letter-spacing:.07em}.rate-history-entry__head h3{margin:4px 0 0;color:#18365c;font-size:1.05rem}
.rate-history-state{border-radius:999px;padding:5px 10px;background:#edf1f6;color:#53657c;font-size:.73rem;font-weight:800}.rate-history-state--current{background:#dcfce7;color:#166534}.rate-history-state--scheduled{background:#eaf2ff;color:#2458c4}
.rate-history-reason{margin:12px 0 0;color:#526b91;font-size:.82rem;line-height:1.45}.rate-history-highlight{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:14px;color:#62738e;font-size:.82rem}.rate-history-highlight strong{margin-left:5px;color:#18365c;font-variant-numeric:tabular-nums}
.rate-history-entry details{margin-top:14px;border-top:1px solid #e9eef5;padding-top:12px}.rate-history-entry summary{color:#2458c4;font-size:.81rem;font-weight:800;cursor:pointer}.rate-history-entry dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 20px;margin:12px 0 0}.rate-history-entry dl>div{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #edf1f6;font-size:.78rem}.rate-history-entry dt{color:#64748b}.rate-history-entry dd{margin:0;color:#18365c;font-weight:700;font-variant-numeric:tabular-nums}
.rate-modal-error{margin:0;padding:10px 12px;border-radius:8px;background:#fef2f2;font-size:.8rem}
.rate-form-modal .rate-modal-footer{flex:none;display:flex;justify-content:flex-end;gap:10px;margin:0;padding:16px 28px;border-top:1px solid #e0e7f1;border-radius:0 0 18px 18px;background:#fff}.rate-form-modal .rate-modal-footer button{min-height:42px;margin:0;padding:9px 16px;border-radius:9px;font-size:.84rem;font-weight:800}.rate-form-modal .rate-modal-footer .primary{border:0;color:#fff;background:#2563eb}
@media(max-width:800px){.rate-fields-grid--three{grid-template-columns:repeat(2,minmax(0,1fr))}.rate-fields-grid--three .rate-control{grid-column:1/-1}}
@media(max-width:600px){.rate-form-modal{max-height:calc(100dvh - 20px)}.rate-modal-header{padding:18px 18px 15px}.rate-modal-header h2{font-size:1.35rem}.rate-modal-body{padding:14px}.rate-modal-section{padding:16px}.rate-fields-grid,.rate-fields-grid--three{grid-template-columns:1fr}.rate-fields-grid--three .rate-control{grid-column:auto}.rate-form-modal :deep(.rate-money-grid){grid-template-columns:repeat(2,minmax(0,1fr))}.rate-form-modal .rate-modal-footer{padding:12px 16px}.rate-history-entry{padding:15px}.rate-history-entry dl{grid-template-columns:1fr}}
@media(max-width:420px){.rate-form-modal :deep(.rate-money-grid){grid-template-columns:1fr}.rate-form-modal .rate-modal-footer button{flex:1}}
</style>
