<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import ModernDateField from '~~/components/ModernDateField.vue'

type Plan = { AgencyContributionID: number; AgencyID: number; AgencyName: string; SiteRateID: number | null; SiteID: number | null; SiteName: string | null; PositionName: string | null; RegularRate: number | null; DeductionTypeID: number; DeductionName: string; ClassificationName: string; AmountPerCutoff: number; DeductOn: 'First' | 'Second' | 'Both'; EffectiveStartDate: string; EffectiveEndDate: string | null; Status: 'Active' | 'Inactive' }
type Lookup = { AgencyID: number; AgencyName: string }
type SiteRate = { SiteRateID: number; SiteID: number; SiteName: string; AgencyID: number; PositionName: string; RegularRate: number }
type Catalog = { DeductionTypeID: number; DeductionName: string; ClassificationName: string }
const plans = ref<Plan[]>([])
const agencies = ref<Lookup[]>([])
const siteRates = ref<SiteRate[]>([])
const catalog = ref<Catalog[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const modalError = ref('')
const search = ref('')
const agencyFilter = ref('')
const siteFilter = ref('')
const statusFilter = ref('Active')
const modalOpen = ref(false)
const form = reactive({ AgencyContributionID: 0, AgencyID: '', SiteID: '', SiteRateID: '', DeductionTypeID: '', AmountPerCutoff: '', DeductOn: 'Second' as Plan['DeductOn'], EffectiveStartDate: '', EffectiveEndDate: '', Status: 'Active' as Plan['Status'] })
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0))
const date = (value: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No end date'
const cutoff = (value: Plan['DeductOn']) => value === 'First' ? '1st cutoff' : value === 'Second' ? '2nd cutoff' : 'Both cutoffs'
const filterSites = computed(() => [...new Map(siteRates.value.filter(rate =>
  !agencyFilter.value || String(rate.AgencyID) === agencyFilter.value
).map(rate => [rate.SiteID, rate.SiteName])).entries()].map(([id, name]) => ({ id, name })))
const formSites = computed(() => [...new Map(siteRates.value.filter(rate =>
  String(rate.AgencyID) === form.AgencyID
).map(rate => [rate.SiteID, rate.SiteName])).entries()].map(([id, name]) => ({ id, name })))
const formRates = computed(() => siteRates.value.filter(rate =>
  String(rate.AgencyID) === form.AgencyID && String(rate.SiteID) === form.SiteID
))
const visible = computed(() => plans.value.filter(item =>
  (!agencyFilter.value || String(item.AgencyID) === agencyFilter.value) &&
  (!siteFilter.value || String(item.SiteID) === siteFilter.value) &&
  (!statusFilter.value || item.Status === statusFilter.value) &&
  (!search.value.trim() || `${item.AgencyName} ${item.SiteName || ''} ${item.PositionName || ''} ${item.ClassificationName} ${item.DeductionName}`.toLowerCase().includes(search.value.trim().toLowerCase()))
))
function changeAgency() { form.SiteID = ''; form.SiteRateID = '' }
function changeSite() { form.SiteRateID = '' }
function changeAgencyFilter() { siteFilter.value = '' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await $fetch<{ items: Plan[]; agencies: Lookup[]; siteRates: SiteRate[]; catalogItems: Catalog[] }>('/api/deductions-loans/agency-contributions')
    plans.value = result.items || []
    agencies.value = result.agencies || []
    siteRates.value = result.siteRates || []
    catalog.value = result.catalogItems || []
  } catch (cause: any) {
    error.value = cause?.data?.statusMessage || 'Unable to load agency contributions.'
  } finally {
    loading.value = false
  }
}

function openPlan(item?: Plan) {
  Object.assign(form, item ? {
    AgencyContributionID: item.AgencyContributionID, AgencyID: String(item.AgencyID), SiteID: item.SiteID ? String(item.SiteID) : '',
    SiteRateID: item.SiteRateID ? String(item.SiteRateID) : '', DeductionTypeID: String(item.DeductionTypeID),
    AmountPerCutoff: String(item.AmountPerCutoff), DeductOn: item.DeductOn, EffectiveStartDate: item.EffectiveStartDate,
    EffectiveEndDate: item.EffectiveEndDate || '', Status: item.Status,
  } : { AgencyContributionID: 0, AgencyID: agencyFilter.value || '', SiteID: siteFilter.value || '', SiteRateID: '', DeductionTypeID: '', AmountPerCutoff: '',
    DeductOn: 'Second', EffectiveStartDate: today(), EffectiveEndDate: '', Status: 'Active' })
  modalError.value = ''
  modalOpen.value = true
}

