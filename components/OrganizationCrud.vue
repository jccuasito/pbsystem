<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'

type Field = { key: string; label: string; type?: 'text' | 'email' | 'date' | 'select' | 'textarea'; required?: boolean; optionsKey?: string }
type Column = { key: string; label: string }

const props = defineProps<{ resource: string; title: string; fields: Field[]; columns: Column[] }>()
const items = ref<any[]>([])
const lookups = ref<Record<string, any[]>>({})
const modalOpen = ref(false)
const editing = ref<any>(null)
const form = ref<Record<string, any>>({})
const busy = ref(false)
const error = ref('')
const loading = ref(true)

const modalTitle = computed(() => editing.value ? `Edit ${props.title.slice(0, -1)}` : `Add ${props.title.slice(0, -1)}`)
const idKey = computed(() => `${props.resource.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('')}ID`)

function resetForm(item: any = null) {
  editing.value = item
  form.value = Object.fromEntries(props.fields.map((field) => [field.key, item?.[field.key] ?? (field.key === 'Status' ? 'Active' : '')]))
  error.value = ''
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

async function save() {
  busy.value = true; error.value = ''
  try {
    const body = editing.value ? { id: editing.value[idKey.value], ...form.value } : form.value
    await $fetch(`/api/organization/${props.resource}`, { method: editing.value ? 'PUT' : 'POST', body })
    modalOpen.value = false
    await load()
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to save record.'
  } finally { busy.value = false }
}

async function deactivate(item: any) {
  if (!confirm(`Mark this ${props.title.slice(0, -1).toLowerCase()} as inactive?`)) return
  try {
    await $fetch(`/api/organization/${props.resource}`, { method: 'DELETE', body: { id: item[idKey.value] } })
    await load()
  } catch (cause: any) { error.value = cause.data?.statusMessage || 'Unable to deactivate record.' }
}

function display(item: any, column: Column) {
  const value = item[column.key]
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean' || value === 0 || value === 1) return Number(value) ? 'Yes' : 'No'
  return value
}

onMounted(load)
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !busy.value })
</script>

<template>
  <main class="organization-page">
    <header class="organization-page__header"><div><p>ORGANIZATION</p><h1>{{ title }}</h1></div><button class="primary" @click="add">+ Add {{ title.slice(0, -1) }}</button></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="table-wrap">
      <table><thead><tr><th v-for="column in columns" :key="column.key">{{ column.label }}</th><th>Actions</th></tr></thead>
        <tbody><tr v-if="loading"><td :colspan="columns.length + 1">Loading…</td></tr><tr v-else-if="!items.length"><td :colspan="columns.length + 1">No records found.</td></tr>
          <tr v-for="item in items" :key="item[idKey]"><td v-for="column in columns" :key="column.key"><span v-if="column.key === 'Status'" class="status" :class="`status--${item.Status?.toLowerCase()}`">{{ item.Status }}</span><template v-else>{{ display(item, column) }}</template></td><td class="actions"><button @click="edit(item)">Edit</button><button :disabled="item.Status === 'Inactive'" @click="deactivate(item)">Deactivate</button></td></tr>
        </tbody>
      </table>
    </div>
    <Teleport to="body"><div v-if="modalOpen" class="modal-backdrop" @click.self="!busy && (modalOpen = false)"><form class="modal" @submit.prevent="save"><button type="button" class="close" :disabled="busy" @click="modalOpen = false">×</button><h2>{{ modalTitle }}</h2>
      <label v-for="field in fields" :key="field.key">{{ field.label }}
        <textarea v-if="field.type === 'textarea'" v-model="form[field.key]" :required="field.required" />
        <select v-else-if="field.type === 'select'" v-model="form[field.key]" :required="field.required"><option value="">Select {{ field.label }}</option><template v-if="field.optionsKey"><option v-for="option in lookups[field.optionsKey] || []" :key="option[`${field.key.slice(0, -2)}ID`] || option.RegionID || option.ClientID" :value="option[`${field.key.slice(0, -2)}ID`] || option.RegionID || option.ClientID">{{ option.RegionName || option.ClientName }}</option></template><template v-else><option>Active</option><option>Inactive</option></template></select>
        <input v-else v-model="form[field.key]" :type="field.type || 'text'" :required="field.required" />
      </label>
      <p v-if="error" class="error">{{ error }}</p><footer><button type="button" @click="modalOpen = false">Cancel</button><button class="primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save' }}</button></footer>
    </form></div></Teleport>
  </main>
</template>

<style scoped>
.organization-page{padding:32px;max-width:1200px;margin:auto;color:#172033;font-family:Inter,system-ui,sans-serif}.organization-page__header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}.organization-page__header p{font-size:.75rem;font-weight:800;letter-spacing:.08em;color:#5271a5;margin:0}.organization-page__header h1{margin:3px 0 0;font-size:1.7rem}.primary{border:0;border-radius:8px;background:#2563eb;color:white;font-weight:700;padding:10px 15px;cursor:pointer}.table-wrap{overflow:auto;border:1px solid #dfe5ef;border-radius:10px;background:#fff}table{width:100%;border-collapse:collapse}th,td{padding:13px 14px;text-align:left;border-bottom:1px solid #edf1f6;font-size:.88rem;white-space:nowrap}th{background:#f8fafc;color:#526174;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}.actions{display:flex;gap:8px}.actions button,footer button{border:1px solid #cfd8e6;background:white;border-radius:6px;padding:6px 9px;cursor:pointer}.actions button:disabled{opacity:.45;cursor:not-allowed}.status{padding:3px 8px;border-radius:999px;font-size:.74rem;font-weight:700}.status--active{background:#dcfce7;color:#166534}.status--inactive{background:#fee2e2;color:#991b1b}.error{color:#b42318;margin:0 0 14px}.modal-backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px}.modal{position:relative;width:min(100%,520px);max-height:90vh;overflow:auto;background:white;border-radius:12px;padding:26px;display:grid;gap:13px}.modal h2{margin:0 0 4px}.modal label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#475569}.modal input,.modal select,.modal textarea{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #cfd8e6;border-radius:7px;padding:9px;font:inherit;color:#172033}.modal textarea{min-height:80px;resize:vertical}.modal footer{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}.close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.5rem;cursor:pointer}@media(max-width:600px){.organization-page{padding:20px}.organization-page__header{align-items:flex-start;gap:14px}.organization-page__header .primary{white-space:nowrap}}
</style>
