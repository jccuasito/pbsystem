<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'

type Status = 'Active' | 'Inactive'
type Kind = 'Loan' | 'Deduction'
type AppliesTo = Kind

type Classification = {
  ClassificationID: number
  ClassificationName: string
  AppliesTo: AppliesTo
  Description: string | null
  Status: Status
  LoanTypeCount?: number
  DeductionTypeCount?: number
}

type CatalogItem = {
  id: number
  name: string
  kind: Kind
  ClassificationID: number | null
  ClassificationName: string | null
  detail: string
  description: string | null
  Status: Status
  source: any
}

const loanTypes = ref<any[]>([])
const deductionTypes = ref<any[]>([])
const classifications = ref<Classification[]>([])
const loading = ref(true)
const busy = ref(false)
const pageError = ref('')
const search = ref('')
const kindFilter = ref('')
const classificationFilter = ref('')
const statusFilter = ref('Active')
const modalOpen = ref(false)
const modalKind = ref<'type' | 'classification'>('type')
const editing = ref<any>(null)
const modalError = ref('')
const confirmItem = ref<{ resource: string; id: number; name: string } | null>(null)
const collapsedClassifications = ref<Set<string>>(new Set())
const parentClassificationLocked = ref(false)

const typeForm = ref({
  Kind: 'Loan' as Kind,
  Name: '',
  ClassificationID: '',
  DeductionCategory: 'Other',
  DeductionPeriod: 'Monthly',
  Description: '',
  Status: 'Active' as Status,
})

const classificationForm = ref({
  ClassificationName: '',
  AppliesTo: 'Loan' as AppliesTo,
  Description: '',
  Status: 'Active' as Status,
})

const catalogItems = computed<CatalogItem[]>(() => [
  ...loanTypes.value.map(item => ({
    id: Number(item.LoanTypeID),
    name: item.LoanName,
    kind: 'Loan' as Kind,
    ClassificationID: item.ClassificationID ? Number(item.ClassificationID) : null,
    ClassificationName: item.ClassificationName,
    detail: '—',
    description: item.Description,
    Status: item.Status,
    source: item,
  })),
  ...deductionTypes.value.map(item => ({
    id: Number(item.DeductionTypeID),
    name: item.DeductionName,
    kind: 'Deduction' as Kind,
    ClassificationID: item.ClassificationID ? Number(item.ClassificationID) : null,
    ClassificationName: item.ClassificationName,
    detail: `${item.DeductionCategory || 'Other'} · ${item.DeductionPeriod || 'Monthly'}`,
    description: item.Description,
    Status: item.Status,
    source: item,
  })),
].sort((a, b) => a.name.localeCompare(b.name)))

const compatibleClassifications = computed(() => classifications.value.filter(item => {
  const selected = Number(typeForm.value.ClassificationID) === Number(item.ClassificationID)
  return (item.Status === 'Active' || selected) && item.AppliesTo === typeForm.value.Kind
}))

const groupedTypes = computed(() => {
  const words = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return classifications.value
    .filter(item => (!kindFilter.value || item.AppliesTo === kindFilter.value)
      && (!classificationFilter.value || Number(item.ClassificationID) === Number(classificationFilter.value))
      && (!statusFilter.value || item.Status === statusFilter.value))
    .map(item => {
      const parentHaystack = [item.ClassificationName, item.AppliesTo, item.Description, item.Status].join(' ').toLocaleLowerCase()
      const parentMatches = words.every(word => parentHaystack.includes(word))
      const eligibleChildren = catalogItems.value.filter(child => Number(child.ClassificationID) === Number(item.ClassificationID)
        && (!statusFilter.value || child.Status === statusFilter.value))
      const items = !words.length || parentMatches
        ? eligibleChildren
        : eligibleChildren.filter(child => {
            const haystack = [child.name, child.kind, child.detail, child.description, child.Status].join(' ').toLocaleLowerCase()
            return words.every(word => haystack.includes(word))
          })
      return {
        key: `${item.AppliesTo}-${item.ClassificationID}`,
        id: Number(item.ClassificationID),
        name: item.ClassificationName,
        kind: item.AppliesTo as Kind,
        items,
        classification: item,
        matches: !words.length || parentMatches || items.length > 0,
      }
    })
    .filter(group => group.matches)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
})
const groupedChildCount = computed(() => groupedTypes.value.reduce((total, group) => total + group.items.length, 0))
const modalTitle = computed(() => {
  if (modalKind.value === 'classification') return editing.value ? 'Edit classification' : 'Add classification'
  return editing.value ? `Edit ${typeForm.value.Kind.toLowerCase()} sub-classification` : `Add ${typeForm.value.Kind.toLowerCase()} sub-classification`
})

watch(() => typeForm.value.Kind, () => {
  const selected = classifications.value.find(item => Number(item.ClassificationID) === Number(typeForm.value.ClassificationID))
  if (selected && selected.AppliesTo !== typeForm.value.Kind) typeForm.value.ClassificationID = ''
})