async function savePlan() {
  if (saving.value) return
  if (!form.EffectiveStartDate) {
    modalError.value = 'Select an effective start date.'
    return
  }
  if (form.EffectiveEndDate && form.EffectiveEndDate < form.EffectiveStartDate) {
    modalError.value = 'Effective end date must be on or after the start date.'
    return
  }
  if (!formRates.value.some(rate => String(rate.SiteRateID) === form.SiteRateID)) {
    modalError.value = 'Select a site and its position/rate.'
    return
  }
  saving.value = true
  modalError.value = ''
  try {
    await $fetch('/api/deductions-loans/agency-contributions', {
      method: form.AgencyContributionID ? 'PUT' : 'POST',
      body: { ...form, AgencyID: Number(form.AgencyID), SiteRateID: Number(form.SiteRateID), DeductionTypeID: Number(form.DeductionTypeID),
        AmountPerCutoff: Number(form.AmountPerCutoff), EffectiveEndDate: form.EffectiveEndDate || null },
    })
    modalOpen.value = false
    await load()
  } catch (cause: any) {
    modalError.value = cause?.data?.statusMessage || 'Unable to save contribution plan.'
  } finally {
    saving.value = false
  }
}

async function deactivate(item: Plan) {
  if (!window.confirm(`Deactivate ${item.DeductionName} for ${item.AgencyName}?`)) return
  error.value = ''
  try {
    await $fetch('/api/deductions-loans/agency-contributions', { method: 'DELETE', body: { AgencyContributionID: item.AgencyContributionID } })
    await load()
  } catch (cause: any) {
    error.value = cause?.data?.statusMessage || 'Unable to deactivate contribution plan.'
  }
}

onMounted(load)
</script>

