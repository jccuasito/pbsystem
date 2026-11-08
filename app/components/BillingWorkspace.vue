<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import BillingDraftModal from './BillingDraftModal.vue'
import ClientBillingSetupModal from './ClientBillingSetupModal.vue'

const props = withDefaults(defineProps<{ history?: boolean }>(), { history: false })
const data = ref<any>({ accounts: [], sources: [], drafts: [], permissions: { canEdit: false } })
const search = ref(''), agency = ref(''), start = ref(''), end = ref('')
const loading = ref(false), busy = ref(false), opening = ref(''), error = ref(''), actionError = ref(''), notice = ref('')
const selected = ref<any>(null), setup = ref<any>(null), chosen = ref(new Set<number>()), expanded = ref(new Set<string>())
let request = 0
const money = (value: any) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value) || 0)
const day = (value: string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const key = (account: any) => `${account.AgencyID}:${account.ClientID}`
const agencies = computed(() => [...new Map(data.value.accounts.map((account: any) => [String(account.AgencyID), account.AgencyName])).entries()])
const groups = computed(() => {
  const groups = new Map<string, any>(), query = search.value.trim().toLowerCase()
  // Saved historical agency/client pairs remain visible even when the account is inactive.
  const accounts = new Map(data.value.accounts.map((account: any) => [key(account), account]))
  for (const draft of data.value.drafts) if (!accounts.has(key(draft))) accounts.set(key(draft), { ...draft, profile: null })
  for (const account of accounts.values() as Iterable<any>) {
    const sources = data.value.sources.filter((source: any) => key(source) === key(account))
    const drafts = data.value.drafts.filter((draft: any) => key(draft) === key(account))
    if (props.history && !drafts.length || agency.value && String(account.AgencyID) !== agency.value) continue
    if (query && !`${account.AgencyName} ${account.ClientName} ${sources.map((source: any) => source.SiteName).join(' ')} ${drafts.map((draft: any) => draft.SiteName).join(' ')}`.toLowerCase().includes(query)) continue
    const agencyKey = String(account.AgencyID)
    if (!groups.has(agencyKey)) groups.set(agencyKey, { id: agencyKey, name: account.AgencyName, clients: [] })
    groups.get(agencyKey).clients.push({ ...account, key: key(account), sources, drafts })
  }
  return [...groups.values()]
})
const visibleClients = computed(() => groups.value.reduce((sum, group) => sum + group.clients.length, 0))
function toggle(account: any) { const value = new Set(expanded.value); value.has(account.key) ? value.delete(account.key) : value.add(account.key); expanded.value = value }
function choose(source: any) { const value = new Set(chosen.value); value.has(Number(source.BatchID)) ? value.delete(Number(source.BatchID)) : value.add(Number(source.BatchID)); chosen.value = value }
function selection(account: any) { return account.sources.filter((source: any) => !source.BillingID && chosen.value.has(Number(source.BatchID))).map((source: any) => Number(source.BatchID)) }
async function load() {
  const token = ++request
  loading.value = true; error.value = ''
  try {
    const result = await $fetch<any>('/api/billing/drafts', { query: start.value || end.value ? { periodStart: start.value, periodEnd: end.value } : {} })
    if (token !== request) return
    data.value = result
    const available = new Set(result.sources.filter((source: any) => !source.BillingID).map((source: any) => Number(source.BatchID)))
    chosen.value = new Set([...chosen.value].filter(id => available.has(id)))
  } catch (cause: any) { if (token === request) error.value = cause.data?.statusMessage || 'Unable to load billing. Please retry.' }
  finally { if (token === request) loading.value = false }
}
async function open(account: any, draft?: any) {
  if (opening.value) return
  const ids = draft ? [] : selection(account)
  if (!draft && !ids.length) return
  opening.value = account.key; actionError.value = ''
  try { selected.value = await $fetch<any>(draft ? `/api/billing/drafts/${draft.BillingID}` : '/api/billing/drafts/preview', { query: draft ? {} : { batchIds: ids.join(',') } }) }
  catch (cause: any) { error.value = cause.data?.statusMessage || 'Unable to prepare this bill.' }
  finally { opening.value = '' }
}
async function save(body: any) {
  if (!selected.value || busy.value) return
  busy.value = true; actionError.value = ''
  try {
    const source = selected.value.source || selected.value.draft.snapshot.source
    const result = await $fetch<any>('/api/billing/drafts', { method: 'POST', body: { ...body, batchIds: source.BatchIDs, billingId: selected.value.draft?.billingId || null } })
    selected.value = null; chosen.value = new Set(); notice.value = `BILL-DRAFT-${String(result.billingId).padStart(4, '0')} saved. Revision ${result.revision}.`
    await load()
  } catch (cause: any) { actionError.value = cause.data?.statusMessage || 'Unable to save this billing draft.' }
  finally { busy.value = false }
}
async function saveSetup(body: any) {
  if (busy.value) return
  busy.value = true; actionError.value = ''
  try { await $fetch('/api/billing/profiles', { method: 'POST', body }); setup.value = null; notice.value = 'Client billing setup saved.'; await load() }
  catch (cause: any) { actionError.value = cause.data?.statusMessage || 'Unable to save client setup.' }
  finally { busy.value = false }
}
function openSetup(account: any) { actionError.value = ''; setup.value = account }
onMounted(load)
</script>

<template>
  <main class="billing-workspace">
    <header class="page-heading"><div><p class="eyebrow">BILLING</p><h1>{{ history ? 'Billing History' : 'Generate Billing' }}</h1><p>{{ history ? 'Saved statements, client details and revision history.' : 'Prepare client bills from finalized payroll quantities.' }}</p></div><button class="secondary" type="button" :disabled="loading" @click="load">{{ loading ? 'Refreshing...' : 'Refresh' }}</button></header>
    <section v-if="!history" class="workflow"><strong>Agency <span>&rsaquo;</span> Client <span>&rsaquo;</span> Finalized payroll <span>&rsaquo;</span> Review bill</strong><p>Each client has its own billable items, contract rates and statement format. Choose separate site bills or combine sites in Client billing setup.</p></section>
    <form class="filters" @submit.prevent="load"><label class="search">Search client or site<input v-model="search" type="search" placeholder="Client, agency or site name"></label><label>Agency<select v-model="agency"><option value="">All agencies</option><option v-for="[id,name] in agencies" :key="String(id)" :value="String(id)">{{ name }}</option></select></label><label>Service from<input v-model="start" type="date"></label><label>Service to<input v-model="end" type="date"></label><button class="secondary" :disabled="loading">Apply dates</button></form>
    <p v-if="error" class="error notice" role="alert">{{ error }} <button class="secondary" type="button" :disabled="loading" @click="load">Retry</button></p><p v-if="notice" class="success notice" role="status">{{ notice }}</p>
    <div class="list-context"><span>{{ visibleClients }} clients across {{ groups.length }} agencies</span><span v-if="loading" role="status">Loading billing records...</span><span v-else>Source: finalized payroll</span></div>
    <section v-for="group in groups" :key="group.id" class="agency-group"><h2><span class="agency-mark" aria-hidden="true">{{ group.name.slice(0,1) }}</span>{{ group.name }}<small>{{ group.clients.length }} clients</small></h2>
      <div class="client-list"><article v-for="account in group.clients" :key="account.key" class="client-card">
        <div class="client-heading"><button type="button" class="client-toggle" :aria-expanded="expanded.has(account.key)" @click="toggle(account)"><span class="chevron" aria-hidden="true">{{ expanded.has(account.key) ? '\u2304' : '\u203a' }}</span><span><strong>{{ account.ClientName }}</strong><small>{{ history ? `${account.drafts.length} saved bills` : `${account.sources.filter((source:any)=>!source.BillingID).length} available payroll sources` }} <template v-if="account.profile">&middot; {{ account.profile.config.mode==='client'?'Consolidated client billing':'Billing per site' }}</template><template v-else>&middot; Setup required</template></small></span></button><button v-if="!history" type="button" class="setup-button" @click="openSetup(account)">{{ account.profile ? 'Client billing setup' : 'Set up billing' }}</button></div>
        <div v-if="expanded.has(account.key)" class="client-body">
          <template v-if="!history"><p v-if="!account.profile" class="setup-hint">Save this client's billable items and invoice scope before preparing a bill.</p>
            <div class="source-list" role="group" :aria-label="`${account.ClientName} finalized payroll sources`"><div v-for="source in account.sources" :key="source.BatchID" class="source-row"><button type="button" class="source-check" role="checkbox" :aria-checked="chosen.has(Number(source.BatchID))" :aria-label="`Select ${source.SiteName} ${source.PeriodStart}`" :disabled="!!source.BillingID||!account.profile" @click="choose(source)"><span>{{ chosen.has(Number(source.BatchID))?'\u2713':'' }}</span></button><div><strong>{{ source.SiteName }}</strong><small>{{ day(source.PeriodStart) }} &ndash; {{ day(source.PeriodEnd) }} &middot; {{ source.PeopleCount }} employees</small></div><span class="source-state">{{ source.BillingID?'Already in a saved bill':'Finalized' }}</span></div><p v-if="!account.sources.length" class="empty">No finalized payroll for this client in the selected period.</p></div>
            <div v-if="account.sources.length" class="selection-bar"><small>Select sources belonging to {{ account.profile?.config.mode==='client'?'this client':'one site' }}. A payroll source can belong to one bill.</small><button class="primary" type="button" :disabled="!account.profile||!selection(account).length||!!opening" @click="open(account)">{{ opening===account.key?'Opening...':'Review selected bill' }}</button></div>
          </template>
          <div v-if="account.drafts.length" class="saved-list"><h3>Saved bills</h3><div v-for="draft in account.drafts" :key="draft.BillingID" class="saved-row"><div><strong>BILL-DRAFT-{{ String(draft.BillingID).padStart(4,'0') }}</strong><small>{{ draft.SiteName }} &middot; {{ day(draft.PeriodStart) }} &ndash; {{ day(draft.PeriodEnd) }}</small></div><span class="saved-amount">{{ money(draft.TotalAmount) }}<small>{{ draft.Status }} &middot; Revision {{ draft.Revision }}</small></span><button class="secondary" type="button" :disabled="!!opening" @click="open(account,draft)">Open bill</button></div></div>
        </div>
      </article></div>
    </section>
    <p v-if="!loading&&!groups.length&&!error" class="empty">{{ history?'No saved bills match these filters.':'No client accounts match these filters.' }}</p>
    <BillingDraftModal v-if="selected" :detail="selected" :busy="busy" :error="actionError" @close="!busy&&(selected=null)" @save="save" />
    <ClientBillingSetupModal v-if="setup" :account="setup" :busy="busy" :error="actionError" :editable="data.permissions.canEdit" @close="!busy&&(setup=null)" @save="saveSetup" />
  </main>
</template>

<style scoped>
.billing-workspace{padding:30px 34px;max-width:1700px;margin:auto;box-sizing:border-box;color:#19365f}.page-heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:22px}.eyebrow{margin:0 0 8px;color:#3265cb;font-size:11px;font-weight:800;letter-spacing:.1em}h1{font-size:32px;margin:0;color:#142c4f}.page-heading p:last-child{margin:8px 0 0;color:#7486a0;font-size:14px}.workflow{padding:15px 18px;background:#edf3fc;border:1px solid #dfe8f8;border-radius:10px;margin-bottom:22px;font-size:12px}.workflow strong{color:#385b8d}.workflow strong span{padding:0 9px;color:#96aac5}.workflow p{margin:6px 0 0;color:#6b81a0;line-height:1.6}.filters{display:grid;grid-template-columns:minmax(210px,1.4fr) minmax(190px,1fr) 160px 160px auto;gap:12px;align-items:end;padding:17px;border:1px solid #dbe5f2;border-radius:12px;background:#fff}label{display:grid;gap:7px;font-size:11px;font-weight:700;color:#5e7390}input,select{height:41px;box-sizing:border-box;width:100%;min-width:0;border:1px solid #cfdbea;border-radius:7px;background:#fff;padding:9px 11px;color:#233d63;font:inherit}.primary,.secondary,.setup-button{font:inherit;font-size:12px;font-weight:700;border:1px solid #cad8eb;border-radius:7px;min-height:39px;padding:8px 13px;color:#325a97;background:#fff;cursor:pointer;white-space:nowrap}.primary{background:#2b61d3;border-color:#2b61d3;color:white}.setup-button{background:#f8faff;color:#466797;font-size:11px}.list-context{display:flex;justify-content:space-between;gap:12px;font-size:11px;color:#7d8ea6;margin:20px 0}.agency-group{margin:25px 0}.agency-group h2{display:flex;align-items:center;gap:10px;font-size:15px;margin:0 0 12px;font-weight:700}.agency-group h2 small{margin-left:auto;font-size:11px;font-weight:400;color:#8696ac}.agency-mark{display:grid;place-items:center;width:30px;height:30px;background:#e4ecf8;color:#5779ae;border-radius:7px;font-size:13px}.client-list{border:1px solid #d9e3f0;border-radius:11px;background:white;overflow:hidden}.client-card+.client-card{border-top:1px solid #e5ebf3}.client-heading{display:flex;align-items:center;gap:20px;padding:16px 20px}.client-toggle{display:flex;align-items:center;gap:13px;flex:1;min-width:0;border:0;background:transparent;color:#264569;padding:0;text-align:left;font:inherit;cursor:pointer}.client-toggle strong{font-size:14px}.client-toggle small,.source-row small,.saved-row small{display:block;font-size:11px;margin-top:5px;line-height:1.5;color:#8393aa}.chevron{font-size:22px;color:#8aa0bf;min-width:13px}.client-body{border-top:1px solid #e6edf6;padding:18px 20px;background:#fbfcff}.source-list{border:1px solid #e0e8f3;border-radius:8px;background:white;overflow:hidden}.source-row{display:flex;align-items:center;gap:13px;padding:12px 15px}.source-row+.source-row{border-top:1px solid #edf1f7}.source-row strong{font-size:12px}.source-state{margin-left:auto;border-radius:20px;background:#edf7f1;color:#3d8260;padding:5px 9px;font-size:10px;white-space:nowrap}.source-check{width:20px;height:20px;min-width:20px;box-sizing:border-box;border:1px solid #bacbe1;border-radius:5px;background:white;padding:0;display:grid;place-items:center;cursor:pointer;color:#fff}.source-check[aria-checked=true]{background:#2c64d5;border-color:#2c64d5}.source-check:focus-visible,.client-toggle:focus-visible{outline:3px solid #8cacf1;outline-offset:4px}.selection-bar{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:13px}.selection-bar small{font-size:11px;color:#7b8fa9}.setup-hint{font-size:12px;color:#8d743b;padding:10px 12px;border:1px solid #f0e3bc;background:#fffbf1;border-radius:7px;margin:0 0 12px}.saved-list h3{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#7d90ab;margin:21px 0 10px}.saved-list:first-child h3{margin-top:0}.saved-row{display:flex;align-items:center;gap:18px;padding:13px 0;border-top:1px solid #e2eaf5;font-size:12px}.saved-row>div{flex:1}.saved-amount{text-align:right;white-space:nowrap;font-weight:700}.notice{font-size:12px;line-height:1.6;padding:12px 16px;border-radius:8px}.notice button{margin-left:10px}.error{color:#b42318;background:#fff0ef}.success{color:#28744e;background:#edf8f1}.empty{text-align:center;font-size:12px;color:#8192a9;padding:26px}button:disabled{opacity:.5;cursor:default}@media(max-width:1100px){.filters{grid-template-columns:1fr 1fr}.filters .search{grid-column:1/-1}.filters button{justify-self:start}}@media(max-width:650px){.billing-workspace{padding:22px 14px}h1{font-size:27px}.page-heading{align-items:flex-start}.filters{padding:12px;gap:10px}.client-heading{padding:15px 12px;flex-wrap:wrap;gap:12px}.setup-button{margin-left:26px}.client-body{padding:12px}.source-row{padding:11px 10px;gap:9px;flex-wrap:wrap}.source-state{margin-left:29px}.selection-bar,.saved-row{align-items:flex-start;flex-direction:column}.selection-bar button{width:100%}.saved-amount{text-align:left}.agency-group h2{align-items:flex-start;flex-wrap:wrap;font-size:13px}.agency-group h2 small{margin-left:40px}}
</style>
