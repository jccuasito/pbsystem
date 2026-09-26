<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import RateMoneyFields from './RateMoneyFields.vue'
import { emptyRateAmounts, rateFormFields as rateMoneyFields } from '~~/shared/utils/rateFields'

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

const selectedSite = computed(() => sites.value.find(site => Number(site.SiteID) === Number(form.value.SiteID)) || null)
const matchesSiteRegion = (rate: any) => Number(rate.RegionID) === Number(selectedSite.value?.RegionID)
const filteredPayroll = computed(() => payrollRates.value.filter(rate => Number(rate.AgencyPositionID) === Number(form.value.AgencyPositionID) && rate.Status === 'Active' && matchesSiteRegion(rate)))
const filteredBilling = computed(() => billingRates.value.filter(rate => Number(rate.AgencyPositionID) === Number(form.value.AgencyPositionID) && rate.Status === 'Active' && matchesSiteRegion(rate)))
const selectedPayroll = computed(() => payrollRates.value.find(rate => Number(rate.PayrollRateID) === Number(form.value.PayrollRateID)))
const selectedBilling = computed(() => billingRates.value.find(rate => Number(rate.BillingRateID) === Number(form.value.BillingRateID)))

function rateLabel(rate: any) { return `₱${Number(rate.RegularRate || 0).toFixed(2)} · ${rate.EffectiveDate || 'No effective date'}` }
function siteLabel(site: any) { return `${site.ClientName} — ${site.SiteName}${site.RegionName ? ` · ${site.RegionName}` : ' · Region not set'}` }
function reset(item: any = null) {
  editing.value = item
  form.value = { SiteID: item?.SiteID ?? '', AgencyPositionID: item?.AgencyPositionID ?? '', PayrollRateID: item?.PayrollRateID ?? '', BillingRateID: item?.BillingRateID ?? '', Status: item?.Status ?? 'Active' }
  inlinePayroll.value = false
  inlineBilling.value = false
  inlinePayrollAmounts.value = emptyRateAmounts()
  inlineBillingAmounts.value = emptyRateAmounts()
  error.value = ''
}
function clearRateSelection() { form.value.PayrollRateID = ''; form.value.BillingRateID = '' }
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
  busy.value = true; error.value = ''
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
    <header><div><p>RATES</p><h1>Site Rates</h1><small>Link payroll and billing rates to each site and region.</small></div><button class="primary" @click="reset(); open = true">+ Link site rate</button></header>
    <p v-if="error && !open" class="error">{{ error }}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Site</th><th>Client</th><th>Agency position</th><th>Region</th><th>Payroll regular</th><th>Billing regular</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        <tr v-if="loading"><td colspan="8">Loading…</td></tr>
        <tr v-else-if="!items.length"><td colspan="8">No site rates found.</td></tr>
        <tr v-for="item in items" :key="item.SiteRateID">
          <td data-label="Site"><strong>{{ item.SiteName }}</strong></td>
          <td data-label="Client">{{ item.ClientName }}</td><td data-label="Agency position">{{ item.AgencyName }} — {{ item.PositionName }}</td><td data-label="Region">{{ item.RegionName || 'Set site region' }}</td>
          <td data-label="Payroll regular">₱{{ Number(item.PayrollRegularRate || 0).toFixed(2) }}</td><td data-label="Billing regular">₱{{ Number(item.BillingRegularRate || 0).toFixed(2) }}</td><td data-label="Status">{{ item.Status }}</td>
          <td data-label="Actions"><button @click="reset(item); open = true">Edit</button><button :disabled="item.Status === 'Inactive'" @click="deactivate(item)">Deactivate</button></td>
        </tr>
      </tbody>
    </table></div>

    <Teleport to="body"><div v-if="open" class="backdrop" @click.self="!busy && (open = false)"><form class="modal" @submit.prevent="save">
      <button class="close" type="button" @click="open = false">×</button><div><p class="eyebrow">SITE RATE</p><h2>{{ editing ? 'Edit site rate' : 'Link site rate' }}</h2></div>
      <label>Site<select v-model="form.SiteID" required @change="clearRateSelection"><option value="">Select site</option><option v-for="site in sites" :key="site.SiteID" :value="site.SiteID" :disabled="!site.RegionID">{{ siteLabel(site) }}</option></select></label>
      <div v-if="selectedSite" class="site-context"><span>CLIENT<strong>{{ selectedSite.ClientName }}</strong></span><span>REGION<strong>{{ selectedSite.RegionCode || selectedSite.RegionName }}</strong></span></div>
      <label>Agency position<select v-model="form.AgencyPositionID" required @change="clearRateSelection"><option value="">Select agency position</option><option v-for="position in agencyPositions" :key="position.AgencyPositionID" :value="position.AgencyPositionID">{{ position.AgencyName }} — {{ position.PositionName }}</option></select></label>
      <template v-if="form.SiteID && form.AgencyPositionID">
        <label>Payroll rate<select v-model="form.PayrollRateID" :disabled="inlinePayroll" :required="!inlinePayroll"><option value="">Select rate for {{ selectedSite?.RegionName }}</option><option v-for="rate in filteredPayroll" :key="rate.PayrollRateID" :value="rate.PayrollRateID">{{ rateLabel(rate) }}</option></select></label>
        <label v-if="!editing" class="toggle"><input v-model="inlinePayroll" type="checkbox"> Create payroll rate for this site region</label>
        <fieldset v-if="inlinePayroll && !editing" class="inline-rates"><legend>Payroll amounts</legend><RateMoneyFields v-model="inlinePayrollAmounts" /></fieldset>
        <details v-else-if="selectedPayroll" class="rate-preview"><summary>View payroll amounts</summary><dl><div v-for="field in rateMoneyFields" :key="field.key"><dt>{{ field.label }}</dt><dd>₱{{ Number(selectedPayroll[field.key] || 0).toFixed(2) }}</dd></div></dl></details>
        <label>Billing rate<select v-model="form.BillingRateID" :disabled="inlineBilling" :required="!inlineBilling"><option value="">Select rate for {{ selectedSite?.RegionName }}</option><option v-for="rate in filteredBilling" :key="rate.BillingRateID" :value="rate.BillingRateID">{{ rateLabel(rate) }}</option></select></label>
        <label v-if="!editing" class="toggle"><input v-model="inlineBilling" type="checkbox"> Create billing rate for this site region</label>
        <fieldset v-if="inlineBilling && !editing" class="inline-rates"><legend>Billing amounts</legend><RateMoneyFields v-model="inlineBillingAmounts" /></fieldset>
        <details v-else-if="selectedBilling" class="rate-preview"><summary>View billing amounts</summary><dl><div v-for="field in rateMoneyFields" :key="field.key"><dt>{{ field.label }}</dt><dd>₱{{ Number(selectedBilling[field.key] || 0).toFixed(2) }}</dd></div></dl></details>
      </template>
      <label>Status<select v-model="form.Status"><option>Active</option><option>Inactive</option></select></label><p v-if="error" class="error">{{ error }}</p>
      <footer><button type="button" @click="open = false">Cancel</button><button class="primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save link' }}</button></footer>
    </form></div></Teleport>
  </main>
