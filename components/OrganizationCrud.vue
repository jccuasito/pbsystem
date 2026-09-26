<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import ModernDateField from './ModernDateField.vue'

type Field = { key: string; label: string; type?: 'text' | 'email' | 'date' | 'select' | 'textarea' | 'file'; required?: boolean; optionsKey?: string }
type Column = { key: string; label: string }

const props = defineProps<{ resource: string; title: string; fields: Field[]; columns: Column[]; description?: string; searchPlaceholder?: string }>()
const items = ref<any[]>([])
const lookups = ref<Record<string, any[]>>({})
const modalOpen = ref(false)
const editing = ref<any>(null)
const form = ref<Record<string, any>>({})
const busy = ref(false)
const error = ref('')
const loading = ref(true)
const logoPreview = ref('')
const search = ref('')
const statusFilter = ref('')

function singularTitle(title: string) {
  if (title.endsWith('ies')) return `${title.slice(0, -3)}y`
  return title.endsWith('s') ? title.slice(0, -1) : title
}

const singular = computed(() => singularTitle(props.title))
const modalTitle = computed(() => editing.value ? `Edit ${singular.value}` : `Add ${singular.value}`)
const idKey = computed(() => `${props.resource.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('')}ID`)
const primaryColumn = computed(() => props.columns.find(column => !['Logo', 'Status'].includes(column.key)) || props.columns[0])
const cardColumns = computed(() => props.columns.filter(column => !['Logo', 'Status', primaryColumn.value?.key].includes(column.key)))
const filteredItems = computed(() => {
  const words = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return items.value.filter(item => {
    const searchable = props.columns.map(column => item[column.key]).filter(value => typeof value !== 'object').join(' ').toLocaleLowerCase()
    return words.every(word => searchable.includes(word)) && (!statusFilter.value || item.Status === statusFilter.value)
  })
})

function resetForm(item: any = null) {
  editing.value = item
  form.value = Object.fromEntries(props.fields.map(field => {
    const value = item?.[field.key] ?? (field.key === 'Status' ? 'Active' : '')
    return [field.key, field.type === 'date' && typeof value === 'string' ? value.slice(0, 10) : value]
  }))
  logoPreview.value = item?.HasLogo ? logoUrl(item) : ''
  error.value = ''
}

function logoUrl(item: any) {
  return `/api/organization/logo?resource=${encodeURIComponent(props.resource)}&id=${encodeURIComponent(String(item[idKey.value]))}`
}

function optionValue(field: Field, option: any) {
  return option[field.key] ?? option.RegionID ?? option.ClientID ?? option.AgencyID ?? option.PositionID ?? option.SiteID
}

function optionLabel(option: any) {
  return option.RegionName || option.ClientName || option.AgencyName || option.PositionName || option.SiteName || option.ShiftName || option.Name
}

async function selectLogo(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    error.value = 'Use a PNG, JPG, or WEBP image for the logo.'
    input.value = ''
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    error.value = 'Logo image must be no larger than 2 MB.'
    input.value = ''
    return
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Unable to read the selected logo.'))
    reader.readAsDataURL(file)
  }).catch((cause: Error) => {
    error.value = cause.message
    return ''
  })
  if (!dataUrl) return
  form.value.LogoData = dataUrl
  logoPreview.value = dataUrl
  error.value = ''
}

function removeLogo() {
  form.value.LogoData = null
  logoPreview.value = ''
}

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    const response: any = await $fetch(`/api/organization/${props.resource}`)
    items.value = response.items || []
    lookups.value = response
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to load records.'
  } finally {
    if (!silent) loading.value = false
  }
}

function add() { resetForm(); modalOpen.value = true }
function edit(item: any) { resetForm(item); modalOpen.value = true }
function clearFilters() { search.value = ''; statusFilter.value = '' }

async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const body = editing.value ? { id: editing.value[idKey.value], ...form.value } : form.value
    await $fetch(`/api/organization/${props.resource}`, { method: editing.value ? 'PUT' : 'POST', body })
    modalOpen.value = false
    await load()
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to save record.'
  } finally {
    busy.value = false
  }
}

async function deactivate(item: any) {
  if (!confirm(`Mark this ${singular.value.toLowerCase()} as inactive?`)) return
  try {
    await $fetch(`/api/organization/${props.resource}`, { method: 'DELETE', body: { id: item[idKey.value] } })
    await load()
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to deactivate record.'
  }
}

function formatDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

function display(item: any, column: Column) {
  const value = item[column.key]
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean' || value === 0 || value === 1) return Number(value) ? 'Yes' : 'No'
  if (/Date|Start|End/.test(column.key) && typeof value === 'string') return formatDate(value)
  return value
}

onMounted(load)
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !busy.value })
</script>

<template>
  <main class="organization-page">
    <header class="page-head">
      <div><p>ORGANIZATION</p><h1>{{ title }}</h1><small v-if="description">{{ description }}</small></div>
      <button class="primary" type="button" @click="add">+ Add {{ singular }}</button>
    </header>
    <p v-if="error && !modalOpen" class="error" role="alert">{{ error }}</p>

    <section class="filters" :aria-label="`${title} filters`">
      <label class="search-field"><span>Search {{ title.toLowerCase() }}</span><input v-model="search" type="search" :placeholder="searchPlaceholder || `Search ${title.toLowerCase()}`"></label>
      <label><span>Status</span><select v-model="statusFilter"><option value="">All statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
    </section>
    <div class="list-summary"><span>{{ loading ? `Loading ${title.toLowerCase()}…` : `Showing ${filteredItems.length} of ${items.length} ${title.toLowerCase()}` }}</span><button v-if="search || statusFilter" type="button" @click="clearFilters">Clear filters</button></div>

    <div class="desktop-table">
      <table><thead><tr><th v-for="column in columns" :key="column.key">{{ column.label }}</th><th class="actions-heading">Actions</th></tr></thead>
        <tbody>
          <tr v-if="loading" class="table-message"><td :colspan="columns.length + 1">Loading {{ title.toLowerCase() }}…</td></tr>
          <tr v-else-if="!filteredItems.length" class="table-message"><td :colspan="columns.length + 1">No {{ title.toLowerCase() }} match the current filters.</td></tr>
          <tr v-for="item in filteredItems" :key="item[idKey]">
            <td v-for="column in columns" :key="column.key"><img v-if="column.key === 'Logo' && item.HasLogo" class="table-logo" :src="logoUrl(item)" alt="Saved logo"><span v-else-if="column.key === 'Logo'">—</span><span v-else-if="column.key === 'Status'" class="status" :class="`status--${item.Status?.toLowerCase()}`">{{ item.Status }}</span><strong v-else-if="column.key === primaryColumn?.key">{{ display(item, column) }}</strong><template v-else>{{ display(item, column) }}</template></td>
            <td><div class="actions"><button type="button" @click="edit(item)">Edit</button><button type="button" :disabled="item.Status === 'Inactive'" @click="deactivate(item)">Deactivate</button></div></td>
          </tr>
        </tbody>
      </table>
    </div>

    <section class="mobile-list" :aria-label="title">
      <p v-if="loading" class="mobile-message">Loading {{ title.toLowerCase() }}…</p><p v-else-if="!filteredItems.length" class="mobile-message">No {{ title.toLowerCase() }} match the current filters.</p>
      <article v-for="item in filteredItems" :key="item[idKey]" class="record-card">
        <header><div class="record-card__identity"><img v-if="item.HasLogo" :src="logoUrl(item)" alt="Saved logo"><strong>{{ display(item, primaryColumn) }}</strong></div><span class="status" :class="`status--${item.Status?.toLowerCase()}`">{{ item.Status }}</span></header>
        <dl><div v-for="column in cardColumns" :key="column.key"><dt>{{ column.label }}</dt><dd>{{ display(item, column) }}</dd></div></dl>
        <footer><button type="button" @click="edit(item)">Edit</button><button type="button" :disabled="item.Status === 'Inactive'" @click="deactivate(item)">Deactivate</button></footer>
      </article>
    </section>

    <Teleport to="body"><div v-if="modalOpen" class="modal-backdrop" @click.self="!busy && (modalOpen = false)"><form class="modal organization-crud-modal" @submit.prevent="save">
      <button type="button" class="close" aria-label="Close" :disabled="busy" @click="modalOpen = false">×</button>
      <div class="modal-heading"><p>ORGANIZATION</p><h2>{{ modalTitle }}</h2><span>Complete the details below, then save your changes.</span></div>
      <div class="form-grid">
        <template v-for="field in fields" :key="field.key">
          <label v-if="field.type === 'textarea'" class="form-field form-field--wide"><span>{{ field.label }}</span><textarea v-model="form[field.key]" :required="field.required" /></label>
          <ModernDateField v-else-if="field.type === 'date'" v-model="form[field.key]" :label="field.label" :required="field.required" />
          <label v-else-if="field.type === 'select'" class="form-field"><span>{{ field.label }}</span><select v-model="form[field.key]" :required="field.required"><option value="">Select {{ field.label }}</option><template v-if="field.optionsKey"><option v-for="option in lookups[field.optionsKey] || []" :key="optionValue(field, option)" :value="optionValue(field, option)">{{ optionLabel(option) }}</option></template><template v-else><option>Active</option><option>Inactive</option></template></select></label>
          <label v-else-if="field.type === 'file'" class="form-field form-field--wide"><span>{{ field.label }}</span><input type="file" accept="image/png,image/jpeg,image/webp" @change="selectLogo"><small>PNG, JPG, or WEBP, up to 2 MB.</small><div v-if="logoPreview" class="logo-editor"><img :src="logoPreview" alt="Logo preview"><button type="button" @click="removeLogo">Remove logo</button></div></label>
          <label v-else class="form-field"><span>{{ field.label }}</span><input v-model="form[field.key]" :type="field.type || 'text'" :required="field.required"></label>
        </template>
      </div>
      <p v-if="error" class="error modal-error" role="alert">{{ error }}</p>
      <footer class="modal-footer"><button type="button" :disabled="busy" @click="modalOpen = false">Cancel</button><button class="primary" :disabled="busy">{{ busy ? 'Saving…' : editing ? 'Save changes' : `Add ${singular}` }}</button></footer>
    </form></div></Teleport>
  </main>