function clearFilters() {
  search.value = ''
  kindFilter.value = ''
  classificationFilter.value = ''
  statusFilter.value = 'Active'
}

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    const [classificationResponse, loanResponse, deductionResponse] = await Promise.all([
      $fetch<any>('/api/deductions-loans/classification'),
      $fetch<any>('/api/deductions-loans/loan-type'),
      $fetch<any>('/api/deductions-loans/deduction-type'),
    ])
    classifications.value = classificationResponse.items || []
    loanTypes.value = loanResponse.items || []
    deductionTypes.value = deductionResponse.items || []
    pageError.value = ''
  } catch (cause: any) {
    pageError.value = cause.data?.statusMessage || 'Unable to load the loan and deduction catalog.'
  } finally {
    if (!silent) loading.value = false
  }
}

function openType(item: CatalogItem | null = null) {
  modalKind.value = 'type'
  editing.value = item
  modalError.value = ''
  parentClassificationLocked.value = false
  typeForm.value = item ? {
    Kind: item.kind,
    Name: item.name,
    ClassificationID: String(item.ClassificationID || ''),
    DeductionCategory: item.source.DeductionCategory || 'Other',
    DeductionPeriod: item.source.DeductionPeriod || 'Monthly',
    Description: item.description || '',
    Status: item.Status,
  } : {
    Kind: kindFilter.value === 'Deduction' ? 'Deduction' : 'Loan',
    Name: '', ClassificationID: '', DeductionCategory: 'Other', DeductionPeriod: 'Monthly', Description: '', Status: 'Active',
  }
  modalOpen.value = true
}

function openTypeForClassification(classification: Classification) {
  openType()
  typeForm.value.Kind = classification.AppliesTo
  typeForm.value.ClassificationID = String(classification.ClassificationID)
  parentClassificationLocked.value = true
}

function openClassification(item: Classification | null = null) {
  modalKind.value = 'classification'
  editing.value = item
  modalError.value = ''
  classificationForm.value = item ? {
    ClassificationName: item.ClassificationName,
    AppliesTo: item.AppliesTo,
    Description: item.Description || '',
    Status: item.Status,
  } : { ClassificationName: '', AppliesTo: 'Loan', Description: '', Status: 'Active' }
  modalOpen.value = true
}

function openPrimaryModal() {
  openClassification()
}

function closeModal() {
  if (busy.value) return
  modalOpen.value = false
  modalError.value = ''
}

async function save() {
  if (busy.value) return
  busy.value = true
  modalError.value = ''
  try {
    if (modalKind.value === 'classification') {
      const body = { ...(editing.value ? { id: editing.value.ClassificationID } : {}), ...classificationForm.value }
      await $fetch('/api/deductions-loans/classification', { method: editing.value ? 'PUT' : 'POST', body })
    } else {
      const resource = typeForm.value.Kind === 'Loan' ? 'loan-type' : 'deduction-type'
      const body: Record<string, unknown> = {
        ...(editing.value ? { id: editing.value.id } : {}),
        ClassificationID: Number(typeForm.value.ClassificationID),
        Description: typeForm.value.Description,
        Status: typeForm.value.Status,
      }
      if (typeForm.value.Kind === 'Loan') {
        body.LoanName = typeForm.value.Name
        body.GovernmentAgency = ''
      } else {
        body.DeductionName = typeForm.value.Name
        body.DeductionCategory = typeForm.value.DeductionCategory
        body.DeductionPeriod = typeForm.value.DeductionPeriod
      }
      await $fetch(`/api/deductions-loans/${resource}`, { method: editing.value ? 'PUT' : 'POST', body })
    }
    modalOpen.value = false
    await load()
  } catch (cause: any) {
    modalError.value = cause.data?.statusMessage || 'Unable to save this catalog record.'
  } finally {
    busy.value = false
  }
}

function requestDeactivate(resource: string, id: number, name: string) {
  confirmItem.value = { resource, id, name }
}

async function deactivate() {
  if (!confirmItem.value || busy.value) return
  busy.value = true
  pageError.value = ''
  try {
    await $fetch(`/api/deductions-loans/${confirmItem.value.resource}`, { method: 'DELETE', body: { id: confirmItem.value.id } })
    confirmItem.value = null
    await load()
  } catch (cause: any) {
    pageError.value = cause.data?.statusMessage || 'Unable to deactivate this record.'
    confirmItem.value = null
  } finally {
    busy.value = false
  }
}

function typeResource(item: CatalogItem) {
  return item.kind === 'Loan' ? 'loan-type' : 'deduction-type'
}

function toggleClassification(key: string) {
  const next = new Set(collapsedClassifications.value)
  next.has(key) ? next.delete(key) : next.add(key)
  collapsedClassifications.value = next
}

function addButtonLabel() {
  return modalKind.value === 'classification' ? 'Add classification' : 'Add sub-classification'
}

onMounted(load)
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !busy.value && !modalOpen.value && !confirmItem.value })
</script>