</template>

<style scoped>
.site-rate-page{padding:32px;max-width:1400px;margin:auto;color:#172033;font-family:Inter,system-ui,sans-serif}.site-rate-page header{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:24px}.site-rate-page header p,.eyebrow{margin:0;color:#3465d9;font-size:.75rem;font-weight:800;letter-spacing:.08em}.site-rate-page h1{margin:3px 0;font-size:1.7rem}.site-rate-page header small{color:#64748b}.primary{border:0;border-radius:8px;background:#2563eb!important;color:#fff!important;padding:10px 15px;font-weight:700;cursor:pointer}.table-wrap{overflow:auto;border:1px solid #dfe5ef;border-radius:10px}table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:13px 14px;text-align:left;border-bottom:1px solid #edf1f6;font-size:.88rem;white-space:nowrap}th{background:#f8fafc;color:#526174;font-size:.75rem;text-transform:uppercase}td strong,td span{display:block}td button,footer button{border:1px solid #cfd8e6;background:#fff;border-radius:6px;padding:6px 9px;margin-right:6px;cursor:pointer}.error{color:#b42318}.backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px}.modal{box-sizing:border-box;font-family:Inter,system-ui,sans-serif;color:#172033;position:relative;width:min(100%,820px);max-height:90vh;overflow:auto;background:#fff;border-radius:12px;padding:26px;display:grid;gap:12px}.modal h2{margin:3px 0 0}.modal label{display:grid;gap:5px;font-size:.8rem;font-weight:700;color:#475569}.modal input,.modal select{min-height:40px;border:1px solid #cfd8e6;border-radius:7px;padding:8px;font:inherit}.site-context{display:flex;gap:28px;padding:12px 14px;background:#f4f7fc;border-radius:8px}.site-context span{display:grid;gap:3px;color:#71809a;font-size:.67rem;font-weight:800}.site-context strong{color:#172033;font-size:.86rem}.toggle{display:flex!important;grid-template-columns:auto 1fr;align-items:center;gap:8px}.inline-rates{min-width:0;padding:14px;border:1px solid #dfe5ef;border-radius:8px;margin:0}.inline-rates legend{font-size:.85rem;font-weight:700;color:#334155;padding:0 6px}.rate-preview{font-size:.8rem;border:1px solid #dfe5ef;border-radius:8px;padding:12px}.rate-preview summary{cursor:pointer;color:#2563eb;font-weight:700}.rate-preview dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.rate-preview dl>div{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #edf1f6;padding-bottom:5px}.rate-preview dd{margin:0;font-weight:700}.close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.5rem;cursor:pointer}.modal footer{display:flex;justify-content:flex-end;margin-top:6px}@media(max-width:700px){.site-rate-page{padding:18px}.site-rate-page header{align-items:stretch;flex-direction:column}.site-rate-page header .primary{width:100%}.modal{padding:22px 16px}.rate-preview dl{grid-template-columns:1fr}.site-context{flex-direction:column;gap:8px}.table-wrap{border:0;overflow:visible}table,tbody,tr,td{display:block;width:100%;box-sizing:border-box}thead{display:none}tbody{display:grid;gap:12px}tr{border:1px solid #dfe5ef;border-radius:10px;background:#fff;padding:10px 14px}td{display:grid;grid-template-columns:112px minmax(0,1fr);gap:8px;white-space:normal;border:0;padding:7px 0}td::before{content:attr(data-label);color:#64748b;font-size:.68rem;font-weight:800;text-transform:uppercase}td[colspan]{display:block}}
</style>
