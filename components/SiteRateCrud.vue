<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import RateMoneyFields from './RateMoneyFields.vue'
import SearchableSelect from './SearchableSelect.vue'
import { emptyRateAmounts, rateFormFields as rateMoneyFields } from '~~/shared/utils/rateFields'

// Shared state for the responsive list and compact link-rate form.
const items = ref<any[]>([])
const sites = ref<any[]>([])
const agencyPositions = ref<any[]>([])
const payrollRates = ref<any[]>([])
const billingRates = ref<any[]>([])
const form = ref<any>({ SiteID: '', AgencyPositionID: '', PayrollRateID: '', BillingRateID: '', Status: 'Active' })
const editing = ref<any>(null)
const open = ref(false)
const busy = ref(false)
const loading = ref(true)
const error = ref('')
const inlinePayroll = ref(false)
const inlineBilling = ref(false)
const inlinePayrollAmounts = ref(emptyRateAmounts())
const inlineBillingAmounts = ref(emptyRateAmounts())
const search = ref('')
const clientFilter = ref('')
const agencyFilter = ref('')
const statusFilter = ref('')

const selectedSite = computed(() => sites.value.find(site => Number(site.SiteID) === Number(form.value.SiteID)) || null)
const matchesSiteRegion = (rate: any) => Number(rate.RegionID) === Number(selectedSite.value?.RegionID)
const filteredPayroll = computed(() => payrollRates.value.filter(rate => Number(rate.AgencyPositionID) === Number(form.value.AgencyPositionID) && rate.Status === 'Active' && matchesSiteRegion(rate)))
const filteredBilling = computed(() => billingRates.value.filter(rate => Number(rate.AgencyPositionID) === Number(form.value.AgencyPositionID) && rate.Status === 'Active' && matchesSiteRegion(rate)))
const selectedPayroll = computed(() => payrollRates.value.find(rate => Number(rate.PayrollRateID) === Number(form.value.PayrollRateID)))
const selectedBilling = computed(() => billingRates.value.find(rate => Number(rate.BillingRateID) === Number(form.value.BillingRateID)))

const siteOptions = computed(() => sites.value.filter(site => site.RegionID).map(site => ({
  value: site.SiteID,
  label: `${site.SiteName} — ${site.ClientName}`,
  search: `${site.ClientName} ${site.SiteName} ${site.RegionCode || ''} ${site.RegionName || ''}`,
})))
const agencyPositionOptions = computed(() => agencyPositions.value.map(position => ({
  value: position.AgencyPositionID,
  label: `${position.AgencyName} — ${position.PositionName}`,
  search: `${position.AgencyName} ${position.PositionName}`,
})))
const clients = computed(() => {
  const unique = new Map<string, string>()
  items.value.forEach(item => unique.set(String(item.ClientID), item.ClientName))
  return [...unique].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
})
const agencies = computed(() => [...new Set(items.value.map(item => item.AgencyName).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
const filteredItems = computed(() => {
  const words = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return items.value.filter(item => {
    const searchable = [item.SiteName, item.ClientName, item.AgencyName, item.PositionName, item.RegionName, item.RegionCode].join(' ').toLocaleLowerCase()
    return words.every(word => searchable.includes(word))
      && (!clientFilter.value || String(item.ClientID) === clientFilter.value)
      && (!agencyFilter.value || item.AgencyName === agencyFilter.value)
      && (!statusFilter.value || item.Status === statusFilter.value)
  })
})

function formatMoney(value: unknown) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 }).format(Number(value || 0))
}
function rateLabel(rate: any) { return `${formatMoney(rate.RegularRate)} · ${rate.EffectiveDate || 'No effective date'}` }
function reset(item: any = null) {
  editing.value = item
  form.value = { SiteID: item?.SiteID ?? '', AgencyPositionID: item?.AgencyPositionID ?? '', PayrollRateID: item?.PayrollRateID ?? '', BillingRateID: item?.BillingRateID ?? '', Status: item?.Status ?? 'Active' }
  inlinePayroll.value = false
  inlineBilling.value = false
  inlinePayrollAmounts.value = emptyRateAmounts()
  inlineBillingAmounts.value = emptyRateAmounts()
  error.value = ''
}
function showForm(item: any = null) { reset(item); open.value = true }
function clearRateSelection() { form.value.PayrollRateID = ''; form.value.BillingRateID = '' }
function clearFilters() { search.value = ''; clientFilter.value = ''; agencyFilter.value = ''; statusFilter.value = '' }

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    const response: any = await $fetch('/api/rates/site-rate')
    items.value = response.items || []
    sites.value = response.sites || []
    agencyPositions.value = response.agencyPositions || []
    payrollRates.value = response.payrollRates || []
    billingRates.value = response.billingRates || []
  } catch (cause: any) { error.value = cause.data?.statusMessage || 'Unable to load site rates.' }
  finally { if (!silent) loading.value = false }
}
async function save() {
  busy.value = true
  error.value = ''
  try {
    const body: any = { ...form.value }
    if (!editing.value && inlinePayroll.value) body.inlinePayrollRate = { ...inlinePayrollAmounts.value }
    if (!editing.value && inlineBilling.value) body.inlineBillingRate = { ...inlineBillingAmounts.value }
    await $fetch('/api/rates/site-rate', { method: editing.value ? 'PUT' : 'POST', body: editing.value ? { id: editing.value.SiteRateID, ...body } : body })
    open.value = false
    await load()
  } catch (cause: any) { error.value = cause.data?.statusMessage || 'Unable to save site rate.' }
  finally { busy.value = false }
}
async function deactivate(item: any) {
  if (!confirm('Mark this site rate as inactive?')) return
  try { await $fetch('/api/rates/site-rate', { method: 'DELETE', body: { id: item.SiteRateID } }); await load() }
  catch (cause: any) { error.value = cause.data?.statusMessage || 'Unable to deactivate site rate.' }
}

