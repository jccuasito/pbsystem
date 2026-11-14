<script setup lang="ts">
import { requestErrorMessage } from '~~/shared/utils/requestError'

import { computed, onMounted, ref, watch } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import RegionalRateModal from './RegionalRateModal.vue'
import RegionalPositionFields from './RegionalPositionFields.vue'
import { regionalAtDate, regionalAmounts, regionalOverrides, rateDate } from '~~/shared/utils/regionalRates'
import RateMoneyFields from './RateMoneyFields.vue'
import RateGroups from './RateGroups.vue'
import SearchableSelect from './SearchableSelect.vue'
import ModernDateField from './ModernDateField.vue'
import { rateFormFields as moneyFields } from '~~/shared/utils/rateFields'

const props = defineProps<{ resource: 'payroll-rate' | 'billing-rate'; title: string }>()
const items = ref<any[]>([]); const agencyPositions = ref<any[]>([]); const regions = ref<any[]>([])
const search = ref(''); const agencyFilter = ref(''); const positionFilter = ref(''); const regionFilter = ref(''); const statusFilter = ref('')
const form = ref<any>({}); const open = ref(false); const busy = ref(false); const loading = ref(true); const error = ref('')
const selectedAgencyId = ref<string | number>('')
const addContext=ref<any>(null),copyRateId=ref(''),copyNotice=ref(''),regionalGroupOpen=ref(false)
const copyCandidates=computed(()=>props.resource==='payroll-rate'?items.value.filter(item=>item.Status==='Active'&&agencyPositions.value.some(position=>String(position.AgencyID)===String(selectedAgencyId.value)&&Number(position.AgencyPositionID)===Number(item.AgencyPositionID))&&String(item.RegionID??'')===String(form.value.RegionID??'')):[])
function startAdd(group?:any){reset();if(group){addContext.value=group;selectedAgencyId.value=String(group.AgencyID);form.value.RegionID=group.RegionID??'';const parent=parentFor(group);if(parent){form.value.RegionRateID=parent.RegionRateID;form.value.EffectiveDate=rateDate((parent.CurrentRate||parent).EffectiveDate);fillInherited(form,addOverrides,parent)}}open.value=true}
function clearCopy(){copyRateId.value='';copyNotice.value=''}
function copyAmounts(){const source=copyCandidates.value.find(item=>String(item[idKey.value])===copyRateId.value);if(!source)return;const current=source.CurrentRate||source;for(const {key} of moneyFields)form.value[key]=current[key]??0;copyNotice.value='Amounts copied. Review and adjust them for this position before saving.'}