<template>
  <section class="contributions-page">
    <header class="page-head">
      <div>
        <span class="eyebrow">DEDUCTIONS &amp; LOANS</span>
        <h1>Contributions</h1>
        <p>Set contribution amounts by agency, site, and position.</p>
      </div>
      <button class="primary" type="button" @click="openPlan()">+ Add contribution</button>
    </header>
    <div class="info">Each plan applies only to fixed employees assigned to the selected site position/rate. Review or skip an employee's contribution in Payroll Processing before finalizing.</div>
    <div class="filters">
      <label class="search-field">Search<input v-model="search" type="search" placeholder="Search agency, site, position, or contribution"></label>
      <label>Agency<select v-model="agencyFilter" @change="changeAgencyFilter"><option value="">All agencies</option><option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option></select></label>
      <label>Site<select v-model="siteFilter"><option value="">All sites</option><option v-for="site in filterSites" :key="site.id" :value="String(site.id)">{{ site.name }}</option></select></label>
      <label>Status<select v-model="statusFilter"><option value="Active">Active</option><option value="Inactive">Inactive</option><option value="">All statuses</option></select></label>
    </div>
    <p class="list-count">Showing {{ visible.length }} contribution {{ visible.length === 1 ? 'plan' : 'plans' }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Agency</th><th>Site / position</th><th>Contribution</th><th>Amount per employee</th><th>Cutoff</th><th>Effective dates</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-for="item in visible" :key="item.AgencyContributionID">
            <td><strong>{{ item.AgencyName }}</strong></td>
            <td><strong>{{ item.SiteName || 'Site not assigned' }}</strong><small>{{ item.PositionName || 'Edit this plan to assign a position' }}<template v-if="item.RegularRate !== null"> · {{ money(item.RegularRate) }} regular rate</template></small></td>
            <td><strong>{{ item.DeductionName }}</strong><small>{{ item.ClassificationName }}</small></td>
            <td>{{ money(item.AmountPerCutoff) }}</td>
            <td>{{ cutoff(item.DeductOn) }}</td>
            <td>{{ date(item.EffectiveStartDate) }}<small>to {{ date(item.EffectiveEndDate) }}</small></td>
            <td><span class="status" :class="item.Status.toLowerCase()">{{ item.Status }}</span></td>
            <td><div class="actions"><button type="button" @click="openPlan(item)">Edit</button><button v-if="item.Status === 'Active'" type="button" @click="deactivate(item)">Deactivate</button></div></td>
          </tr>
          <tr v-if="!visible.length"><td colspan="8" class="empty">{{ loading ? 'Loading contribution plans...' : 'No contribution plans match the filters.' }}</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="modalOpen" class="modal-backdrop" @click.self="!saving && (modalOpen=false)">
      <form class="plan-modal" @submit.prevent="savePlan">
        <button class="close" type="button" aria-label="Close" :disabled="saving" @click="modalOpen=false">×</button>
        <header><span class="eyebrow">SITE CONTRIBUTION</span><h2>{{ form.AgencyContributionID ? 'Edit contribution' : 'Add contribution' }}</h2><p>Select the agency, site, and position/rate this amount belongs to.</p></header>
        <div class="form-grid">
          <label>Agency<select v-model="form.AgencyID" required @change="changeAgency"><option disabled value="">Select agency</option><option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option></select></label>
          <label>Site<select v-model="form.SiteID" required :disabled="!form.AgencyID" @change="changeSite"><option disabled value="">Select site</option><option v-for="site in formSites" :key="site.id" :value="String(site.id)">{{ site.name }}</option></select></label>
          <label>Position / site rate<select v-model="form.SiteRateID" required :disabled="!form.SiteID"><option disabled value="">Select position</option><option v-for="rate in formRates" :key="rate.SiteRateID" :value="String(rate.SiteRateID)">{{ rate.PositionName }} · {{ money(rate.RegularRate) }} regular rate</option></select></label>
          <label>Contribution<select v-model="form.DeductionTypeID" required><option disabled value="">Select contribution</option><option v-for="item in catalog" :key="item.DeductionTypeID" :value="String(item.DeductionTypeID)">{{ item.ClassificationName }} · {{ item.DeductionName }}</option></select></label>
          <label>Amount per employee / cutoff<input v-model="form.AmountPerCutoff" type="number" min="0.01" max="99999999.99" step="0.01" placeholder="0.00" required></label>
          <label>Deduct every<select v-model="form.DeductOn" required><option value="First">1st cutoff (days 1–15)</option><option value="Second">2nd cutoff (days 16–month end)</option><option value="Both">Both cutoffs</option></select></label>
          <ModernDateField v-model="form.EffectiveStartDate" label="Effective start" required />
          <ModernDateField v-model="form.EffectiveEndDate" label="Effective end (optional)" />
          <label>Status<select v-model="form.Status"><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
        </div>
        <p v-if="modalError" class="error" role="alert">{{ modalError }}</p>
        <footer><button type="button" :disabled="saving" @click="modalOpen=false">Cancel</button><button class="primary" :disabled="saving">{{ saving ? 'Saving...' : 'Save contribution' }}</button></footer>
      </form>
    </div>
  </section>
</template>

<style scoped>
.contributions-page{max-width:1650px;margin:auto;padding:32px;color:#0d2852;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:20px}.eyebrow{color:#2860dd;font-size:.74rem;font-weight:800;letter-spacing:.08em}.page-head h1{font-size:2rem;margin:6px 0}.page-head p,.plan-modal header p{margin:0;color:#62799e}.primary{border:0;border-radius:9px;background:#2563eb;color:#fff;padding:13px 18px;font:inherit;font-weight:750;cursor:pointer}.primary:disabled{opacity:.6;cursor:wait}.info{border-left:3px solid #7ca7fc;background:#edf3ff;border-radius:7px;padding:14px 17px;color:#315684;line-height:1.5;margin-bottom:24px}.filters{display:grid;grid-template-columns:minmax(240px,2fr) minmax(190px,1fr) minmax(150px,.8fr);gap:14px;align-items:end}.filters label,.form-grid label{display:grid;gap:7px;font-size:.78rem;font-weight:750;color:#425b80}.filters input,.filters select,.form-grid input,.form-grid select{box-sizing:border-box;width:100%;min-height:48px;border:1px solid #cbd8ef;border-radius:9px;padding:10px 13px;background:#fff;color:#0d2852;font:inherit;font-size:.9rem}.list-count{margin:16px 0 10px;color:#6480a5;font-size:.82rem}.table-wrap{overflow-x:auto;border:1px solid #dce5f4;border-radius:12px;background:#fff}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:15px 14px;border-bottom:1px solid #e8eef7;white-space:nowrap;font-size:.86rem}th{background:#f4f7fc;color:#526d92;text-transform:uppercase;font-size:.68rem}td strong,td small{display:block}td small{color:#7188a8;margin-top:4px}.status{display:inline-block;border-radius:999px;padding:5px 11px;font-size:.72rem;font-weight:800}.status.active{background:#d9fbe7;color:#087940}.status.inactive{background:#edf0f5;color:#586b84}.actions{display:flex;gap:7px}.actions button,.plan-modal footer button:not(.primary){border:1px solid #c9d7ec;border-radius:8px;background:#fff;padding:8px 12px;color:#24538d;font:inherit;font-weight:700;cursor:pointer}.empty{text-align:center;color:#7188a8;padding:34px}.error{color:#b42318;background:#fff4f2;padding:11px 14px;border-radius:8px}.modal-backdrop{position:fixed;inset:0;z-index:500;display:grid;place-items:center;padding:20px;background:rgba(12,28,61,.55)}.plan-modal{position:relative;box-sizing:border-box;width:min(800px,100%);max-height:calc(100dvh - 40px);overflow:auto;border:1px solid #dce5f4;border-radius:17px;padding:30px;background:#fff;box-shadow:0 25px 80px rgba(11,28,60,.28)}.plan-modal h2{margin:6px 0;font-size:1.65rem}.close{position:absolute;top:16px;right:17px;border:0;background:transparent;color:#527098;font-size:1.5rem;cursor:pointer}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:17px;margin-top:26px}.plan-modal footer{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}@media(max-width:800px){.contributions-page{padding:18px}.page-head{flex-direction:column}.filters,.form-grid{grid-template-columns:1fr}.page-head .primary{width:100%}.plan-modal{padding:23px 18px}}
.filters{grid-template-columns:minmax(260px,2fr) repeat(3,minmax(155px,1fr))}
@media(max-width:1000px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:800px){.filters{grid-template-columns:1fr}}
</style>