</template>

<style scoped>
.organization-page{box-sizing:border-box;width:100%;max-width:1500px;margin:auto;padding:32px;color:#172033;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:24px}.page-head p,.modal-heading p{margin:0;color:#3465d9;font-size:.75rem;font-weight:800;letter-spacing:.08em}.page-head h1{margin:3px 0;font-size:1.7rem}.page-head small{color:#64748b}.primary{min-height:42px;border:0;border-radius:9px;background:#2563eb!important;color:#fff!important;padding:10px 16px;font:inherit;font-weight:800;cursor:pointer}.primary:disabled{opacity:.6;cursor:wait}.error{margin:0 0 14px;color:#b42318}.filters{display:grid;grid-template-columns:minmax(260px,1fr) minmax(160px,240px);align-items:end;gap:12px;margin-bottom:10px}.filters label,.form-field{display:grid;min-width:0;gap:6px}.filters label>span,.form-field>span{color:#475569;font-size:.78rem;font-weight:800}.filters input,.filters select,.form-field input,.form-field select,.form-field textarea{box-sizing:border-box;width:100%;min-width:0;min-height:42px;border:1px solid #cbd6e5;border-radius:9px;padding:8px 11px;background:#fff;color:#172033;font:inherit}.filters input:focus,.filters select:focus,.form-field input:focus,.form-field select:focus,.form-field textarea:focus{border-color:#7798d0;box-shadow:0 0 0 3px rgba(35,73,230,.1);outline:0}.list-summary{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 1px 10px;color:#64748b;font-size:.78rem}.list-summary button{border:0;background:transparent;color:#2458c4;font:inherit;font-weight:800;cursor:pointer}.desktop-table{overflow:hidden;border:1px solid #dfe5ef;border-radius:12px;background:#fff}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{min-width:0;padding:10px 12px;border-bottom:1px solid #edf1f6;text-align:left;vertical-align:middle;font-size:.82rem;overflow-wrap:anywhere}th{background:#f8fafc;color:#526174;font-size:.69rem;text-transform:uppercase;letter-spacing:.025em}tbody tr:last-child td{border-bottom:0}.actions-heading{width:190px}td strong{font-size:.82rem}.actions{display:flex;gap:6px;white-space:nowrap}.actions button{flex:0 0 auto;white-space:nowrap;overflow-wrap:normal}.actions button,.record-card footer button,.modal-footer>button,.logo-editor button{min-height:34px;border:1px solid #cbd6e5;border-radius:8px;padding:6px 9px;background:#fff;color:#29486e;font:inherit;font-size:.75rem;font-weight:800;cursor:pointer}.actions button:disabled,.record-card footer button:disabled{opacity:.45;cursor:not-allowed}.status{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;background:#dcfce7;color:#147a3d;font-size:.69rem;font-weight:800}.status--inactive{background:#f1f5f9;color:#64748b}.table-logo{width:34px;height:34px;object-fit:contain;border:1px solid #dfe5ef;border-radius:7px;background:#fff}.table-message td{padding:22px;text-align:center;color:#64748b}.mobile-list{display:none}.modal-backdrop{position:fixed;inset:0;z-index:300;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.58)}.modal{box-sizing:border-box;position:relative;display:grid;width:min(100%,720px);max-height:calc(100dvh - 36px);gap:16px;padding:24px;overflow:auto;border:1px solid #d9e2ef;border-radius:16px;background:#fff;color:#172033;box-shadow:0 24px 70px rgba(15,23,42,.3);font-family:Inter,system-ui,sans-serif}.close{position:absolute;z-index:3;top:12px;right:12px;display:grid;width:34px;height:34px;place-items:center;border:0;border-radius:8px;background:transparent;color:#53657d;font:inherit;font-size:1.35rem;cursor:pointer}.close:hover{background:#edf3fa}.modal-heading{padding-right:38px}.modal-heading h2{margin:3px 0 4px;font-size:1.45rem}.modal-heading>span{color:#64748b;font-size:.8rem}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:13px}.form-field--wide{grid-column:1/-1}.form-field textarea{min-height:76px;resize:vertical}.form-field small{color:#64748b;font-size:.7rem;font-weight:600}.logo-editor{display:flex;align-items:center;gap:10px}.logo-editor img{width:68px;height:68px;object-fit:contain;border:1px solid #dfe5ef;border-radius:9px;background:#fff}.modal-error{margin:0}.modal-footer{display:flex;justify-content:flex-end;gap:9px;padding-top:2px}.record-card{display:grid;gap:12px;padding:14px;border:1px solid #dfe5ef;border-radius:12px;background:#fff}.record-card>header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.record-card__identity{display:flex;align-items:center;gap:9px;min-width:0}.record-card__identity img{width:38px;height:38px;object-fit:contain;border:1px solid #dfe5ef;border-radius:8px}.record-card__identity strong{overflow-wrap:anywhere}.record-card dl{display:grid;gap:8px;margin:0}.record-card dl>div{display:grid;grid-template-columns:100px minmax(0,1fr);gap:10px}.record-card dt{color:#71809a;font-size:.65rem;font-weight:850;text-transform:uppercase}.record-card dd{min-width:0;margin:0;color:#273a55;font-size:.78rem;overflow-wrap:anywhere}.record-card footer{display:flex;gap:8px}.record-card footer button{flex:1}
@media(max-width:900px){.organization-page{padding:22px 18px}.desktop-table{display:none}.mobile-list{display:grid;gap:10px}}
@media(max-width:600px){.organization-page{padding:16px 12px}.page-head{align-items:stretch;flex-direction:column;margin-bottom:18px}.page-head .primary{width:100%}.filters{grid-template-columns:1fr;gap:9px}.list-summary{align-items:flex-start;flex-direction:column;gap:5px}.modal-backdrop{align-items:end;padding:0}.modal{width:100%;max-height:calc(100dvh - 10px);gap:14px;padding:20px 14px;border-radius:16px 16px 0 0}.form-grid{grid-template-columns:1fr}.form-field--wide{grid-column:auto}.modal-footer{position:sticky;bottom:-20px;display:grid;grid-template-columns:1fr 1fr;margin:0 -14px -20px;padding:11px 14px;background:#fff;border-top:1px solid #e5eaf2}.modal-footer>button{width:100%}}
@media(max-width:360px){.record-card dl>div{grid-template-columns:1fr;gap:2px}.modal-footer{grid-template-columns:1fr}}
</style>

<style>
html[data-theme='dark'] .organization-page{color:var(--ink)}
html[data-theme='dark'] .organization-page :is(.page-head small,.list-summary,.record-card dt,.table-message td){color:var(--muted)}
html[data-theme='dark'] .organization-page :is(.page-head p,.list-summary button){color:var(--accent)}
html[data-theme='dark'] .organization-page :is(.filters label>span,.record-card dd){color:#c5d1e5}
html[data-theme='dark'] .organization-page :is(.desktop-table,.record-card){border-color:var(--line);background:var(--surface);color:var(--ink)}
html[data-theme='dark'] .organization-page th{border-color:var(--line);background:#1a315c;color:#c6d3e9}
html[data-theme='dark'] .organization-page td{border-color:var(--line);background:transparent;color:var(--ink)}
html[data-theme='dark'] .organization-page tbody tr:hover{background:rgba(121,167,255,.06)}
html[data-theme='dark'] .organization-page :is(.filters input,.filters select){border-color:#3b4d6d;background:#1a2742;color:var(--ink);color-scheme:dark}
html[data-theme='dark'] .organization-page .filters input::placeholder{color:#8090ad}
html[data-theme='dark'] .organization-page :is(.actions button,.record-card footer button){border-color:#405273;background:#1b2946;color:#d3deef}
html[data-theme='dark'] .organization-page :is(.actions button,.record-card footer button):hover{border-color:#6685b6;background:#243757;color:#fff}
html[data-theme='dark'] .organization-page .status--inactive{background:#273550;color:#b8c5da}
html[data-theme='dark'] .organization-page :is(.table-logo,.record-card__identity img){border-color:#405273;background:#eef3ff}
html[data-theme='dark'] .organization-crud-modal{border-color:var(--line)!important;background:#101a30!important;color:var(--ink)!important;box-shadow:0 24px 70px rgba(0,0,0,.5)}
html[data-theme='dark'] .organization-crud-modal :is(h2,.modal-heading p){color:var(--ink)}
html[data-theme='dark'] .organization-crud-modal :is(.modal-heading>span,.form-field small){color:var(--muted)}
html[data-theme='dark'] .organization-crud-modal .modal-heading p{color:var(--accent)}
html[data-theme='dark'] .organization-crud-modal .form-field>span{color:#c5d1e5}
html[data-theme='dark'] .organization-crud-modal :is(.form-field input,.form-field select,.form-field textarea){border-color:#3b4d6d!important;background:#1a2742!important;color:var(--ink)!important;color-scheme:dark}
html[data-theme='dark'] .organization-crud-modal :is(input,textarea)::placeholder{color:#8090ad}
html[data-theme='dark'] .organization-crud-modal :is(.modal-footer>button:not(.primary),.logo-editor button){border-color:#405273;background:#1b2946;color:#d3deef}
html[data-theme='dark'] .organization-crud-modal :is(.modal-footer>button:not(.primary),.logo-editor button):hover{border-color:#6685b6;background:#243757;color:#fff}
html[data-theme='dark'] .organization-crud-modal .close{color:#cbd7ea}
html[data-theme='dark'] .organization-crud-modal .close:hover{background:#243757;color:#fff}
html[data-theme='dark'] .organization-crud-modal :is(.table-logo,.logo-editor img){border-color:#405273;background:#eef3ff}
html[data-theme='dark'] .organization-crud-modal .modal-footer{border-color:var(--line);background:#101a30}
html[data-theme='dark'] .organization-crud-modal .modern-date-field{color:#c5d1e5}
html[data-theme='dark'] .organization-crud-modal .modern-date-field__trigger{border-color:#3b4d6d;background:#1a2742;color:var(--ink)}
html[data-theme='dark'] .organization-crud-modal .modern-date-field__trigger .placeholder{color:#8090ad}
html[data-theme='dark'] .organization-crud-modal .modern-date-field__trigger svg{stroke:#9cbcf1}
html[data-theme='dark'] .organization-crud-modal .modern-date-field__panel{border-color:#3b4d6d;background:#111c33;color:var(--ink);box-shadow:0 18px 45px rgba(0,0,0,.5)}
html[data-theme='dark'] .organization-crud-modal .modern-date-field__panel :is(select,header button){border-color:#405273;background:#1b2946;color:#dbe6f8}
html[data-theme='dark'] .organization-crud-modal .modern-date-field__weekdays span{color:#91a0ba}
html[data-theme='dark'] .organization-crud-modal .modern-date-field__days button{color:#dbe6f8}
html[data-theme='dark'] .organization-crud-modal .modern-date-field__days button:hover:not(:disabled){background:#243757;color:#fff}
html[data-theme='dark'] .organization-crud-modal .modern-date-field__days button.outside{color:#66758f}
html[data-theme='dark'] .organization-crud-modal .modern-date-field__panel footer{border-color:#334562}
</style>
