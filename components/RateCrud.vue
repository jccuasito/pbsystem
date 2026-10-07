<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import RateMoneyFields from './RateMoneyFields.vue'
import { rateFormFields as moneyFields } from '~~/shared/utils/rateFields'

const props = defineProps<{ resource: 'payroll-rate' | 'billing-rate'; title: string }>()
const items = ref<any[]>([]); const agencyPositions = ref<any[]>([]); const regions = ref<any[]>([])
const search = ref(''); const agencyFilter = ref(''); const positionFilter = ref(''); const regionFilter = ref(''); const statusFilter = ref('')
const form = ref<any>({}); const editing = ref<any>(null); const open = ref(false); const busy = ref(false); const loading = ref(true); const error = ref('')
const modalTitle = computed(() => editing.value ? `Edit ${props.title.slice(0, -1)}` : `Add ${props.title.slice(0, -1)}`)
const idKey = computed(() => props.resource === 'payroll-rate' ? 'PayrollRateID' : 'BillingRateID')
const agencies = computed(() => [...new Set(items.value.map(item => String(item.AgencyName || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
const positions = computed(() => [...new Set(items.value.filter(item => !agencyFilter.value || item.AgencyName === agencyFilter.value).map(item => String(item.PositionName || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
const rateRegions = computed(() => [...new Map(items.value.filter(item => item.RegionID != null).map(item => [String(item.RegionID), { id: String(item.RegionID), name: String(item.RegionName || item.RegionCode || '') }])).values()].sort((a, b) => a.name.localeCompare(b.name)))
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
function formatDate(value: unknown) {
  const day = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '—'
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
}
function reset(item: any = null) { editing.value = item; form.value = { AgencyPositionID: item?.AgencyPositionID ?? '', RegionID: item?.RegionID ?? '', EffectiveDate: item?.EffectiveDate?.slice?.(0, 10) ?? item?.EffectiveDate ?? '', Status: item?.Status ?? 'Active', ...Object.fromEntries(moneyFields.map(({ key }) => [key, item?.[key] ?? 0])) }; error.value = '' }
async function load(silent = false) { if (!silent) loading.value = true; try { const r: any = await $fetch(`/api/rates/${props.resource}`); items.value = r.items || []; agencyPositions.value = r.agencyPositions || []; regions.value = r.regions || [] } catch (e: any) { error.value = e.data?.statusMessage || 'Unable to load rates.' } finally { if (!silent) loading.value = false } }
async function save() { busy.value = true; error.value = ''; try { await $fetch(`/api/rates/${props.resource}`, { method: editing.value ? 'PUT' : 'POST', body: editing.value ? { id: editing.value[idKey.value], ...form.value } : form.value }); open.value = false; await load() } catch (e: any) { error.value = e.data?.statusMessage || 'Unable to save rate.' } finally { busy.value = false } }
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
            <td class="rate-amount">{{ currency(item.RegularRate) }}</td>
            <td>{{ formatDate(item.EffectiveDate) }}</td>
            <td><span class="status" :class="'status--' + String(item.Status || '').toLowerCase()">{{ item.Status }}</span></td>
            <td><div class="row-actions"><button type="button" @click="reset(item); open = true">Edit</button><button type="button" :disabled="item.Status === 'Inactive'" @click="deactivate(item)">Deactivate</button></div></td>
          </tr>
        </tbody>
      </table>
    </div>

    <section class="mobile-list" :aria-label="title">
      <p v-if="loading" class="mobile-message">Loading rates…</p>
      <p v-else-if="!filteredItems.length" class="mobile-message">{{ items.length ? 'No rates match the current filters.' : 'No rates found.' }}</p>
      <article v-for="item in loading ? [] : filteredItems" :key="item[idKey]" class="rate-card">
        <header><div><strong>{{ item.AgencyName }}</strong><span>{{ item.PositionName }}</span></div><span class="status" :class="'status--' + String(item.Status || '').toLowerCase()">{{ item.Status }}</span></header>
        <dl><div><dt>Region</dt><dd>{{ item.RegionName || 'All regions' }}</dd></div><div><dt>Regular rate</dt><dd>{{ currency(item.RegularRate) }}</dd></div><div><dt>Effective</dt><dd>{{ formatDate(item.EffectiveDate) }}</dd></div></dl>
        <footer><button type="button" @click="reset(item); open = true">Edit</button><button type="button" :disabled="item.Status === 'Inactive'" @click="deactivate(item)">Deactivate</button></footer>
      </article>
    </section>
<Teleport to="body"><div v-if="open" class="backdrop" @click.self="!busy && (open = false)"><form class="modal" @submit.prevent="save"><button class="close" type="button" @click="open = false">×</button><h2>{{ modalTitle }}</h2><label>Agency position<select v-model="form.AgencyPositionID" required><option value="">Select agency position</option><option v-for="option in agencyPositions" :key="option.AgencyPositionID" :value="option.AgencyPositionID">{{ option.AgencyName }} — {{ option.PositionName }}</option></select></label><label>Region<select v-model="form.RegionID"><option value="">All regions</option><option v-for="option in regions" :key="option.RegionID" :value="option.RegionID">{{ option.RegionCode }} — {{ option.RegionName }}</option></select></label><RateMoneyFields v-model="form" /><label>Effective date<input v-model="form.EffectiveDate" type="date" /></label><label>Status<select v-model="form.Status"><option>Active</option><option>Inactive</option></select></label><p v-if="error" class="error">{{ error }}</p><footer><button type="button" @click="open = false">Cancel</button><button class="primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save rate' }}</button></footer></form></div></Teleport></main></template>
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
table{table-layout:fixed}
th,td{padding:11px 12px;vertical-align:middle;white-space:normal;overflow-wrap:break-word}
th{font-size:.69rem;letter-spacing:.025em}
th:first-child{width:29%}th:nth-child(2){width:15%}th:nth-child(3){width:13%}th:nth-child(4){width:15%}th:nth-child(5){width:10%}th:last-child{width:18%}
tbody tr:last-child td{border-bottom:0}
td strong,td small{display:block}
td strong{color:#17375f;font-size:.84rem}
td small{margin-top:3px;color:#64748b;font-size:.76rem}
.rate-amount{font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
.table-message td{padding:24px;text-align:center;color:#64748b}
.row-actions{display:flex;flex-wrap:wrap;gap:6px}
.row-actions button{min-height:34px;margin:0;border-radius:8px;padding:6px 9px;color:#29486e;font:inherit;font-size:.75rem;font-weight:800}
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
.rate-card footer{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:10px 14px;border-top:1px solid #edf1f6}
.rate-card footer button{min-height:38px;margin:0;border-radius:8px;color:#29486e;font:inherit;font-size:.78rem;font-weight:800}
@media(max-width:1150px){.filters{grid-template-columns:repeat(4,minmax(0,1fr))}.search-field{grid-column:1/-1}}
@media(max-width:850px){.rates-page{padding:22px 18px}.table-wrap{display:none}.mobile-list{display:grid;gap:10px}.filters{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){.rates-page{padding:16px 12px}.rates-page .page-head{align-items:stretch;flex-direction:column;margin-bottom:18px}.page-head .primary{width:100%}.filters{grid-template-columns:1fr;gap:9px}.search-field{grid-column:auto}.list-summary{align-items:flex-start;flex-direction:column;gap:5px}}
</style>