onMounted(load)
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !busy.value })
</script>

<template>
  <main class="site-rate-page">
    <header class="page-head">
      <div><p>RATES</p><h1>Site Rates</h1><small>Link payroll and billing rates to each site and region.</small></div>
      <button class="primary" type="button" @click="showForm()">+ Link site rate</button>
    </header>
    <p v-if="error && !open" class="error">{{ error }}</p>

    <section class="filters" aria-label="Site rate filters">
      <label class="search-field"><span>Search site rates</span><input v-model="search" type="search" placeholder="Search site, client, agency, position, or region"></label>
      <label><span>Client</span><select v-model="clientFilter"><option value="">All clients</option><option v-for="client in clients" :key="client.value" :value="client.value">{{ client.label }}</option></select></label>
      <label><span>Agency</span><select v-model="agencyFilter"><option value="">All agencies</option><option v-for="agency in agencies" :key="agency" :value="agency">{{ agency }}</option></select></label>
      <label><span>Status</span><select v-model="statusFilter"><option value="">All statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
    </section>
    <div class="list-summary"><span>{{ loading ? 'Loading site rates…' : `Showing ${filteredItems.length} of ${items.length} site rates` }}</span><button v-if="search || clientFilter || agencyFilter || statusFilter" type="button" @click="clearFilters">Clear filters</button></div>

    <div class="desktop-table">
      <table>
        <colgroup><col class="col-site"><col class="col-client"><col class="col-position"><col class="col-region"><col class="col-rate"><col class="col-rate"><col class="col-status"><col class="col-actions"></colgroup>
        <thead><tr><th>Site</th><th>Client</th><th>Agency position</th><th>Region</th><th>Payroll</th><th>Billing</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-if="loading" class="table-message"><td colspan="8">Loading site rates…</td></tr>
          <tr v-else-if="!filteredItems.length" class="table-message"><td colspan="8">No site rates match the current filters.</td></tr>
          <tr v-for="item in filteredItems" :key="item.SiteRateID">
            <td><strong>{{ item.SiteName }}</strong></td><td>{{ item.ClientName }}</td>
            <td><strong class="agency-name">{{ item.AgencyName }}</strong><small>{{ item.PositionName }}</small></td>
            <td>{{ item.RegionCode || item.RegionName || 'Not set' }}</td><td class="money">{{ formatMoney(item.PayrollRegularRate) }}</td><td class="money">{{ formatMoney(item.BillingRegularRate) }}</td>
            <td><span class="status-pill" :class="{ inactive: item.Status === 'Inactive' }">{{ item.Status }}</span></td>
            <td><div class="row-actions"><button type="button" @click="showForm(item)">Edit</button><button type="button" :disabled="item.Status === 'Inactive'" @click="deactivate(item)">Deactivate</button></div></td>
          </tr>
        </tbody>
      </table>
    </div>

    <section class="mobile-list" aria-label="Site rates">
      <p v-if="loading" class="mobile-message">Loading site rates…</p><p v-else-if="!filteredItems.length" class="mobile-message">No site rates match the current filters.</p>
      <article v-for="item in filteredItems" :key="item.SiteRateID" class="rate-card">
        <div class="rate-card__head"><div><strong>{{ item.SiteName }}</strong><span>{{ item.ClientName }}</span></div><span class="status-pill" :class="{ inactive: item.Status === 'Inactive' }">{{ item.Status }}</span></div>
        <dl><div><dt>Agency</dt><dd>{{ item.AgencyName }}</dd></div><div><dt>Position</dt><dd>{{ item.PositionName }}</dd></div><div><dt>Region</dt><dd>{{ item.RegionCode || item.RegionName || 'Not set' }}</dd></div></dl>
        <div class="rate-card__amounts"><span>Payroll<strong>{{ formatMoney(item.PayrollRegularRate) }}</strong></span><span>Billing<strong>{{ formatMoney(item.BillingRegularRate) }}</strong></span></div>
        <footer><button type="button" @click="showForm(item)">Edit</button><button type="button" :disabled="item.Status === 'Inactive'" @click="deactivate(item)">Deactivate</button></footer>
      </article>
    </section>

    <Teleport to="body"><div v-if="open" class="backdrop" @click.self="!busy && (open = false)"><form class="modal" @submit.prevent="save">
      <button class="close" type="button" aria-label="Close" @click="open = false">×</button>
      <div class="modal-heading"><p class="eyebrow">SITE RATE</p><h2>{{ editing ? 'Edit site rate' : 'Link site rate' }}</h2><span>Search and select the site and agency position, then link the matching regional rates.</span></div>
      <div class="selection-grid">
        <SearchableSelect v-model="form.SiteID" label="Site" :options="siteOptions" placeholder="Search site, client, or region" required empty-text="No active sites with a region found." @change="clearRateSelection" />
        <SearchableSelect v-model="form.AgencyPositionID" label="Agency position" :options="agencyPositionOptions" placeholder="Search agency or position" required @change="clearRateSelection" />
      </div>
      <div v-if="selectedSite" class="site-context"><span><small>CLIENT</small><strong>{{ selectedSite.ClientName }}</strong></span><span><small>REGION</small><strong>{{ selectedSite.RegionCode || selectedSite.RegionName }}</strong></span></div>
      <div v-if="form.SiteID && form.AgencyPositionID" class="rate-grid">
        <section class="rate-panel">
          <div class="rate-panel__head"><span>Payroll rate</span><small>{{ selectedSite?.RegionName }}</small></div>
          <label class="control-label"><span>Existing rate</span><select v-model="form.PayrollRateID" :disabled="inlinePayroll" :required="!inlinePayroll"><option value="">Select payroll rate</option><option v-for="rate in filteredPayroll" :key="rate.PayrollRateID" :value="rate.PayrollRateID">{{ rateLabel(rate) }}</option></select></label>
          <p v-if="!inlinePayroll && !filteredPayroll.length" class="empty-rate">No matching active payroll rate. Create one below.</p>
          <label v-if="!editing" class="toggle"><input v-model="inlinePayroll" type="checkbox"> Create a payroll rate for this region</label>
          <fieldset v-if="inlinePayroll && !editing" class="inline-rates"><legend>Payroll amounts</legend><RateMoneyFields v-model="inlinePayrollAmounts" /></fieldset>
          <details v-else-if="selectedPayroll" class="rate-preview"><summary>View all payroll amounts</summary><dl><div v-for="field in rateMoneyFields" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ formatMoney(selectedPayroll[field.key]) }}</dd></div></dl></details>
        </section>
        <section class="rate-panel">
          <div class="rate-panel__head"><span>Billing rate</span><small>{{ selectedSite?.RegionName }}</small></div>
          <label class="control-label"><span>Existing rate</span><select v-model="form.BillingRateID" :disabled="inlineBilling" :required="!inlineBilling"><option value="">Select billing rate</option><option v-for="rate in filteredBilling" :key="rate.BillingRateID" :value="rate.BillingRateID">{{ rateLabel(rate) }}</option></select></label>
          <p v-if="!inlineBilling && !filteredBilling.length" class="empty-rate">No matching active billing rate. Create one below.</p>
          <label v-if="!editing" class="toggle"><input v-model="inlineBilling" type="checkbox"> Create a billing rate for this region</label>
          <fieldset v-if="inlineBilling && !editing" class="inline-rates"><legend>Billing amounts</legend><RateMoneyFields v-model="inlineBillingAmounts" /></fieldset>
          <details v-else-if="selectedBilling" class="rate-preview"><summary>View all billing amounts</summary><dl><div v-for="field in rateMoneyFields" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ formatMoney(selectedBilling[field.key]) }}</dd></div></dl></details>
        </section>
      </div>
      <label class="status-control"><span>Status</span><select v-model="form.Status"><option>Active</option><option>Inactive</option></select></label>
      <p v-if="error" class="error modal-error">{{ error }}</p>
      <footer class="modal-footer"><button type="button" @click="open = false">Cancel</button><button class="primary" :disabled="busy">{{ busy ? 'Saving…' : editing ? 'Save changes' : 'Save link' }}</button></footer>
    </form></div></Teleport>
  </main>