const editingCurrent = ref<any>(null); const editForm = ref<any>({}); const editBusy = ref(false); const editError = ref('')
const updating = ref<any>(null); const updateForm = ref<any>({}); const updateBusy = ref(false); const updateError = ref('')
const viewingHistory = ref<any>(null)
const regionalRates=ref<any[]>([]),regionalAgencies=ref<any[]>([]),regionalModal=ref<any>(null)
const addOverrides=ref<Record<string,number>>({}),editOverrides=ref<Record<string,number>>({}),updateOverrides=ref<Record<string,number>>({})
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
function parentFor(item:any){if(props.resource!=='payroll-rate'||!item)return null;return regionalRates.value.find(parent=>item.RegionRateID?Number(parent.RegionRateID)===Number(item.RegionRateID):String(parent.AgencyID)===String(item.AgencyID??selectedAgencyId.value)&&String(parent.RegionID??'')===String(item.RegionID??''))||null}
const addParent=computed(()=>parentFor({...form.value,AgencyID:selectedAgencyId.value})),editParent=computed(()=>parentFor(editingCurrent.value)),updateParent=computed(()=>parentFor(updating.value))
function inherited(parent:any,date?:string){return regionalAtDate(parent,parent?.Versions||[],date||today())||parent||{}}
function fillInherited(target:any,custom:any,parent:any){target.value={...target.value,...regionalAmounts(inherited(parent,rateDate(target.value.EffectiveDate)),custom.value)}}
function regionalPayload(parent:any,custom:any){return parent?{RegionRateID:parent.RegionRateID,RegionalRevision:parent.Revision,RegionOverrides:custom}: {}}
function openRegional(mode:string,group?:any){regionalModal.value={mode,record:group?.RegionRateID?group:parentFor(group),scope:mode==='create'?group:null}}
watch([()=>form.value.EffectiveDate,addParent],()=>{if(addParent.value&&open.value)fillInherited(form,addOverrides,addParent.value)})
watch(()=>updateForm.value.EffectiveDate,()=>{if(updateParent.value&&updating.value)fillInherited(updateForm,updateOverrides,updateParent.value)})
const modalTitle = computed(() => `Add ${props.title.slice(0, -1)}`)
const idKey = computed(() => props.resource === 'payroll-rate' ? 'PayrollRateID' : 'BillingRateID')
const agencyOptions = computed(() => [...new Map(agencyPositions.value.map(item => [String(item.AgencyID), { value: String(item.AgencyID), label: String(item.AgencyName) }])).values()].sort((a, b) => a.label.localeCompare(b.label)))
const formPositionOptions = computed(() => agencyPositions.value.filter(item => String(item.AgencyID) === String(selectedAgencyId.value)).map(item => ({ value: item.AgencyPositionID, label: String(item.PositionName) })).sort((a, b) => a.label.localeCompare(b.label)))
const agencies = computed(() => [...new Set([...items.value,...regionalRates.value].map(item => String(item.AgencyName || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
const positions = computed(() => [...new Set(items.value.filter(item => !agencyFilter.value || item.AgencyName === agencyFilter.value).map(item => String(item.PositionName || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
const regionOrder = ['13', '14', '01', '02', '03', '04', '17', '05', '06', '18', '07', '08', '09', '10', '11', '12', '16', '19']
const regionRank = new Map(regionOrder.map((code, index) => [code, index]))
function compareRegions(a: any, b: any) {
  return (regionRank.get(String(a.RegionCode)) ?? 99) - (regionRank.get(String(b.RegionCode)) ?? 99)
    || String(a.RegionName || '').localeCompare(String(b.RegionName || ''))
}
function regionLabel(region: any) {
  const name = String(region.RegionName || '').toUpperCase()
  const namedRegion = /^REGION ([IVX]+(?:-A)?) \((.+)\)$/.exec(name)
  if (namedRegion) return `REGION ${namedRegion[1]} — ${namedRegion[2].replace(/ REGION$/, '')}`
  const shortNames: Record<string, string> = {
    '13': 'NCR — NATIONAL CAPITAL',
    '14': 'CAR — CORDILLERA',
    '17': 'MIMAROPA',
    '18': 'NIR — NEGROS ISLAND',
    '19': 'BARMM — BANGSAMORO',
  }
  return shortNames[String(region.RegionCode)] || name || String(region.RegionCode || '')
}
const sortedRegions = computed(() => [...regions.value].sort(compareRegions))
const rateRegions = computed(() => [...new Map([...items.value,...regionalRates.value].filter(item => item.RegionID != null).map(item => [String(item.RegionID), { id: String(item.RegionID), RegionCode: item.RegionCode, RegionName: item.RegionName, name: regionLabel(item) }])).values()].sort(compareRegions))
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
function changeFormAgency() { addOverrides.value={};form.value.AgencyPositionID = '';clearCopy() }
function formatDate(value: unknown) {
  const day = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '—'
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
}
function openCurrentEdit(item: any) {
  editingCurrent.value = item
  const current = item.CurrentRate || item
  editForm.value = Object.fromEntries(moneyFields.map(({ key }) => [key, current[key] ?? 0]))
  editOverrides.value=regionalOverrides(current.RegionOverridesJson??item.RegionOverridesJson)
  editError.value = ''
}
async function saveCurrentEdit() {
  if (!editingCurrent.value || editBusy.value) return
  editBusy.value = true; editError.value = ''
  try {
    await $fetch(`/api/rates/${props.resource}`, { method: 'PUT', body: { id: editingCurrent.value[idKey.value], mode: 'current', ...editForm.value, ...regionalPayload(editParent.value,editOverrides.value) } })
    editingCurrent.value = null
    await load()
  } catch (e: any) { editError.value = requestErrorMessage(e, 'Unable to edit the current rate.') }
  finally { editBusy.value = false }
}
function openUpdate(item: any) {
  updating.value = item
  const latest = item.Versions?.at(-1) || item
  updateForm.value = { EffectiveDate: '', Reason: '', ...Object.fromEntries(moneyFields.map(({ key }) => [key, latest[key] ?? 0])) }
  updateOverrides.value=regionalOverrides(latest.RegionOverridesJson??item.RegionOverridesJson)
  updateError.value = ''
}
const lastPositionUpdateDate=computed(()=>updating.value?.Versions?.filter((entry:any)=>!updating.value.RegionRateID||!entry.IsRegionalVersion)?.at(-1)?.EffectiveDate || updating.value?.EffectiveDate)
const minimumUpdateDate = computed(() => {
  const value = lastPositionUpdateDate.value
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
    await $fetch('/api/rates/versions', { method: 'POST', body: { resource: props.resource, id: updating.value[idKey.value], ...updateForm.value, ...regionalPayload(updateParent.value,updateOverrides.value) } })
    updating.value = null
    await load()
  } catch (e: any) { updateError.value = requestErrorMessage(e, 'Unable to update rate.') }
  finally { updateBusy.value = false }
}
function reset() { addOverrides.value={};addContext.value=null;clearCopy();selectedAgencyId.value = ''; form.value = { AgencyPositionID: '', RegionID: '', EffectiveDate: '', Status: 'Active', ...Object.fromEntries(moneyFields.map(({ key }) => [key, 0])) }; error.value = '' }
async function load(silent = false) {
 if(!silent)loading.value=true
 try{const [r,regional]:any[]=await Promise.all([$fetch(`/api/rates/${props.resource}`),props.resource==='payroll-rate'?$fetch('/api/rates/regional'):Promise.resolve({items:[],agencies:[]})]);items.value=r.items||[];agencyPositions.value=r.agencyPositions||[];regions.value=r.regions||[];regionalRates.value=regional.items||[];regionalAgencies.value=regional.agencies||[];if(viewingHistory.value)viewingHistory.value=items.value.find(item=>item[idKey.value]===viewingHistory.value[idKey.value])||null}
 catch(e:any){error.value=requestErrorMessage(e, 'Unable to load rates.')}finally{if(!silent)loading.value=false}
}
async function save() { busy.value = true; error.value = ''; try { await $fetch(`/api/rates/${props.resource}`, { method: 'POST', body: {...form.value,...regionalPayload(addParent.value,addOverrides.value)} }); open.value = false; await load() } catch (e: any) { error.value = requestErrorMessage(e, 'Unable to save rate.') } finally { busy.value = false } }
async function deactivate(item: any) { if (!confirm('Mark this rate as inactive?')) return; try { await $fetch(`/api/rates/${props.resource}`, { method: 'DELETE', body: { id: item[idKey.value] } }); await load() } catch (e: any) { error.value = requestErrorMessage(e, 'Unable to deactivate rate.') } }
const currency = (value: any) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value) || 0)
onMounted(load)
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !busy.value && !open.value && !editingCurrent.value && !updating.value && !regionalModal.value })
</script>
<template>
  <main class="rates-page">
    <header class="page-head">
      <div><p>RATES</p><h1>{{ title }}</h1><small>{{resource==='payroll-rate'?'Manage regional base rates and effective updates, with custom amounts for individual positions.':'Manage position billing rates by agency and region, including effective updates and history.'}}</small></div>
      <button v-if="!regionalGroupOpen" class="primary" type="button" @click="resource==='payroll-rate'?openRegional('create'):startAdd()">{{resource==='payroll-rate'?'+ Add region rate':'+ Add rate'}}</button>
    </header>

    <section class="filters" :aria-label="title + ' filters'">
      <label class="search-field"><span>Search rates</span><input v-model.trim="search" type="search" placeholder="Search agency, position, or region"></label>
      <label><span>Agency</span><select v-model="agencyFilter" @change="changeAgency"><option value="">All agencies</option><option v-for="agency in agencies" :key="agency" :value="agency">{{ agency }}</option></select></label>
      <label><span>Position</span><select v-model="positionFilter"><option value="">All positions</option><option v-for="position in positions" :key="position" :value="position">{{ position }}</option></select></label>
      <label><span>Region</span><select v-model="regionFilter"><option value="">All regions</option><option v-for="region in rateRegions" :key="region.id" :value="region.id">{{ region.name }}</option></select></label>
      <label><span>Status</span><select v-model="statusFilter"><option value="">All statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
    </section>
    <div class="list-summary">
      <span>{{ loading ? 'Loading rates…' : resource==='payroll-rate'?items.length+' position rate records / '+regionalRates.length+' configured region rates':'Showing ' + filteredItems.length + ' of ' + items.length + ' rates' }}</span>
      <button v-if="search || agencyFilter || positionFilter || regionFilter || statusFilter" type="button" @click="clearFilters">Clear filters</button>
    </div>
    <p v-if="error && !open" class="error" role="alert">{{ error }}</p>

    <RateGroups :resource="resource" :items="filteredItems" :all-items="items" :agency-positions="agencyPositions" :regional-rates="regionalRates" :filters="{search,agencyFilter,positionFilter,regionFilter,statusFilter}" :loading="loading" @regional="openRegional" @add="startAdd" @edit="openCurrentEdit" @update="openUpdate" @history="viewingHistory=$event" @deactivate="deactivate" @navigate="regionalGroupOpen=$event" />
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
              <RegionalPositionFields v-if="editParent" v-model="editForm" v-model:overrides="editOverrides" :regional="inherited(editParent,rateDate(editingCurrent.CurrentRate?.EffectiveDate||editingCurrent.EffectiveDate))"/><RateMoneyFields v-else v-model="editForm" />
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
              <div class="rate-history-entry__head"><div><span>{{ entry.isOriginal ? 'ORIGINAL RATE' : entry.IsRegionalVersion ? 'REGION RATE UPDATE' : 'POSITION RATE UPDATE' }}</span><h3>{{ formatDate(entry.EffectiveDate) }}</h3></div><span class="rate-history-state" :class="`rate-history-state--${entry.state.toLowerCase()}`">{{ entry.state }}</span></div>
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
                <div class="rate-date-field"><ModernDateField v-model="updateForm.EffectiveDate" label="Effective date" placeholder="Select effective date" :min="minimumUpdateDate" required /><small v-if="minimumUpdateDate">After {{ formatDate(lastPositionUpdateDate) }}</small></div>
                <label class="rate-control"><span>Reason / reference <em>(optional)</em></span><input v-model="updateForm.Reason" type="text" maxlength="500" placeholder="e.g. DOLE wage order"><small>Helps explain this change in the rate history.</small></label>
              </div>
            </section>
            <section class="rate-modal-section">
              <div class="rate-section-heading"><div><span>RATE AMOUNTS</span><h3>Updated amounts</h3></div><small>PHP amounts for this rate version</small></div>
              <RegionalPositionFields v-if="updateParent" v-model="updateForm" v-model:overrides="updateOverrides" :regional="inherited(updateParent,updateForm.EffectiveDate)"/><RateMoneyFields v-else v-model="updateForm" />
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
                <SearchableSelect v-model="selectedAgencyId" label="Agency" placeholder="Search agency" :options="agencyOptions" :disabled="!!addContext" required empty-text="No active agencies with positions found." @change="changeFormAgency" />
                <SearchableSelect v-model="form.AgencyPositionID" label="Position" :placeholder="selectedAgencyId ? 'Search position' : 'Select agency first'" :options="formPositionOptions" :disabled="!selectedAgencyId" required empty-text="No active positions for this agency." />
                <label class="rate-control"><span>Region</span><select v-model="form.RegionID" aria-label="Region" :disabled="!!addContext" @change="clearCopy"><option value="">All regions</option><option v-for="option in sortedRegions" :key="option.RegionID" :value="option.RegionID" :title="option.RegionName">{{ regionLabel(option) }}</option></select></label>
              </div>
            </section>
            <section class="rate-modal-section">
              <div class="rate-section-heading"><div><span>AVAILABILITY</span><h3>Effective date and status</h3></div></div>
              <div class="rate-fields-grid"><ModernDateField v-model="form.EffectiveDate" label="Effective date" placeholder="Select effective date" /><label class="rate-control"><span>Status</span><select v-model="form.Status"><option>Active</option><option>Inactive</option></select></label></div>
            </section>
            <section class="rate-modal-section">
              <div class="rate-section-heading"><div><span>RATE AMOUNTS</span><h3>Starting amounts</h3></div><small>PHP amounts for this rate</small></div>
              <div v-if="resource==='payroll-rate'&&!addParent&&copyCandidates.length" class="copy-rate"><label class="rate-control"><span>Copy amounts from another position <em>(optional)</em></span><select v-model="copyRateId"><option value="">Enter amounts manually</option><option v-for="source in copyCandidates" :key="source[idKey]" :value="String(source[idKey])">{{source.PositionName}} &middot; {{currency(source.CurrentRate?.RegularRate??source.RegularRate)}}</option></select></label><button type="button" :disabled="!copyRateId" @click="copyAmounts">Use amounts</button><p v-if="copyNotice" role="status">{{copyNotice}}</p></div>
              <RegionalPositionFields v-if="addParent" v-model="form" v-model:overrides="addOverrides" :regional="inherited(addParent,form.EffectiveDate)"/><RateMoneyFields v-else v-model="form" />
            </section>
            <p v-if="error" class="error rate-modal-error" role="alert">{{ error }}</p>
          </div>
          <footer class="rate-modal-footer"><button type="button" :disabled="busy" @click="open = false">Cancel</button><button class="primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save rate' }}</button></footer>
        </form>
      </div>
    </Teleport>
    <RegionalRateModal v-if="regionalModal" :mode="regionalModal.mode" :record="regionalModal.record" :scope="regionalModal.scope" :positions="items" :agencies="regionalAgencies" :regions="sortedRegions" @close="regionalModal=null" @saved="regionalModal=null;load()"/>
  </main></template>
<style scoped>
.rates-page{padding:32px;max-width:1200px;margin:auto;color:var(--theme-ink,#172033);font-family:Inter,system-ui,sans-serif}.rates-page header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}.rates-page header p{margin:0;color:var(--theme-accent,#5271a5);font-size:.75rem;font-weight:800;letter-spacing:.08em}.rates-page h1{margin:3px 0 0;font-size:1.7rem}.primary{border:0;border-radius:8px;background:#2563eb;color:#fff;padding:10px 15px;font-weight:700;cursor:pointer}.table-wrap{overflow:auto;border:1px solid var(--theme-line,#dfe5ef);border-radius:10px}table{width:100%;border-collapse:collapse;background:var(--theme-surface,#fff)}th,td{padding:13px 14px;text-align:left;border-bottom:1px solid var(--theme-line,#edf1f6);font-size:.88rem;white-space:nowrap}th{background:var(--theme-soft,#f8fafc);color:var(--theme-muted,#526174);font-size:.75rem;text-transform:uppercase}td button,footer button{border:1px solid var(--theme-line,#cfd8e6);background:var(--theme-surface,#fff);border-radius:6px;padding:6px 9px;margin-right:6px;cursor:pointer}.status{padding:3px 8px;border-radius:999px;font-size:.74rem;font-weight:700}.status--active{background:#dcfce7;color:#166534}.status--inactive{background:#fee2e2;color:#991b1b}.error{color:#b42318}.backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px}.modal{box-sizing:border-box;font-family:Inter,system-ui,sans-serif;color:var(--theme-ink,#172033);position:relative;width:min(100%,820px);max-height:90vh;overflow:auto;background:var(--theme-surface,#fff);border-radius:12px;padding:26px;display:grid;gap:12px}.modal h2{margin:0}.modal label{display:grid;gap:5px;font-size:.8rem;font-weight:700;color:var(--theme-muted,#475569)}.modal input,.modal select{min-height:40px;border:1px solid var(--theme-line,#cfd8e6);border-radius:7px;padding:8px;font:inherit}.money-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.5rem;cursor:pointer}.modal footer{display:flex;justify-content:flex-end;margin-top:6px}@media(max-width:600px){.rates-page{padding:20px}.money-grid{grid-template-columns:1fr}}
.rates-page{box-sizing:border-box;width:100%;max-width:1500px}
.rates-page .page-head{align-items:flex-start;gap:18px;margin-bottom:24px}
.page-head small{display:block;margin-top:6px;color:var(--theme-muted,#64748b);font-size:.85rem}
.primary{min-height:42px;border-radius:9px;padding:10px 16px;font:inherit;font-weight:800}
.filters{display:grid;grid-template-columns:minmax(280px,2fr) repeat(4,minmax(145px,.7fr));align-items:end;gap:12px;margin-bottom:12px}
.filters label{display:grid;min-width:0;gap:6px}
.filters label>span{color:var(--theme-muted,#475569);font-size:.78rem;font-weight:800}
.filters input,.filters select{box-sizing:border-box;width:100%;min-width:0;min-height:42px;border:1px solid var(--theme-line,#cbd6e5);border-radius:9px;padding:8px 11px;background:var(--theme-surface,#fff);color:var(--theme-ink,#172033);font:inherit}
.filters input:focus,.filters select:focus{border-color:#7798d0;box-shadow:0 0 0 3px rgba(35,73,230,.1);outline:0}
.list-summary{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 1px 10px;color:var(--theme-muted,#64748b);font-size:.78rem}
.list-summary button{border:0;background:transparent;color:var(--theme-accent,#2458c4);font:inherit;font-weight:800;cursor:pointer}
.table-wrap{overflow:auto;border-radius:12px;background:var(--theme-surface,#fff)}
table{table-layout:fixed;min-width:1040px}
th,td{padding:11px 12px;vertical-align:middle;white-space:normal;overflow-wrap:break-word}
th{font-size:.69rem;letter-spacing:.025em}
th:first-child{width:30%}th:nth-child(2){width:15%}th:nth-child(3){width:13%}th:nth-child(4){width:17%}th:nth-child(5){width:10%}th:last-child{width:15%}
tbody tr:last-child td{border-bottom:0}
td strong,td small{display:block}
td strong{color:var(--theme-ink,#17375f);font-size:.84rem}
td small{margin-top:3px;color:var(--theme-muted,#64748b);font-size:.76rem}
.rate-amount{font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
.table-message td{padding:24px;text-align:center;color:var(--theme-muted,#64748b)}
.row-actions{display:flex;align-items:center;flex-wrap:nowrap;gap:7px}
.row-actions .rate-icon-action{display:grid;place-items:center;flex:none;box-sizing:border-box;width:38px;height:38px;min-height:38px;margin:0;border:1px solid var(--theme-line,#cfd8e6);border-radius:9px;padding:0;background:var(--theme-surface,#fff);color:var(--theme-ink,#29486e);cursor:pointer}
.row-actions .rate-icon-action:hover:not(:disabled),.row-actions .rate-icon-action:focus-visible{border-color:#91afe5;background:var(--theme-soft,#edf3ff);color:var(--theme-accent,#1e4fb0);outline:0}
.row-actions .rate-icon-action--danger:hover:not(:disabled),.row-actions .rate-icon-action--danger:focus-visible{border-color:#efb0b0;background:#fff1f2;color:#b42318}
.rate-icon-action svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.row-actions button:disabled,.rate-card footer button:disabled{opacity:.45;cursor:not-allowed}
.status{display:inline-flex;align-items:center;padding:4px 9px;font-size:.7rem;font-weight:800}
.status--inactive{background:var(--theme-soft,#f1f5f9);color:var(--theme-muted,#64748b)}
.mobile-list{display:none}
.rates-page .rate-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin:0;padding:13px 14px;border-bottom:1px solid var(--theme-line,#edf1f6)}
.rate-card,.mobile-message{border:1px solid var(--theme-line,#dce3ee);border-radius:12px;background:var(--theme-surface,#fff)}
.mobile-message{margin:0;padding:20px;text-align:center;color:var(--theme-muted,#64748b)}
.rate-card>header>div{display:grid;gap:3px}
.rate-card>header strong{color:var(--theme-ink,#17375f);font-size:.9rem}
.rate-card>header div span{color:var(--theme-muted,#64748b);font-size:.78rem}
.rate-card dl{display:grid;gap:8px;margin:0;padding:12px 14px}
.rate-card dl>div{display:grid;grid-template-columns:90px minmax(0,1fr);gap:8px}
.rate-card dt{color:var(--theme-muted,#64748b);font-size:.69rem;font-weight:800;text-transform:uppercase}
.rate-card dd{margin:0;color:var(--theme-ink,#273a55);font-size:.82rem}
.rate-card footer.row-actions{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid var(--theme-line,#edf1f6)}
@media(max-width:1150px){.filters{grid-template-columns:repeat(4,minmax(0,1fr))}.search-field{grid-column:1/-1}}
@media(max-width:850px){.rates-page{padding:22px 18px}.table-wrap{display:none}.mobile-list{display:grid;gap:10px}.filters{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){.rates-page{padding:16px 12px}.rates-page .page-head{align-items:stretch;flex-direction:column;margin-bottom:18px}.page-head .primary{width:100%}.filters{grid-template-columns:1fr;gap:9px}.search-field{grid-column:auto}.list-summary{align-items:flex-start;flex-direction:column;gap:5px}}
.rate-form-modal{width:min(100%,1080px);max-height:min(92dvh,1080px);padding:0;display:flex;flex-direction:column;gap:0;overflow:visible;border:1px solid var(--theme-line,#d9e3f2);border-radius:18px;background:var(--theme-soft,#f7f9fd);box-shadow:0 24px 70px rgba(12,30,60,.22)}
.rate-modal-header{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin:0;padding:24px 28px 20px;border-bottom:1px solid var(--theme-line,#e0e7f1);background:var(--theme-surface,#fff);border-radius:18px 18px 0 0}
.rate-modal-header>div{min-width:0}.rate-modal-header p{margin:0 0 5px;color:var(--theme-accent,#2563eb);font-size:.76rem;font-weight:800;letter-spacing:.08em}.rate-modal-header h2{margin:0;color:var(--theme-ink,#112a4e);font-size:1.65rem;line-height:1.25}.rate-modal-header span{display:block;margin-top:7px;color:var(--theme-muted,#62738e);font-size:.88rem;line-height:1.45}
.rate-modal-close{flex:none;display:grid;place-items:center;width:34px;height:34px;border:0;border-radius:8px;background:transparent;color:var(--theme-muted,#526783);cursor:pointer}.rate-modal-close:hover{background:var(--theme-soft,#eef3fb)}.rate-modal-close svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.rate-modal-body{min-height:0;overflow-y:auto;overscroll-behavior:contain;display:grid;align-content:start;gap:16px;padding:20px 28px}
.rate-modal-section{min-width:0;padding:20px 22px;border:1px solid var(--theme-line,#d9e5f4);border-radius:14px;background:var(--theme-surface,#fff)}
.rate-section-heading{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--theme-line,#e9eef5)}.rate-section-heading span{color:var(--theme-accent,#2563eb);font-size:.72rem;font-weight:800;letter-spacing:.08em}.rate-section-heading h3{margin:4px 0 0;color:var(--theme-ink,#18365c);font-size:1rem}.rate-section-heading small{color:var(--theme-muted,#71839d);font-size:.76rem;text-align:right}
.rate-fields-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:14px}.rate-fields-grid--three{grid-template-columns:repeat(3,minmax(0,1fr))}
.rate-control,.rate-date-field{min-width:0;display:grid;align-content:start;gap:6px}.rate-form-modal .rate-control>span{color:var(--theme-muted,#475569);font-size:.85rem;font-weight:700}.rate-control em{color:var(--theme-muted,#718096);font-size:.76rem;font-style:normal;font-weight:500}.rate-form-modal .rate-control input,.rate-form-modal .rate-control select{box-sizing:border-box;width:100%;min-width:0;min-height:44px;border:1px solid var(--theme-line,#cfd8e6);border-radius:9px;padding:9px 12px;background:var(--theme-surface,#fff);color:var(--theme-ink,#172033);font-size:.88rem}.rate-control small,.rate-date-field small{color:var(--theme-muted,#71839d);font-size:.75rem;font-weight:500}
.rate-context{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 18px;color:var(--theme-ink,#18365c)}.rate-context strong{font-size:.93rem}.rate-context span{color:var(--theme-muted,#526b91);font-size:.82rem}.rate-note{margin:14px 0 0;padding:11px 14px;border-radius:10px;background:var(--theme-soft,#eaf2ff);color:var(--theme-muted,#36577f);font-size:.8rem;line-height:1.5}
.rate-form-modal :deep(.rate-money-grid){grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.rate-form-modal :deep(.rate-money-grid label){color:var(--theme-muted,#475569);font-size:.85rem}.rate-form-modal :deep(.rate-money-grid input){min-height:44px;border-radius:9px;padding:9px 12px;font-size:.88rem}
.rate-form-modal :deep(input:focus),.rate-form-modal :deep(select:focus){outline:0;border-color:#5684e9;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
.rate-history-modal{width:min(100%,760px)}.rate-history-intro{margin:0;color:var(--theme-muted,#526b91);font-size:.85rem;line-height:1.5}
.rate-history-entry{padding:18px 20px;border:1px solid var(--theme-line,#d9e5f4);border-radius:13px;background:var(--theme-surface,#fff)}.rate-history-entry__head{display:flex;align-items:center;justify-content:space-between;gap:12px}.rate-history-entry__head>div>span{color:var(--theme-accent,#2563eb);font-size:.71rem;font-weight:800;letter-spacing:.07em}.rate-history-entry__head h3{margin:4px 0 0;color:var(--theme-ink,#18365c);font-size:1.05rem}
.rate-history-state{border-radius:999px;padding:5px 10px;background:var(--theme-soft,#edf1f6);color:var(--theme-muted,#53657c);font-size:.73rem;font-weight:800}.rate-history-state--current{background:#dcfce7;color:#166534}.rate-history-state--scheduled{background:var(--theme-soft,#eaf2ff);color:var(--theme-accent,#2458c4)}
.rate-history-reason{margin:12px 0 0;color:var(--theme-muted,#526b91);font-size:.82rem;line-height:1.45}.rate-history-highlight{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:14px;color:var(--theme-muted,#62738e);font-size:.82rem}.rate-history-highlight strong{margin-left:5px;color:var(--theme-ink,#18365c);font-variant-numeric:tabular-nums}
.rate-history-entry details{margin-top:14px;border-top:1px solid var(--theme-line,#e9eef5);padding-top:12px}.rate-history-entry summary{color:var(--theme-accent,#2458c4);font-size:.81rem;font-weight:800;cursor:pointer}.rate-history-entry dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 20px;margin:12px 0 0}.rate-history-entry dl>div{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--theme-line,#edf1f6);font-size:.78rem}.rate-history-entry dt{color:var(--theme-muted,#64748b)}.rate-history-entry dd{margin:0;color:var(--theme-ink,#18365c);font-weight:700;font-variant-numeric:tabular-nums}
.rate-modal-error{margin:0;padding:10px 12px;border-radius:8px;background:#fef2f2;font-size:.8rem}
.rate-form-modal .rate-modal-footer{flex:none;display:flex;justify-content:flex-end;gap:10px;margin:0;padding:16px 28px;border-top:1px solid var(--theme-line,#e0e7f1);border-radius:0 0 18px 18px;background:var(--theme-surface,#fff)}.rate-form-modal .rate-modal-footer button{min-height:42px;margin:0;padding:9px 16px;border-radius:9px;font-size:.84rem;font-weight:800}.rate-form-modal .rate-modal-footer .primary{border:0;color:#fff;background:#2563eb}
@media(max-width:800px){.rate-fields-grid--three{grid-template-columns:repeat(2,minmax(0,1fr))}.rate-fields-grid--three .rate-control{grid-column:1/-1}}
@media(max-width:600px){.rate-form-modal{max-height:calc(100dvh - 20px)}.rate-modal-header{padding:18px 18px 15px}.rate-modal-header h2{font-size:1.35rem}.rate-modal-body{padding:14px}.rate-modal-section{padding:16px}.rate-fields-grid,.rate-fields-grid--three{grid-template-columns:1fr}.rate-fields-grid--three .rate-control{grid-column:auto}.rate-form-modal :deep(.rate-money-grid){grid-template-columns:repeat(2,minmax(0,1fr))}.rate-form-modal .rate-modal-footer{padding:12px 16px}.rate-history-entry{padding:15px}.rate-history-entry dl{grid-template-columns:1fr}}
@media(max-width:420px){.rate-form-modal :deep(.rate-money-grid){grid-template-columns:1fr}.rate-form-modal .rate-modal-footer button{flex:1}}
.copy-rate{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:10px;padding:13px;margin-bottom:17px;background:var(--theme-soft,#f5f8fd);border:1px solid var(--theme-line,#e0e8f4);border-radius:9px}.copy-rate>button{min-height:44px;padding:8px 13px;border:1px solid var(--theme-line,#cbd9ed);border-radius:8px;background:var(--theme-surface,#fff);color:var(--theme-accent,#28558c);font-weight:750;cursor:pointer}.copy-rate>button:disabled{opacity:.45;cursor:default}.copy-rate p{grid-column:1/-1;font-size:.77rem;margin:0;color:#32654e;line-height:1.5}@media(max-width:500px){.copy-rate{grid-template-columns:1fr}}
</style>