<template>
  <main class="catalog-page">
    <header class="page-head">
      <div>
        <p>DEDUCTIONS &amp; LOANS</p>
        <h1>Loan &amp; Deduction Catalog</h1>
        <small>Create classifications and their reusable sub-classifications. Employee amounts and schedules are assigned later.</small>
      </div>
      <button class="primary" type="button" @click="openPrimaryModal">+ Add classification</button>
    </header>

    <div v-if="pageError" class="error-banner" role="alert"><span>{{ pageError }}</span><button type="button" aria-label="Dismiss error" @click="pageError = ''">×</button></div>

    <section class="filters" aria-label="Catalog filters">
      <label class="search-field"><span>Search catalog</span><input v-model="search" type="search" placeholder="Search classification or sub-classification"></label>
      <label><span>Type</span><select v-model="kindFilter"><option value="">All</option><option value="Loan">Loans</option><option value="Deduction">Deductions</option></select></label>
      <label><span>Classification</span><select v-model="classificationFilter"><option value="">All classifications</option><option v-for="item in classifications" :key="item.ClassificationID" :value="String(item.ClassificationID)">{{ item.ClassificationName }}</option></select></label>
      <label><span>Status</span><select v-model="statusFilter"><option value="">All statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
    </section>

    <div class="list-summary">
      <span>{{ loading ? 'Loading catalog…' : `Showing ${groupedTypes.length} ${groupedTypes.length === 1 ? 'classification' : 'classifications'} and ${groupedChildCount} ${groupedChildCount === 1 ? 'sub-classification' : 'sub-classifications'}` }}</span>
      <button v-if="search || kindFilter || classificationFilter || statusFilter !== 'Active'" type="button" @click="clearFilters">Clear filters</button>
    </div>

    <div class="desktop-table">
      <table>
        <thead><tr><th>Sub-classification</th><th>Status</th><th class="actions-heading">Actions</th></tr></thead>
        <tbody>
          <tr v-if="loading" class="table-message"><td colspan="3">Loading sub-classifications…</td></tr>
          <tr v-else-if="!groupedTypes.length" class="table-message"><td colspan="3"><strong>No catalog entries found.</strong><span>Add a classification and its first sub-classification.</span></td></tr>
          <template v-for="group in groupedTypes" :key="group.key">
            <tr class="classification-group-row">
              <td colspan="3">
                <div class="classification-bar">
                  <button type="button" class="classification-toggle" :aria-expanded="!collapsedClassifications.has(group.key)" @click="toggleClassification(group.key)">
                    <span class="chevron" :class="{ collapsed: collapsedClassifications.has(group.key) }">⌄</span>
                    <span class="classification-title">
                      <strong>{{ group.name }}</strong>
                      <span class="classification-meta"><small>Classification</small><span class="kind" :class="`kind--${group.kind.toLowerCase()}`">{{ group.kind }}</span><span class="child-count">{{ group.items.length }} {{ group.items.length === 1 ? 'item' : 'items' }}</span></span>
                    </span>
                  </button>
                  <span class="status classification-status" :class="`status--${group.classification.Status.toLowerCase()}`">{{ group.classification.Status }}</span>
                  <div class="classification-actions">
                    <button class="add-child" type="button" :disabled="group.classification.Status === 'Inactive'" @click="openTypeForClassification(group.classification)">+ Add sub-classification</button>
                    <button type="button" @click="openClassification(group.classification)">Edit</button>
                    <button type="button" :disabled="group.classification.Status === 'Inactive'" @click="requestDeactivate('classification', group.classification.ClassificationID, group.classification.ClassificationName)">Deactivate</button>
                  </div>
                </div>
              </td>
            </tr>
            <tr v-for="item in collapsedClassifications.has(group.key) ? [] : group.items" :key="`${item.kind}-${item.id}`" class="subclassification-row">
              <td><strong>{{ item.name }}</strong><small v-if="item.detail !== '—'">{{ item.detail }}</small><small v-if="item.description">{{ item.description }}</small></td>
              <td><span class="status" :class="`status--${item.Status.toLowerCase()}`">{{ item.Status }}</span></td>
              <td><div class="actions"><button type="button" @click="openType(item)">Edit</button><button type="button" :disabled="item.Status === 'Inactive'" @click="requestDeactivate(typeResource(item), item.id, item.name)">Deactivate</button></div></td>
            </tr>
            <tr v-if="!collapsedClassifications.has(group.key) && !group.items.length" class="empty-children-row">
              <td colspan="3"><span>No sub-classifications yet.</span><button type="button" :disabled="group.classification.Status === 'Inactive'" @click="openTypeForClassification(group.classification)">Add the first one</button></td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <section class="mobile-list" aria-label="Catalog hierarchy">
      <p v-if="loading" class="mobile-message">Loading catalog…</p>
      <p v-else-if="!groupedTypes.length" class="mobile-message">No catalog entries match the current filters.</p>

      <section v-for="group in groupedTypes" :key="group.key" class="mobile-group">
          <button type="button" class="mobile-group__head" :aria-expanded="!collapsedClassifications.has(group.key)" @click="toggleClassification(group.key)">
            <span class="chevron" :class="{ collapsed: collapsedClassifications.has(group.key) }">⌄</span>
            <span class="mobile-group__title"><strong>{{ group.name }}</strong><small>Classification · {{ group.items.length }} {{ group.items.length === 1 ? 'item' : 'items' }}</small></span>
            <span class="mobile-group__badges"><span class="kind" :class="`kind--${group.kind.toLowerCase()}`">{{ group.kind }}</span><span class="status" :class="`status--${group.classification.Status.toLowerCase()}`">{{ group.classification.Status }}</span></span>
          </button>
          <div class="mobile-group__parent-actions"><button class="add-child" type="button" :disabled="group.classification.Status === 'Inactive'" @click="openTypeForClassification(group.classification)">+ Add sub-classification</button><button type="button" @click="openClassification(group.classification)">Edit classification</button><button type="button" :disabled="group.classification.Status === 'Inactive'" @click="requestDeactivate('classification', group.classification.ClassificationID, group.classification.ClassificationName)">Deactivate</button></div>
          <div v-if="!collapsedClassifications.has(group.key)" class="mobile-group__items">
            <div class="mobile-group__items-head"><strong>Sub-classifications</strong><span>{{ group.items.length }}</span></div>
            <div v-if="!group.items.length" class="mobile-empty"><span>No sub-classifications yet.</span><button type="button" :disabled="group.classification.Status === 'Inactive'" @click="openTypeForClassification(group.classification)">Add the first one</button></div>
            <article v-for="item in group.items" :key="`${item.kind}-${item.id}`" class="record-card">
              <header><strong>{{ item.name }}</strong><span class="status" :class="`status--${item.Status.toLowerCase()}`">{{ item.Status }}</span></header>
              <div v-if="item.detail !== '—'" class="card-tags"><span>{{ item.detail }}</span></div>
              <p v-if="item.description">{{ item.description }}</p>
              <footer><button type="button" @click="openType(item)">Edit</button><button type="button" :disabled="item.Status === 'Inactive'" @click="requestDeactivate(typeResource(item), item.id, item.name)">Deactivate</button></footer>
            </article>
          </div>
      </section>

    </section>

    <Teleport to="body">
      <div v-if="modalOpen" class="modal-backdrop" @click.self="closeModal">
        <form class="catalog-modal" @submit.prevent="save">
          <button type="button" class="close" aria-label="Close" :disabled="busy" @click="closeModal">×</button>
          <header class="modal-heading"><p>DEDUCTIONS &amp; LOANS</p><h2>{{ modalTitle }}</h2><span>{{ modalKind === 'classification' ? (editing ? 'Update this parent classification.' : 'Create a parent classification, then add its sub-classifications from the catalog list.') : editing ? 'Update the sub-classification and its parent assignment.' : 'Add a reusable child under the selected parent classification.' }} Employee amounts are entered later.</span></header>

          <div v-if="modalKind === 'type'" class="form-grid">
            <label class="form-field"><span>Type</span><select v-model="typeForm.Kind" :disabled="Boolean(editing) || parentClassificationLocked" required><option value="Loan">Loan</option><option value="Deduction">Deduction</option></select></label>
            <label class="form-field"><span>Sub-classification name</span><input v-model="typeForm.Name" maxlength="100" :placeholder="typeForm.Kind === 'Loan' ? 'e.g. SSS Salary Loan' : 'e.g. Uniform deduction'" required></label>
            <label class="form-field form-field--wide"><span>Parent classification</span><select v-model="typeForm.ClassificationID" :disabled="parentClassificationLocked" required><option value="">Select classification</option><option v-for="item in compatibleClassifications" :key="item.ClassificationID" :value="String(item.ClassificationID)">{{ item.ClassificationName }}{{ item.Status === 'Inactive' ? ' (Inactive)' : '' }}</option></select><small v-if="parentClassificationLocked">This sub-classification will be added under the selected parent.</small></label>
            <template v-if="typeForm.Kind === 'Deduction'">
              <label class="form-field"><span>Deduction category</span><select v-model="typeForm.DeductionCategory"><option>Government</option><option>Loan</option><option>Company</option><option>Other</option></select></label>
              <label class="form-field"><span>Default frequency</span><select v-model="typeForm.DeductionPeriod"><option>Monthly</option><option>Semi-Monthly</option><option>Weekly</option><option>One-Time</option></select></label>
            </template>
            <label class="form-field form-field--wide"><span>Description <em>Optional</em></span><textarea v-model="typeForm.Description" maxlength="255" placeholder="Short note explaining when this type is used"></textarea></label>
            <label class="form-field"><span>Status</span><select v-model="typeForm.Status"><option>Active</option><option>Inactive</option></select></label>
          </div>

          <div v-else class="form-grid">
            <label class="form-field"><span>Classification name</span><input v-model="classificationForm.ClassificationName" maxlength="100" placeholder="e.g. PAG-IBIG or SSS" required></label>
            <label class="form-field"><span>Applies to</span><select v-model="classificationForm.AppliesTo"><option>Loan</option><option>Deduction</option></select></label>
            <label class="form-field form-field--wide"><span>Description <em>Optional</em></span><textarea v-model="classificationForm.Description" maxlength="255" placeholder="Describe the group of records under this classification"></textarea></label>
            <label class="form-field"><span>Status</span><select v-model="classificationForm.Status"><option>Active</option><option>Inactive</option></select></label>
          </div>

          <p v-if="modalError" class="modal-error" role="alert">{{ modalError }}</p>
          <footer class="modal-footer"><button type="button" :disabled="busy" @click="closeModal">Cancel</button><button class="primary" :disabled="busy">{{ busy ? 'Saving…' : editing ? 'Save changes' : addButtonLabel() }}</button></footer>
        </form>
      </div>

      <div v-if="confirmItem" class="modal-backdrop" @click.self="!busy && (confirmItem = null)">
        <section class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="deactivate-title">
          <div class="confirm-icon">!</div>
          <div><p>DEACTIVATE RECORD</p><h2 id="deactivate-title">Deactivate {{ confirmItem.name }}?</h2><span>It will no longer appear in active choices. Existing employee records can still keep their saved reference.</span></div>
          <footer><button type="button" :disabled="busy" @click="confirmItem = null">Cancel</button><button class="danger" type="button" :disabled="busy" @click="deactivate">{{ busy ? 'Deactivating…' : 'Deactivate' }}</button></footer>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.catalog-page{box-sizing:border-box;width:100%;max-width:1500px;margin:auto;padding:32px;color:#172033;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:22px}.page-head p,.modal-heading p,.confirm-modal p{margin:0;color:#3465d9;font-size:.72rem;font-weight:850;letter-spacing:.08em}.page-head h1{margin:3px 0;font-size:1.72rem}.page-head small{color:#64748b}.primary{min-height:42px;border:0;border-radius:9px;background:#2563eb!important;color:#fff!important;padding:10px 16px;font:inherit;font-weight:800;white-space:nowrap;cursor:pointer}.primary:disabled{opacity:.6;cursor:wait}.error-banner{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;padding:10px 13px;border:1px solid #fecaca;border-radius:9px;background:#fff7f7;color:#b42318;font-size:.8rem;font-weight:700}.error-banner button{border:0;background:transparent;color:inherit;font-size:1.15rem;cursor:pointer}.tabs{display:flex;width:max-content;max-width:100%;gap:4px;margin-bottom:18px;padding:4px;border:1px solid #dce4ef;border-radius:10px;background:#eef3f9}.tabs button{display:flex;align-items:center;gap:7px;min-height:36px;border:0;border-radius:7px;padding:7px 12px;background:transparent;color:#5d6f88;font:inherit;font-size:.78rem;font-weight:800;cursor:pointer}.tabs button.active{background:#fff;color:#1d4ed8;box-shadow:0 1px 4px rgba(30,64,175,.12)}.tabs button span{display:grid;min-width:20px;height:20px;place-items:center;border-radius:999px;background:#dce7f6;color:#47617f;font-size:.65rem}.tabs button.active span{background:#e8efff;color:#1d4ed8}.filters{display:grid;grid-template-columns:minmax(280px,1fr) repeat(3,minmax(145px,220px));align-items:end;gap:11px;margin-bottom:9px}.filters--classifications{grid-template-columns:minmax(280px,1fr) repeat(2,minmax(145px,220px))}.filters label,.form-field{display:grid;min-width:0;gap:6px}.filters label>span,.form-field>span{color:#475569;font-size:.76rem;font-weight:800}.filters input,.filters select,.form-field input,.form-field select,.form-field textarea{box-sizing:border-box;width:100%;min-width:0;min-height:42px;border:1px solid #cbd6e5;border-radius:9px;padding:8px 11px;background:#fff;color:#172033;font:inherit}.filters input:focus,.filters select:focus,.form-field input:focus,.form-field select:focus,.form-field textarea:focus{border-color:#7798d0;box-shadow:0 0 0 3px rgba(35,73,230,.1);outline:0}.list-summary{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 1px 10px;color:#64748b;font-size:.77rem}.list-summary button{border:0;background:transparent;color:#2458c4;font:inherit;font-weight:800;cursor:pointer}.desktop-table{overflow:hidden;border:1px solid #dfe5ef;border-radius:12px;background:#fff}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{min-width:0;padding:10px 12px;border-bottom:1px solid #edf1f6;text-align:left;vertical-align:middle;font-size:.8rem;overflow-wrap:anywhere}th{background:#f8fafc;color:#526174;font-size:.68rem;text-transform:uppercase;letter-spacing:.025em}tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:#fbfdff}td:first-child{width:20%}td strong{display:block;font-size:.82rem}td small{display:block;margin-top:3px;color:#71809a;font-size:.68rem;line-height:1.3}.actions-heading{width:184px}.actions{display:flex;gap:6px;white-space:nowrap}.actions button,.record-card footer button,.modal-footer>button,.confirm-modal footer button{min-height:34px;border:1px solid #cbd6e5;border-radius:8px;padding:6px 9px;background:#fff;color:#29486e;font:inherit;font-size:.73rem;font-weight:800;white-space:nowrap;cursor:pointer}.actions button:disabled,.record-card footer button:disabled{opacity:.42;cursor:not-allowed}.status,.kind{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;font-size:.67rem;font-weight:850;white-space:nowrap}.status{background:#dcfce7;color:#147a3d}.status--inactive{background:#f1f5f9;color:#64748b}.kind--loan{background:#e8efff;color:#2455b4}.kind--deduction{background:#f3e8ff;color:#7e22ce}.table-message td{padding:32px;text-align:center;color:#64748b}.table-message strong,.table-message span{display:block}.table-message span{margin-top:4px;font-size:.74rem}.mobile-list{display:none}.modal-backdrop{position:fixed;inset:0;z-index:400;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.62)}.catalog-modal,.confirm-modal{box-sizing:border-box;position:relative;display:grid;width:min(100%,700px);max-height:calc(100dvh - 36px);gap:17px;padding:24px;overflow:auto;border:1px solid #d9e2ef;border-radius:16px;background:#fff;color:#172033;box-shadow:0 24px 70px rgba(15,23,42,.32);font-family:Inter,system-ui,sans-serif}.close{position:absolute;z-index:3;top:12px;right:12px;display:grid;width:34px;height:34px;place-items:center;border:0;border-radius:8px;background:transparent;color:#53657d;font:inherit;font-size:1.35rem;cursor:pointer}.close:hover{background:#edf3fa}.modal-heading{padding-right:38px}.modal-heading h2,.confirm-modal h2{margin:3px 0 4px;font-size:1.4rem}.modal-heading>span,.confirm-modal>div>span{color:#64748b;font-size:.78rem;line-height:1.5}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:13px}.form-field--wide{grid-column:1/-1}.form-field textarea{min-height:78px;resize:vertical}.form-field small{color:#b45309;font-size:.7rem;font-weight:700}.form-field em{float:right;color:#8794a8;font-size:.65rem;font-style:normal;font-weight:700}.modal-error{margin:0;padding:9px 11px;border:1px solid #fecaca;border-radius:8px;background:#fff7f7;color:#b42318;font-size:.76rem}.modal-footer{display:flex;justify-content:flex-end;gap:9px;padding-top:2px}.modal-footer>button{min-height:40px;padding:8px 14px}.confirm-modal{grid-template-columns:auto 1fr;width:min(100%,500px);overflow:visible}.confirm-icon{display:grid;width:42px;height:42px;place-items:center;border-radius:50%;background:#fff1f2;color:#be123c;font-size:1.2rem;font-weight:900}.confirm-modal footer{display:flex;grid-column:1/-1;justify-content:flex-end;gap:8px}.confirm-modal .danger{border-color:#be123c;background:#be123c;color:#fff}.record-card{display:grid;gap:11px;padding:14px;border:1px solid #dfe5ef;border-radius:12px;background:#fff}.record-card>header{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.record-card>header>div{display:grid;min-width:0;gap:3px}.record-card>header strong{font-size:.86rem;overflow-wrap:anywhere}.record-card>header div span{color:#64748b;font-size:.7rem}.card-tags{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.card-tags>span:not(.kind){color:#526174;font-size:.72rem}.record-card>p{margin:0;color:#526174;font-size:.75rem;line-height:1.45}.record-card footer{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.record-card footer button{min-height:38px}
.actions-heading{width:320px}
.desktop-table th:first-child,.desktop-table td:first-child{width:auto}.desktop-table th:nth-child(2){width:92px}
.classification-group-row td{padding:0;background:#f2f6fc}
.classification-group-row:hover{background:transparent}
.classification-bar{display:grid;grid-template-columns:minmax(0,1fr) 92px 320px;align-items:center;padding:9px 0}
.classification-toggle{display:flex;min-width:0;align-items:center;gap:9px;border:0;padding:0 12px;background:transparent;color:#17375f;font:inherit;text-align:left;cursor:pointer}
.classification-toggle .chevron,.mobile-group__head .chevron{display:inline-block;flex:0 0 auto;color:#64748b;font-size:.8rem;transition:transform .18s ease}
.classification-toggle .chevron.collapsed,.mobile-group__head .chevron.collapsed{transform:rotate(-90deg)}
.classification-title{display:grid;min-width:0;gap:3px}
.classification-title strong{font-size:.84rem}
.classification-title small{margin:0;color:#71809a;font-size:.64rem;font-weight:700}
.classification-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.child-count{color:#71809a;font-size:.68rem;font-weight:750;white-space:nowrap}
.classification-status{justify-self:start;margin-left:12px}
.classification-actions{display:flex;align-items:center;gap:6px;padding-left:12px}
.classification-actions button,.empty-children-row button,.mobile-empty button{min-height:32px;border:1px solid #cbd6e5;border-radius:8px;padding:5px 9px;background:#fff;color:#29486e;font:inherit;font-size:.7rem;font-weight:800;white-space:nowrap;cursor:pointer}
.classification-actions .add-child,.mobile-group__parent-actions .add-child{border-color:#b8cbef;background:#eaf1ff;color:#1d4ed8}
.classification-actions button:disabled,.empty-children-row button:disabled,.mobile-empty button:disabled{opacity:.42;cursor:not-allowed}
.subclassification-row td:first-child{position:relative;padding-left:39px}
.subclassification-row td:first-child::before{position:absolute;top:0;bottom:0;left:21px;border-left:1px solid #d8e1ed;content:''}
.empty-children-row td{padding:16px 16px 16px 39px;color:#71809a;font-size:.74rem}.empty-children-row td span{margin-right:10px}
.mobile-group{display:grid;overflow:hidden;border:1px solid #dfe5ef;border-radius:12px;background:#fff}
.mobile-group__head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;border:0;padding:12px;background:#f2f6fc;color:#17375f;font:inherit;text-align:left;cursor:pointer}
.mobile-group__title{display:grid;min-width:0;gap:2px}.mobile-group__title strong{font-size:.84rem;overflow-wrap:anywhere}.mobile-group__title small{color:#71809a;font-size:.66rem;font-weight:700}
.mobile-group__badges{display:flex;align-items:center;justify-content:flex-end;gap:5px;flex-wrap:wrap}
.mobile-group__items{display:grid;gap:8px;padding:10px;background:#fafcff}
.mobile-group__items-head{display:flex;align-items:center;justify-content:space-between;color:#526174;font-size:.7rem}.mobile-group__items-head span{display:grid;min-width:21px;height:21px;place-items:center;border-radius:999px;background:#e5edf8;font-size:.64rem;font-weight:850}
.mobile-group__items .record-card{gap:8px;padding:11px;border-radius:9px;box-shadow:none}.mobile-group__items .record-card>header{align-items:center}
.mobile-empty{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px;border:1px dashed #cbd6e5;border-radius:9px;color:#71809a;font-size:.72rem}
.mobile-group__parent-actions{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;padding:0 10px 10px;background:#f2f6fc}
.mobile-group__parent-actions .add-child{grid-column:1/-1}
.mobile-group__parent-actions button{min-height:34px;border:1px solid #cbd6e5;border-radius:8px;background:#fff;color:#29486e;font:inherit;font-size:.69rem;font-weight:800;cursor:pointer}
.mobile-group__parent-actions button:disabled{opacity:.42;cursor:not-allowed}
@media(max-width:1050px){.filters{grid-template-columns:repeat(3,minmax(0,1fr))}.filters .search-field{grid-column:1/-1}.filters--classifications{grid-template-columns:2fr 1fr 1fr}.filters--classifications .search-field{grid-column:auto}}
@media(max-width:900px){.catalog-page{padding:22px 18px}.desktop-table{display:none}.mobile-list{display:grid;gap:10px}}
@media(max-width:650px){.catalog-page{padding:16px 12px}.page-head{align-items:stretch;flex-direction:column;margin-bottom:17px}.page-head .primary{width:100%}.tabs{width:100%}.tabs button{justify-content:center;flex:1}.filters,.filters--classifications{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.filters .search-field,.filters--classifications .search-field{grid-column:1/-1;grid-row:1}.filters label:nth-child(2){grid-column:1;grid-row:2}.filters label:nth-child(4){grid-column:2;grid-row:2}.filters label:nth-child(3){grid-column:1/-1;grid-row:3}.list-summary{align-items:flex-start;flex-direction:column;gap:5px}.mobile-group__badges .status{display:none}.modal-backdrop{align-items:end;padding:0}.catalog-modal{width:100%;max-height:calc(100dvh - 10px);gap:14px;padding:20px 14px;border-radius:16px 16px 0 0}.form-grid{grid-template-columns:1fr}.form-field--wide{grid-column:auto}.modal-footer{position:sticky;bottom:-20px;display:grid;grid-template-columns:1fr 1fr;margin:0 -14px -20px;padding:11px 14px;background:#fff;border-top:1px solid #e5eaf2}.modal-footer>button{width:100%}.confirm-modal{align-self:center;width:calc(100% - 24px);grid-template-columns:1fr;padding:20px}.confirm-modal .confirm-icon{margin-bottom:-4px}.confirm-modal footer{grid-column:auto;display:grid;grid-template-columns:1fr 1fr}.confirm-modal footer button{min-height:40px}}
@media(max-width:370px){.tabs{display:grid;width:100%}.filters,.filters--classifications{grid-template-columns:1fr}.filters label:nth-child(n){grid-column:1;grid-row:auto}.mobile-group__head{grid-template-columns:auto minmax(0,1fr)}.mobile-group__badges{grid-column:2;justify-content:flex-start}.mobile-empty{align-items:stretch;flex-direction:column}.confirm-modal footer,.modal-footer{grid-template-columns:1fr}}
</style>

<style>
html[data-theme='dark'] .catalog-page{color:var(--ink)}
html[data-theme='dark'] .catalog-page :is(.page-head small,.list-summary,.table-message td,.record-card>header div span,.record-card>p){color:var(--muted)}
html[data-theme='dark'] .catalog-page :is(.page-head p,.list-summary button){color:var(--accent)}
html[data-theme='dark'] .catalog-page .tabs{border-color:var(--line);background:#12203a}
html[data-theme='dark'] .catalog-page .tabs button{color:#9fb0cb}
html[data-theme='dark'] .catalog-page .tabs button.active{background:#213557;color:#8cb4ff;box-shadow:none}
html[data-theme='dark'] .catalog-page .tabs button span{background:#273b5d;color:#b7c8e1}
html[data-theme='dark'] .catalog-page :is(.desktop-table,.record-card){border-color:var(--line);background:var(--surface);color:var(--ink)}
html[data-theme='dark'] .catalog-page th{border-color:var(--line);background:#1a315c;color:#c6d3e9}
html[data-theme='dark'] .catalog-page td{border-color:var(--line);background:transparent;color:var(--ink)}
html[data-theme='dark'] .catalog-page tbody tr:hover{background:rgba(121,167,255,.06)}
html[data-theme='dark'] .catalog-page td small{color:#91a3c0}
html[data-theme='dark'] .catalog-page .classification-group-row td{background:#172845}
html[data-theme='dark'] .catalog-page :is(.classification-toggle,.mobile-group__head){color:var(--ink)}
html[data-theme='dark'] .catalog-page .classification-toggle small{color:#91a3c0}
html[data-theme='dark'] .catalog-page .subclassification-row td:first-child::before{border-color:#405273}
html[data-theme='dark'] .catalog-page :is(.child-count,.mobile-group__title small,.empty-children-row td,.mobile-empty){color:#91a3c0}
html[data-theme='dark'] .catalog-page .mobile-group{border-color:var(--line);background:var(--surface)}
html[data-theme='dark'] .catalog-page .mobile-group__head{background:#172845}
html[data-theme='dark'] .catalog-page .mobile-group__parent-actions{background:#172845}
html[data-theme='dark'] .catalog-page .mobile-group__items{background:#101d34}
html[data-theme='dark'] .catalog-page .mobile-group__items-head{color:#b7c8e1}
html[data-theme='dark'] .catalog-page .mobile-group__items-head span{background:#273b5d;color:#b7c8e1}
html[data-theme='dark'] .catalog-page .mobile-empty{border-color:#405273}
html[data-theme='dark'] .catalog-page :is(.classification-actions button,.mobile-group__parent-actions button,.empty-children-row button,.mobile-empty button){border-color:#405273;background:#1b2946;color:#d3deef}
html[data-theme='dark'] .catalog-page :is(.classification-actions,.mobile-group__parent-actions) .add-child{border-color:#3b65ad;background:#203d70;color:#bcd2ff}
html[data-theme='dark'] .catalog-page :is(.filters input,.filters select){border-color:#3b4d6d;background:#1a2742;color:var(--ink);color-scheme:dark}
html[data-theme='dark'] .catalog-page .filters input::placeholder{color:#8090ad}
html[data-theme='dark'] .catalog-page .filters label>span{color:#c5d1e5}
html[data-theme='dark'] .catalog-page :is(.actions button,.record-card footer button){border-color:#405273;background:#1b2946;color:#d3deef}
html[data-theme='dark'] .catalog-page .status--inactive{background:#273550;color:#b8c5da}
html[data-theme='dark'] .catalog-page .error-banner{border-color:#7f3340;background:#3d1e28;color:#fecdd3}
html[data-theme='dark'] .catalog-modal,html[data-theme='dark'] .confirm-modal{border-color:var(--line)!important;background:#14223d!important;color:var(--ink)!important}
html[data-theme='dark'] .catalog-modal :is(.modal-heading>span,.confirm-modal>div>span){color:#9eacc2}
html[data-theme='dark'] .catalog-modal :is(.form-field>span){color:#c4d0e3}
html[data-theme='dark'] .catalog-modal :is(input,select,textarea){border-color:#405273!important;background:#1b2946!important;color:#e6edf8!important;color-scheme:dark}
html[data-theme='dark'] .catalog-modal :is(input,textarea)::placeholder{color:#7f90ac}
html[data-theme='dark'] .catalog-modal .close{color:#b9c7dc}
html[data-theme='dark'] .catalog-modal .close:hover{background:#243757}
html[data-theme='dark'] .catalog-modal .modal-footer{border-color:#344763;background:rgba(20,34,61,.97)}
html[data-theme='dark'] .catalog-modal .modal-footer>button:not(.primary),html[data-theme='dark'] .confirm-modal footer button:not(.danger){border-color:#405273;background:#1b2946;color:#d3deef}
html[data-theme='dark'] .catalog-modal .modal-error{border-color:#7f3340;background:#3d1e28;color:#fecdd3}
</style>