</template>

<style scoped>
.site-rate-page{box-sizing:border-box;width:100%;max-width:1500px;margin:auto;padding:32px;color:#172033;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:24px}.page-head p,.eyebrow{margin:0;color:#3465d9;font-size:.75rem;font-weight:800;letter-spacing:.08em}.page-head h1{margin:3px 0;font-size:1.7rem}.page-head small{color:#64748b}.primary{min-height:42px;border:0;border-radius:9px;background:#2563eb!important;color:#fff!important;padding:10px 16px;font:inherit;font-weight:800;cursor:pointer}.primary:disabled{opacity:.6;cursor:wait}.error{margin:0 0 14px;color:#b42318}.filters{display:grid;grid-template-columns:minmax(280px,2fr) repeat(3,minmax(150px,.7fr));align-items:end;gap:12px;margin-bottom:12px}.filters label,.control-label,.status-control{display:grid;min-width:0;gap:6px}.filters label>span,.control-label>span,.status-control>span{color:#475569;font-size:.78rem;font-weight:800}.filters input,.filters select,.modal select{box-sizing:border-box;width:100%;min-width:0;min-height:42px;border:1px solid #cbd6e5;border-radius:9px;padding:8px 11px;background:#fff;color:#172033;font:inherit}.list-summary{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 1px 10px;color:#64748b;font-size:.78rem}.list-summary button{border:0;background:transparent;color:#2458c4;font:inherit;font-weight:800;cursor:pointer}.desktop-table{overflow:hidden;border:1px solid #dfe5ef;border-radius:12px;background:#fff}table{width:100%;border-collapse:collapse;table-layout:fixed}.col-site{width:12%}.col-client{width:17%}.col-position{width:25%}.col-region{width:10%}.col-rate{width:10%}.col-status{width:8%}.col-actions{width:154px}th,td{min-width:0;padding:10px 12px;border-bottom:1px solid #edf1f6;text-align:left;vertical-align:middle;font-size:.82rem;overflow-wrap:break-word}th{padding-top:11px;padding-bottom:11px;background:#f8fafc;color:#526174;font-size:.69rem;text-transform:uppercase;letter-spacing:.025em}tbody tr:last-child td{border-bottom:0}td strong,td small{display:block}.agency-name{font-size:.8rem}.agency-name+small{margin-top:2px;color:#64748b;font-size:.73rem}.money{font-variant-numeric:tabular-nums;font-weight:750;white-space:nowrap}.table-message td{padding:22px;text-align:center;color:#64748b}.status-pill{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;background:#dcfce7;color:#147a3d;font-size:.69rem;font-weight:800}.status-pill.inactive{background:#f1f5f9;color:#64748b}.row-actions{display:flex;gap:6px}.row-actions button,.rate-card footer button,.modal-footer>button{min-height:34px;border:1px solid #cbd6e5;border-radius:8px;padding:6px 9px;background:#fff;color:#29486e;font:inherit;font-size:.75rem;font-weight:800;cursor:pointer}.row-actions button:disabled,.rate-card footer button:disabled{opacity:.45;cursor:not-allowed}.mobile-list{display:none}.backdrop{position:fixed;inset:0;z-index:300;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.58)}.modal{box-sizing:border-box;position:relative;display:grid;width:min(100%,980px);max-height:calc(100dvh - 36px);gap:14px;padding:24px;overflow:auto;border:1px solid #d9e2ef;border-radius:16px;background:#fff;color:#172033;box-shadow:0 24px 70px rgba(15,23,42,.3);font-family:Inter,system-ui,sans-serif}.close{position:absolute;z-index:3;top:12px;right:12px;display:grid;width:34px;height:34px;place-items:center;border:0;border-radius:8px;background:transparent;color:#53657d;font-size:1.35rem;cursor:pointer}.close:hover{background:#edf3fa}.modal-heading{padding-right:38px}.modal-heading h2{margin:3px 0 4px;font-size:1.45rem}.modal-heading>span{color:#64748b;font-size:.8rem}.selection-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.selection-grid :deep(.searchable-select>label){margin-bottom:6px;font-size:.78rem;font-weight:800}.selection-grid :deep(.searchable-select>input){min-height:42px;border-radius:9px}.site-context{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:10px 12px;border:1px solid #dae4f2;border-radius:10px;background:#f5f8fd}.site-context span{display:grid;min-width:0;gap:2px}.site-context small{color:#71809a;font-size:.63rem;font-weight:900;letter-spacing:.04em}.site-context strong{overflow:hidden;color:#172033;font-size:.8rem;text-overflow:ellipsis;white-space:nowrap}.rate-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:12px}.rate-panel{display:grid;min-width:0;gap:10px;padding:14px;border:1px solid #dfe5ef;border-radius:11px;background:#fbfcfe}.rate-panel__head{display:flex;justify-content:space-between;align-items:center;gap:10px}.rate-panel__head>span{color:#17375f;font-size:.9rem;font-weight:850}.rate-panel__head small{color:#64748b;font-size:.7rem}.toggle{display:flex;align-items:center;gap:8px;color:#435873;font-size:.75rem;font-weight:750;cursor:pointer}.toggle input{width:16px;height:16px;margin:0;accent-color:#2563eb}.empty-rate{margin:-2px 0 0;color:#9a6700;font-size:.72rem}.inline-rates{min-width:0;margin:0;padding:12px;border:1px solid #dfe5ef;border-radius:9px;background:#fff}.inline-rates legend{padding:0 5px;color:#334155;font-size:.76rem;font-weight:800}.inline-rates :deep(.rate-money-grid){grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.inline-rates :deep(.rate-money-grid label){font-size:.72rem}.inline-rates :deep(.rate-money-grid input){min-height:37px}.rate-preview{padding:10px;border:1px solid #dfe5ef;border-radius:8px;background:#fff;font-size:.75rem}.rate-preview summary{cursor:pointer;color:#2563eb;font-weight:800}.rate-preview dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 12px;margin-bottom:0}.rate-preview dl>div{display:flex;justify-content:space-between;gap:8px;padding-bottom:4px;border-bottom:1px solid #edf1f6}.rate-preview dt{color:#64748b}.rate-preview dd{margin:0;font-weight:750}.status-control{width:min(100%,240px)}.modal-error{margin:0;padding:9px 11px;border:1px solid #fecaca;border-radius:8px;background:#fff7f7;font-size:.78rem}.modal-footer{position:sticky;bottom:-24px;display:flex;justify-content:flex-end;gap:8px;margin:0 -24px -24px;padding:12px 24px;border-top:1px solid #e3e9f1;background:rgba(255,255,255,.97);backdrop-filter:blur(8px)}.modal-footer>button{min-height:40px;padding:8px 15px;font-size:.8rem}.rate-card,.mobile-message{border:1px solid #dce3ee;border-radius:13px;background:#fff;box-shadow:0 4px 14px rgba(30,54,85,.045)}.mobile-message{margin:0;padding:20px;text-align:center;color:#607089}.rate-card{overflow:hidden}.rate-card__head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:12px 14px;border-bottom:1px solid #edf1f6}.rate-card__head>div{display:grid;min-width:0;gap:3px}.rate-card__head strong{color:#17375f;font-size:.92rem}.rate-card__head div span{overflow:hidden;color:#64748b;font-size:.73rem;text-overflow:ellipsis;white-space:nowrap}.rate-card dl{display:grid;gap:7px;margin:0;padding:11px 14px}.rate-card dl>div{display:grid;grid-template-columns:78px minmax(0,1fr);gap:8px}.rate-card dt{color:#64748b;font-size:.67rem;font-weight:850;text-transform:uppercase}.rate-card dd{margin:0;color:#334155;font-size:.78rem}.rate-card__amounts{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:0 14px 12px}.rate-card__amounts span{display:grid;gap:3px;padding:9px;border-radius:8px;background:#f4f7fc;color:#64748b;font-size:.65rem;font-weight:800;text-transform:uppercase}.rate-card__amounts strong{color:#17375f;font-size:.86rem;font-variant-numeric:tabular-nums}.rate-card footer{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:10px 14px;border-top:1px solid #edf1f6;background:#fbfcfe}.rate-card footer button{min-height:38px}
@media(max-width:1100px){.filters{grid-template-columns:minmax(260px,2fr) repeat(3,minmax(130px,1fr))}.col-client{width:15%}.col-position{width:23%}.col-actions{width:145px}th,td{padding-right:9px;padding-left:9px}}
@media(max-width:900px){.site-rate-page{padding:22px 18px}.desktop-table{display:none}.mobile-list{display:grid;gap:10px}.filters{grid-template-columns:repeat(2,minmax(0,1fr))}.search-field{grid-column:1/-1}.rate-grid{grid-template-columns:1fr}.modal{width:min(100%,720px)}}
@media(max-width:600px){.site-rate-page{padding:16px 12px}.page-head{align-items:stretch;flex-direction:column;margin-bottom:18px}.page-head .primary{width:100%}.filters{grid-template-columns:1fr;gap:9px}.search-field{grid-column:auto}.list-summary{align-items:flex-start;flex-direction:column;gap:5px}.backdrop{align-items:end;padding:0}.modal{width:100%;max-height:calc(100dvh - 10px);gap:12px;padding:20px 14px;border-radius:16px 16px 0 0}.selection-grid{grid-template-columns:1fr}.site-context{grid-template-columns:1fr}.site-context strong{white-space:normal}.rate-panel{padding:12px}.inline-rates :deep(.rate-money-grid),.rate-preview dl{grid-template-columns:1fr}.status-control{width:100%}.modal-footer{bottom:-20px;display:grid;grid-template-columns:1fr 1fr;margin:0 -14px -20px;padding:11px 14px}.modal-footer>button{width:100%}}
@media(max-width:360px){.rate-card dl>div{grid-template-columns:1fr;gap:2px}.rate-card__amounts{grid-template-columns:1fr}.modal-footer{grid-template-columns:1fr}}
</style>
