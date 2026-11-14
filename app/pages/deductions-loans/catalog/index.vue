<script setup lang="ts">
import { requestErrorMessage } from '~~/shared/utils/requestError'

import { computed, onMounted, ref, watch } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import '../../../../assets/css/setup-directory.css'

type Status = 'Active' | 'Inactive'
type Kind = 'Loan' | 'Deduction' | 'Contribution' | 'Recurring Deduction'
type AppliesTo = Kind

type Classification = {
  ClassificationID: number
  ClassificationName: string
  AppliesTo: AppliesTo
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
  Status: Status
  IsRefundable?: number
  DeductionCategory?: 'Government' | 'Loan' | 'Company' | 'Other'
  DeductionPeriod?: 'Monthly' | 'Semi-Monthly' | 'Weekly' | 'One-Time'
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
const expandedKinds = ref(new Set<Kind>())
const collapsedClassifications = ref<Set<string>>(new Set())
const collapsedStateInitialized = ref(false)
const parentClassificationLocked = ref(false)

const typeForm = ref({
  IsRefundable: false,
  Kind: 'Loan' as Kind,
  Name: '',
  ClassificationID: '',
  Status: 'Active' as Status,
  DeductionCategory: 'Company' as 'Government' | 'Loan' | 'Company' | 'Other',
  DeductionPeriod: 'Monthly' as 'Monthly' | 'Semi-Monthly' | 'Weekly' | 'One-Time',
})

const classificationForm = ref({
  ClassificationName: '',
  AppliesTo: 'Loan' as AppliesTo,
  Status: 'Active' as Status,
})

const catalogItems = computed<CatalogItem[]>(() => [
  ...loanTypes.value.map(item => ({
    id: Number(item.LoanTypeID),
    name: item.LoanName,
    kind: 'Loan' as Kind,
    ClassificationID: item.ClassificationID ? Number(item.ClassificationID) : null,
    ClassificationName: item.ClassificationName,
    Status: item.Status,
  })),
  ...deductionTypes.value.map(item => ({
    id: Number(item.DeductionTypeID),
    name: item.DeductionName,
    kind: (item.AppliesTo || 'Deduction') as Kind,
    ClassificationID: item.ClassificationID ? Number(item.ClassificationID) : null,
    ClassificationName: item.ClassificationName,
    Status: item.Status,
    IsRefundable: Number(item.IsRefundable),
    DeductionCategory: item.DeductionCategory,
    DeductionPeriod: item.DeductionPeriod,
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
      const parentHaystack = [item.ClassificationName, item.AppliesTo, item.Status].join(' ').toLocaleLowerCase()
      const parentMatches = words.every(word => parentHaystack.includes(word))
      const eligibleChildren = catalogItems.value.filter(child => Number(child.ClassificationID) === Number(item.ClassificationID)
        && (!statusFilter.value || child.Status === statusFilter.value))
      const items = !words.length || parentMatches
        ? eligibleChildren
        : eligibleChildren.filter(child => {
            const haystack = [child.name, child.kind, child.Status].join(' ').toLocaleLowerCase()
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
const catalogSections = computed(() => ([
  { kind: 'Contribution', title: 'Contributions', hint: 'Scheduled employee contributions.' },
  { kind: 'Recurring Deduction', title: 'Recurring deductions', hint: 'Scheduled deductions, including items with optional refunds.' },
  { kind: 'Deduction', title: 'Deductions', hint: 'Items assigned through employee deduction accounts.' },
  { kind: 'Loan', title: 'Loans', hint: 'Items assigned through employee loan accounts.' },
] as const).map(section => {
  const groups = groupedTypes.value.filter(group => group.kind === section.kind)
  return { ...section, groups, count: groups.reduce((total, group) => total + group.items.length, 0) }
}).filter(section => section.groups.length))
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
    if (!collapsedStateInitialized.value) {
      collapsedClassifications.value = new Set(classifications.value.map(item => `${item.AppliesTo}-${item.ClassificationID}`))
      collapsedStateInitialized.value = true
    }
    pageError.value = ''
  } catch (cause: any) {
    pageError.value = requestErrorMessage(cause, 'Unable to load the loan and deduction catalog.')
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
    IsRefundable: Boolean(item.IsRefundable),
    Kind: item.kind,
    Name: item.name,
    ClassificationID: String(item.ClassificationID || ''),
    Status: item.Status,
    DeductionCategory: item.DeductionCategory || 'Other',
    DeductionPeriod: item.DeductionPeriod || 'Monthly',
  } : {
    Kind: ['Deduction','Contribution','Recurring Deduction'].includes(kindFilter.value) ? kindFilter.value as Kind : 'Loan',
    IsRefundable: false, Name: '', ClassificationID: '', Status: 'Active',
    DeductionCategory: 'Company', DeductionPeriod: 'Monthly',
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
    Status: item.Status,
  } : { ClassificationName: '', AppliesTo: 'Loan', Status: 'Active' }
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
        Status: typeForm.value.Status,
      }
      if (typeForm.value.Kind === 'Loan') {
        body.LoanName = typeForm.value.Name
      } else {
        body.DeductionName = typeForm.value.Name
        body.DeductionCategory = typeForm.value.Kind === 'Contribution' ? 'Government' : typeForm.value.DeductionCategory
        body.DeductionPeriod = typeForm.value.DeductionPeriod
        body.IsRefundable = typeForm.value.Kind === 'Recurring Deduction' && typeForm.value.IsRefundable
      }
      await $fetch(`/api/deductions-loans/${resource}`, { method: editing.value ? 'PUT' : 'POST', body })
    }
    modalOpen.value = false
    await load()
  } catch (cause: any) {
    modalError.value = requestErrorMessage(cause, 'Unable to save this catalog record.')
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
    pageError.value = requestErrorMessage(cause, 'Unable to deactivate this record.')
    confirmItem.value = null
  } finally {
    busy.value = false
  }
}

function typeResource(item: CatalogItem) {
  return item.kind === 'Loan' ? 'loan-type' : 'deduction-type'
}

function toggleKind(kind: Kind) {
  const next = new Set(expandedKinds.value)
  next.has(kind) ? next.delete(kind) : next.add(kind)
  expandedKinds.value = next
}
watch([search, kindFilter, classificationFilter, statusFilter], () => {
  const filtered = search.value.trim() || kindFilter.value || classificationFilter.value || statusFilter.value !== 'Active'
  expandedKinds.value = new Set(filtered ? catalogSections.value.map(section => section.kind) : [])
  if (!search.value.trim() && !classificationFilter.value) return
  const next = new Set(collapsedClassifications.value)
  for (const group of groupedTypes.value) next.delete(group.key)
  collapsedClassifications.value = next
})

function isCollapsed(key: string) {
  return collapsedClassifications.value.has(key)
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
        <h1>Loan, Deduction &amp; Contribution Catalog</h1>
        <small>Maintain the names available when assigning loans, deductions, and contributions to employees.</small>
      </div>
      <button class="primary" type="button" @click="openPrimaryModal">+ Add classification</button>
    </header>

    <div v-if="pageError" class="error-banner" role="alert"><span>{{ pageError }}</span><button type="button" aria-label="Dismiss error" @click="pageError = ''">×</button></div>

    <section class="filters directory-filters" aria-label="Catalog filters">
      <label class="search-field"><span>Search catalog</span><input v-model="search" type="search" placeholder="Search classification or sub-classification"></label>
      <label><span>Type</span><select v-model="kindFilter"><option value="">All</option><option value="Loan">Loans</option><option value="Deduction">Deductions</option><option value="Contribution">Contributions</option><option value="Recurring Deduction">Recurring deductions</option></select></label>
      <label><span>Classification</span><select v-model="classificationFilter"><option value="">All classifications</option><option v-for="item in classifications" :key="item.ClassificationID" :value="String(item.ClassificationID)">{{ item.ClassificationName }}</option></select></label>
      <label><span>Status</span><select v-model="statusFilter"><option value="">All statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
    </section>

    <div class="list-summary setup-directory-heading"><div><h2>Catalog types</h2><p>Browse classifications and their reusable items.</p></div>
      <span class="directory-total">{{ loading ? 'Loading catalog…' : `Showing ${groupedTypes.length} ${groupedTypes.length === 1 ? 'classification' : 'classifications'} and ${groupedChildCount} ${groupedChildCount === 1 ? 'sub-classification' : 'sub-classifications'}` }}</span>
      <button v-if="search || kindFilter || classificationFilter || statusFilter !== 'Active'" type="button" @click="clearFilters">Clear filters</button>
    </div>

    <p v-if="loading" class="catalog-empty" role="status">Loading catalog...</p>
    <p v-else-if="!catalogSections.length" class="catalog-empty">No catalog entries match the current filters.</p>
    <div v-else class="catalog-directory setup-directory">
      <div class="directory-columns" aria-hidden="true"><span>Type</span><span>Classifications</span><span>Items</span><span></span></div>
    <section v-for="section in catalogSections" :key="section.kind" class="catalog-section" :class="{'is-open':expandedKinds.has(section.kind)}" :aria-labelledby="`catalog-${section.kind.replaceAll(' ', '-')}`">
      <header class="catalog-section-heading">
        <h2 :id="`catalog-${section.kind.replaceAll(' ', '-')}`"><button type="button" class="catalog-type-toggle directory-row" :aria-expanded="expandedKinds.has(section.kind)" :aria-controls="`catalog-content-${section.kind.replaceAll(' ', '-')}`" @click="toggleKind(section.kind)">
          <span class="directory-icon" :class="`directory-icon--${section.kind.toLowerCase().replaceAll(' ', '-')}`" aria-hidden="true"><svg viewBox="0 0 24 24">
            <template v-if="section.kind==='Contribution'"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></template>
            <template v-else-if="section.kind==='Recurring Deduction'"><path d="M20 7h-9a6 6 0 0 0-6 6M16 3l4 4-4 4M4 17h9a6 6 0 0 0 6-6M8 21l-4-4 4-4"/></template>
            <template v-else-if="section.kind==='Deduction'"><circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></template>
            <template v-else><path d="M3 6h16v14H3zM3 6V4h13v2M15 11h6v5h-6zM17.5 13.5h.01"/></template>
          </svg></span>
          <span class="directory-identity"><span class="catalog-type-name directory-title">{{ section.title }}</span><span class="directory-subtitle">{{ section.hint }}</span></span>
          <span class="directory-stats">
          <span class="directory-metric"><span class="metric-value">{{ section.groups.length }}</span><span class="metric-label">{{ section.groups.length === 1 ? 'classification' : 'classifications' }}</span></span>
          <span class="directory-metric"><span class="metric-value">{{ section.count }}</span><span class="metric-label">{{ section.count === 1 ? 'item' : 'items' }}</span></span>
          </span>
          <span class="directory-chevron" :class="{expanded:expandedKinds.has(section.kind)}" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m7 4 6 6-6 6"/></svg></span>
        </button></h2>
      </header>
      <div v-show="expandedKinds.has(section.kind)" :id="`catalog-content-${section.kind.replaceAll(' ', '-')}`" class="catalog-type-content">
      <div class="desktop-table">
        <table>
          <thead><tr><th>Name</th><th>Status</th><th class="actions-heading">Actions</th></tr></thead>
          <tbody>
            <template v-for="group in section.groups" :key="group.key">
              <tr class="classification-group-row">
                <td colspan="3">
                  <div class="classification-bar">
                    <button type="button" class="classification-toggle" :aria-expanded="!isCollapsed(group.key)" @click="toggleClassification(group.key)">
                      <span class="chevron" :class="{ collapsed: isCollapsed(group.key) }">⌄</span>
                      <span class="classification-title">
                        <strong>{{ group.name }}</strong>
                        <span class="classification-meta"><span class="child-count">{{ group.items.length }} {{ group.items.length === 1 ? 'item' : 'items' }}</span></span>
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
              <tr v-for="item in isCollapsed(group.key) ? [] : group.items" :key="`${item.kind}-${item.id}`" class="subclassification-row">
                <td><strong>{{ item.name }}</strong><small v-if="Number(item.IsRefundable)">Refundable deduction</small></td>
                <td><span class="status" :class="`status--${item.Status.toLowerCase()}`">{{ item.Status }}</span></td>
                <td><div class="actions"><button type="button" @click="openType(item)">Edit</button><button type="button" :disabled="item.Status === 'Inactive'" @click="requestDeactivate(typeResource(item), item.id, item.name)">Deactivate</button></div></td>
              </tr>
              <tr v-if="!isCollapsed(group.key) && !group.items.length" class="empty-children-row">
                <td colspan="3"><span>No sub-classifications yet.</span><button type="button" :disabled="group.classification.Status === 'Inactive'" @click="openTypeForClassification(group.classification)">Add the first one</button></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <section class="mobile-list" aria-label="Catalog hierarchy">

        <section v-for="group in section.groups" :key="group.key" class="mobile-group">
            <button type="button" class="mobile-group__head" :aria-expanded="!isCollapsed(group.key)" @click="toggleClassification(group.key)">
              <span class="chevron" :class="{ collapsed: isCollapsed(group.key) }">⌄</span>
              <span class="mobile-group__title"><strong>{{ group.name }}</strong><small>Classification · {{ group.items.length }} {{ group.items.length === 1 ? 'item' : 'items' }}</small></span>
              <span class="mobile-group__badges"><span class="status" :class="`status--${group.classification.Status.toLowerCase()}`">{{ group.classification.Status }}</span></span>
            </button>
            <div class="mobile-group__parent-actions"><button class="add-child" type="button" :disabled="group.classification.Status === 'Inactive'" @click="openTypeForClassification(group.classification)">+ Add sub-classification</button><button type="button" @click="openClassification(group.classification)">Edit classification</button><button type="button" :disabled="group.classification.Status === 'Inactive'" @click="requestDeactivate('classification', group.classification.ClassificationID, group.classification.ClassificationName)">Deactivate</button></div>
            <div v-if="!isCollapsed(group.key)" class="mobile-group__items">
              <div class="mobile-group__items-head"><strong>Sub-classifications</strong><span>{{ group.items.length }}</span></div>
              <div v-if="!group.items.length" class="mobile-empty"><span>No sub-classifications yet.</span><button type="button" :disabled="group.classification.Status === 'Inactive'" @click="openTypeForClassification(group.classification)">Add the first one</button></div>
              <article v-for="item in group.items" :key="`${item.kind}-${item.id}`" class="record-card">
                <header><strong>{{ item.name }}</strong><small v-if="Number(item.IsRefundable)">Refundable deduction</small><span class="status" :class="`status--${item.Status.toLowerCase()}`">{{ item.Status }}</span></header>
                <footer><button type="button" @click="openType(item)">Edit</button><button type="button" :disabled="item.Status === 'Inactive'" @click="requestDeactivate(typeResource(item), item.id, item.name)">Deactivate</button></footer>
              </article>
            </div>
        </section>

      </section>
      </div>
    </section>
    </div>

    <Teleport to="body">
      <div v-if="modalOpen" class="modal-backdrop" @click.self="closeModal">
        <form class="catalog-modal" role="dialog" aria-modal="true" :aria-label="modalTitle" @submit.prevent="save">
          <button type="button" class="close" aria-label="Close" :disabled="busy" @click="closeModal">×</button>
          <header class="modal-heading"><p>DEDUCTIONS, LOANS &amp; CONTRIBUTIONS</p><h2>{{ modalTitle }}</h2><span>{{ modalKind === 'classification' ? (editing ? 'Update this catalog classification.' : 'Choose where these catalog items will be used. Recurring Deduction supports scheduled amounts and optional refundable balances.') : editing ? 'Update this reusable name and its parent classification.' : 'Add a reusable name that can be selected during employee assignment.' }}</span></header>

          <div v-if="modalKind === 'type'" class="form-grid">
            <label class="form-field"><span>Type</span><select v-model="typeForm.Kind" :disabled="Boolean(editing) || parentClassificationLocked" required><option value="Loan">Loan</option><option value="Deduction">Deduction</option><option value="Contribution">Contribution</option><option value="Recurring Deduction">Recurring Deduction</option></select></label>
            <label class="form-field"><span>Sub-classification name</span><input v-model="typeForm.Name" maxlength="100" :placeholder="typeForm.Kind === 'Loan' ? 'e.g. SSS Salary Loan' : 'e.g. Uniform deduction'" required></label>
            <label class="form-field form-field--wide"><span>Parent classification</span><select v-model="typeForm.ClassificationID" :disabled="parentClassificationLocked" required><option value="">Select classification</option><option v-for="item in compatibleClassifications" :key="item.ClassificationID" :value="String(item.ClassificationID)">{{ item.ClassificationName }}{{ item.Status === 'Inactive' ? ' (Inactive)' : '' }}</option></select></label>
            <label v-if="typeForm.Kind==='Recurring Deduction'" class="form-field form-field--wide"><span>Refundable deduction</span><select aria-label="Refundable deduction" v-model="typeForm.IsRefundable"><option :value="false">No - regular deduction</option><option :value="true">Yes - track collections and refunds</option></select><small>Set up recurring amounts in Contributions and Others. Optional. Enable to track employee balances and refunds. This setting is locked once the item is assigned.</small></label>
            <label class="form-field"><span>Status</span><select v-model="typeForm.Status"><option>Active</option><option>Inactive</option></select></label>
          </div>

          <div v-else class="form-grid">
            <label class="form-field"><span>Classification name</span><input v-model="classificationForm.ClassificationName" maxlength="100" placeholder="e.g. PAG-IBIG or SSS" required></label>
            <label class="form-field"><span>Applies to</span><select v-model="classificationForm.AppliesTo"><option>Loan</option><option>Deduction</option><option>Contribution</option><option>Recurring Deduction</option></select></label>
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
.kind--recurring-deduction{background:var(--theme-soft,#e9edff);color:var(--theme-accent,#5145a2)}

.catalog-page{box-sizing:border-box;width:100%;max-width:1500px;margin:auto;padding:32px;color:var(--theme-ink,#172033);font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:22px}.page-head p,.modal-heading p,.confirm-modal p{margin:0;color:var(--theme-accent,#3465d9);font-size:.72rem;font-weight:850;letter-spacing:.08em}.page-head h1{margin:3px 0;font-size:1.72rem}.page-head small{color:var(--theme-muted,#64748b)}.primary{min-height:42px;border:0;border-radius:9px;background:#2563eb!important;color:#fff!important;padding:10px 16px;font:inherit;font-weight:800;white-space:nowrap;cursor:pointer}.primary:disabled{opacity:.6;cursor:wait}.error-banner{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;padding:10px 13px;border:1px solid #fecaca;border-radius:9px;background:#fff7f7;color:#b42318;font-size:.8rem;font-weight:700}.error-banner button{border:0;background:transparent;color:inherit;font-size:1.15rem;cursor:pointer}.tabs{display:flex;width:max-content;max-width:100%;gap:4px;margin-bottom:18px;padding:4px;border:1px solid var(--theme-line,#dce4ef);border-radius:10px;background:var(--theme-soft,#eef3f9)}.tabs button{display:flex;align-items:center;gap:7px;min-height:36px;border:0;border-radius:7px;padding:7px 12px;background:transparent;color:var(--theme-muted,#5d6f88);font:inherit;font-size:.78rem;font-weight:800;cursor:pointer}.tabs button.active{background:var(--theme-surface,#fff);color:var(--theme-accent,#1d4ed8);box-shadow:0 1px 4px rgba(30,64,175,.12)}.tabs button span{display:grid;min-width:20px;height:20px;place-items:center;border-radius:999px;background:var(--theme-soft,#dce7f6);color:var(--theme-muted,#47617f);font-size:.65rem}.tabs button.active span{background:var(--theme-soft,#e8efff);color:var(--theme-accent,#1d4ed8)}.filters{display:grid;grid-template-columns:minmax(280px,1fr) repeat(3,minmax(145px,220px));align-items:end;gap:11px;margin-bottom:9px}.filters--classifications{grid-template-columns:minmax(280px,1fr) repeat(2,minmax(145px,220px))}.filters label,.form-field{display:grid;min-width:0;gap:6px}.filters label>span,.form-field>span{color:var(--theme-muted,#475569);font-size:.76rem;font-weight:800}.filters input,.filters select,.form-field input,.form-field select,.form-field textarea{box-sizing:border-box;width:100%;min-width:0;min-height:42px;border:1px solid var(--theme-line,#cbd6e5);border-radius:9px;padding:8px 11px;background:var(--theme-surface,#fff);color:var(--theme-ink,#172033);font:inherit}.filters input:focus,.filters select:focus,.form-field input:focus,.form-field select:focus,.form-field textarea:focus{border-color:#7798d0;box-shadow:0 0 0 3px rgba(35,73,230,.1);outline:0}.list-summary{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 1px 10px;color:var(--theme-muted,#64748b);font-size:.77rem}.list-summary button{border:0;background:transparent;color:var(--theme-accent,#2458c4);font:inherit;font-weight:800;cursor:pointer}.desktop-table{overflow:hidden;border:1px solid var(--theme-line,#dfe5ef);border-radius:12px;background:var(--theme-surface,#fff)}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{min-width:0;padding:10px 12px;border-bottom:1px solid var(--theme-line,#edf1f6);text-align:left;vertical-align:middle;font-size:.8rem;overflow-wrap:anywhere}th{background:var(--theme-soft,#f8fafc);color:var(--theme-muted,#526174);font-size:.68rem;text-transform:uppercase;letter-spacing:.025em}tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:var(--theme-surface,#fbfdff)}td:first-child{width:20%}td strong{display:block;font-size:.82rem}td small{display:block;margin-top:3px;color:var(--theme-muted,#71809a);font-size:.68rem;line-height:1.3}.actions-heading{width:184px}.actions{display:flex;gap:6px;white-space:nowrap}.actions button,.record-card footer button,.modal-footer>button,.confirm-modal footer button{min-height:34px;border:1px solid var(--theme-line,#cbd6e5);border-radius:8px;padding:6px 9px;background:var(--theme-surface,#fff);color:var(--theme-ink,#29486e);font:inherit;font-size:.73rem;font-weight:800;white-space:nowrap;cursor:pointer}.actions button:disabled,.record-card footer button:disabled{opacity:.42;cursor:not-allowed}.status,.kind{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;font-size:.67rem;font-weight:850;white-space:nowrap}.status{background:#dcfce7;color:#147a3d}.status--inactive{background:var(--theme-soft,#f1f5f9);color:var(--theme-muted,#64748b)}.kind--loan{background:var(--theme-soft,#e8efff);color:var(--theme-accent,#2455b4)}.kind--deduction{background:var(--theme-soft,#f3e8ff);color:var(--theme-accent,#7e22ce)}.table-message td{padding:32px;text-align:center;color:var(--theme-muted,#64748b)}.table-message strong,.table-message span{display:block}.table-message span{margin-top:4px;font-size:.74rem}.mobile-list{display:none}.modal-backdrop{position:fixed;inset:0;z-index:400;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.62)}.catalog-modal,.confirm-modal{box-sizing:border-box;position:relative;display:grid;width:min(100%,700px);max-height:calc(100dvh - 36px);gap:17px;padding:24px;overflow:auto;border:1px solid var(--theme-line,#d9e2ef);border-radius:16px;background:var(--theme-surface,#fff);color:var(--theme-ink,#172033);box-shadow:0 24px 70px rgba(15,23,42,.32);font-family:Inter,system-ui,sans-serif}.close{position:absolute;z-index:3;top:12px;right:12px;display:grid;width:34px;height:34px;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--theme-muted,#53657d);font:inherit;font-size:1.35rem;cursor:pointer}.close:hover{background:var(--theme-soft,#edf3fa)}.modal-heading{padding-right:38px}.modal-heading h2,.confirm-modal h2{margin:3px 0 4px;font-size:1.4rem}.modal-heading>span,.confirm-modal>div>span{color:var(--theme-muted,#64748b);font-size:.78rem;line-height:1.5}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:13px}.form-field--wide{grid-column:1/-1}.form-field textarea{min-height:78px;resize:vertical}.form-field small{color:#b45309;font-size:.7rem;font-weight:700}.form-field em{float:right;color:var(--theme-muted,#8794a8);font-size:.65rem;font-style:normal;font-weight:700}.modal-error{margin:0;padding:9px 11px;border:1px solid #fecaca;border-radius:8px;background:#fff7f7;color:#b42318;font-size:.76rem}.modal-footer{display:flex;justify-content:flex-end;gap:9px;padding-top:2px}.modal-footer>button{min-height:40px;padding:8px 14px}.confirm-modal{grid-template-columns:auto 1fr;width:min(100%,500px);overflow:visible}.confirm-icon{display:grid;width:42px;height:42px;place-items:center;border-radius:50%;background:#fff1f2;color:#be123c;font-size:1.2rem;font-weight:900}.confirm-modal footer{display:flex;grid-column:1/-1;justify-content:flex-end;gap:8px}.confirm-modal .danger{border-color:#be123c;background:#be123c;color:#fff}.record-card{display:grid;gap:11px;padding:14px;border:1px solid var(--theme-line,#dfe5ef);border-radius:12px;background:var(--theme-surface,#fff)}.record-card>header{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.record-card>header>div{display:grid;min-width:0;gap:3px}.record-card>header strong{font-size:.86rem;overflow-wrap:anywhere}.record-card>header div span{color:var(--theme-muted,#64748b);font-size:.7rem}.card-tags{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.card-tags>span:not(.kind){color:var(--theme-muted,#526174);font-size:.72rem}.record-card>p{margin:0;color:var(--theme-muted,#526174);font-size:.75rem;line-height:1.45}.record-card footer{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.record-card footer button{min-height:38px}
.actions-heading{width:320px}
.desktop-table th:first-child,.desktop-table td:first-child{width:auto}.desktop-table th:nth-child(2){width:92px}
.classification-group-row td{padding:0;background:var(--theme-soft,#f2f6fc)}
.classification-group-row:hover{background:transparent}
.classification-bar{display:grid;grid-template-columns:minmax(0,1fr) 92px 320px;align-items:center;padding:9px 0}
.classification-toggle{display:flex;min-width:0;align-items:center;gap:9px;border:0;padding:0 12px;background:transparent;color:var(--theme-ink,#17375f);font:inherit;text-align:left;cursor:pointer}
.classification-toggle .chevron,.mobile-group__head .chevron{display:inline-block;flex:0 0 auto;color:var(--theme-muted,#64748b);font-size:.8rem;transition:transform .18s ease}
.classification-toggle .chevron.collapsed,.mobile-group__head .chevron.collapsed{transform:rotate(-90deg)}
.classification-title{display:grid;min-width:0;gap:3px}
.classification-title strong{font-size:.84rem}
.classification-title small{margin:0;color:var(--theme-muted,#71809a);font-size:.64rem;font-weight:700}
.classification-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.child-count{color:var(--theme-muted,#71809a);font-size:.68rem;font-weight:750;white-space:nowrap}
.classification-status{justify-self:start;margin-left:12px}
.classification-actions{display:flex;align-items:center;gap:6px;padding-left:12px}
.classification-actions button,.empty-children-row button,.mobile-empty button{min-height:32px;border:1px solid var(--theme-line,#cbd6e5);border-radius:8px;padding:5px 9px;background:var(--theme-surface,#fff);color:var(--theme-ink,#29486e);font:inherit;font-size:.7rem;font-weight:800;white-space:nowrap;cursor:pointer}
.classification-actions .add-child,.mobile-group__parent-actions .add-child{border-color:var(--theme-line,#b8cbef);background:var(--theme-soft,#eaf1ff);color:var(--theme-accent,#1d4ed8)}
.classification-actions button:disabled,.empty-children-row button:disabled,.mobile-empty button:disabled{opacity:.42;cursor:not-allowed}
.subclassification-row td:first-child{position:relative;padding-left:39px}
.subclassification-row td:first-child::before{position:absolute;top:0;bottom:0;left:21px;border-left:1px solid var(--theme-line,#d8e1ed);content:''}
.empty-children-row td{padding:16px 16px 16px 39px;color:var(--theme-muted,#71809a);font-size:.74rem}.empty-children-row td span{margin-right:10px}
.mobile-group{display:grid;overflow:hidden;border:1px solid var(--theme-line,#dfe5ef);border-radius:12px;background:var(--theme-surface,#fff)}
.mobile-group__head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;border:0;padding:12px;background:var(--theme-soft,#f2f6fc);color:var(--theme-ink,#17375f);font:inherit;text-align:left;cursor:pointer}
.mobile-group__title{display:grid;min-width:0;gap:2px}.mobile-group__title strong{font-size:.84rem;overflow-wrap:anywhere}.mobile-group__title small{color:var(--theme-muted,#71809a);font-size:.66rem;font-weight:700}
.mobile-group__badges{display:flex;align-items:center;justify-content:flex-end;gap:5px;flex-wrap:wrap}
.mobile-group__items{display:grid;gap:8px;padding:10px;background:var(--theme-surface,#fafcff)}
.mobile-group__items-head{display:flex;align-items:center;justify-content:space-between;color:var(--theme-muted,#526174);font-size:.7rem}.mobile-group__items-head span{display:grid;min-width:21px;height:21px;place-items:center;border-radius:999px;background:var(--theme-soft,#e5edf8);font-size:.64rem;font-weight:850}
.mobile-group__items .record-card{gap:8px;padding:11px;border-radius:9px;box-shadow:none}.mobile-group__items .record-card>header{align-items:center}
.mobile-empty{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px;border:1px dashed var(--theme-line,#cbd6e5);border-radius:9px;color:var(--theme-muted,#71809a);font-size:.72rem}
.mobile-group__parent-actions{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;padding:0 10px 10px;background:var(--theme-soft,#f2f6fc)}
.mobile-group__parent-actions .add-child{grid-column:1/-1}
.mobile-group__parent-actions button{min-height:34px;border:1px solid var(--theme-line,#cbd6e5);border-radius:8px;background:var(--theme-surface,#fff);color:var(--theme-ink,#29486e);font:inherit;font-size:.69rem;font-weight:800;cursor:pointer}
.mobile-group__parent-actions button:disabled{opacity:.42;cursor:not-allowed}
@media(max-width:1050px){.filters{grid-template-columns:repeat(3,minmax(0,1fr))}.filters .search-field{grid-column:1/-1}.filters--classifications{grid-template-columns:2fr 1fr 1fr}.filters--classifications .search-field{grid-column:auto}}
@media(max-width:900px){.catalog-page{padding:22px 18px}.desktop-table{display:none}.mobile-list{display:grid;gap:10px}}
@media(max-width:650px){.catalog-page{padding:16px 12px}.page-head{align-items:stretch;flex-direction:column;margin-bottom:17px}.page-head .primary{width:100%}.tabs{width:100%}.tabs button{justify-content:center;flex:1}.filters,.filters--classifications{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.filters .search-field,.filters--classifications .search-field{grid-column:1/-1;grid-row:1}.filters label:nth-child(2){grid-column:1;grid-row:2}.filters label:nth-child(4){grid-column:2;grid-row:2}.filters label:nth-child(3){grid-column:1/-1;grid-row:3}.list-summary{align-items:flex-start;flex-direction:column;gap:5px}.mobile-group__badges .status{display:none}.modal-backdrop{align-items:end;padding:0}.catalog-modal{width:100%;max-height:calc(100dvh - 10px);gap:14px;padding:20px 14px;border-radius:16px 16px 0 0}.form-grid{grid-template-columns:1fr}.form-field--wide{grid-column:auto}.modal-footer{position:sticky;bottom:-20px;display:grid;grid-template-columns:1fr 1fr;margin:0 -14px -20px;padding:11px 14px;background:var(--theme-surface,#fff);border-top:1px solid var(--theme-line,#e5eaf2)}.modal-footer>button{width:100%}.confirm-modal{align-self:center;width:calc(100% - 24px);grid-template-columns:1fr;padding:20px}.confirm-modal .confirm-icon{margin-bottom:-4px}.confirm-modal footer{grid-column:auto;display:grid;grid-template-columns:1fr 1fr}.confirm-modal footer button{min-height:40px}}
@media(max-width:370px){.tabs{display:grid;width:100%}.filters,.filters--classifications{grid-template-columns:1fr}.filters label:nth-child(n){grid-column:1;grid-row:auto}.mobile-group__head{grid-template-columns:auto minmax(0,1fr)}.mobile-group__badges{grid-column:2;justify-content:flex-start}.mobile-empty{align-items:stretch;flex-direction:column}.confirm-modal footer,.modal-footer{grid-template-columns:1fr}}
.kind--contribution{background:#dcfce7;color:#166534}

.list-summary.setup-directory-heading{margin:26px 0 14px}.catalog-section{margin:0}.catalog-section-heading{margin:0}.catalog-section-heading h2{margin:0;font-size:1rem}.catalog-type-content{padding:16px 20px 20px 68px;border-top:1px solid var(--theme-line,#e6edf5);background:var(--theme-surface,#fafcff)}.catalog-type-content .classification-group-row td{background:var(--theme-surface,#fff)}.catalog-type-content .classification-toggle{padding-top:5px;padding-bottom:5px}.catalog-type-content .classification-title{gap:5px}.catalog-type-content .classification-bar{padding:10px 0}.catalog-type-content .subclassification-row{background:var(--theme-soft,#f8fbff)}.catalog-empty{padding:30px;text-align:center;color:var(--theme-muted,#71809a)}
@media(max-width:900px){.catalog-type-content{padding:12px 16px 16px 24px}}
@media(max-width:650px){.catalog-type-content{padding:10px 12px 12px 20px}.list-summary.setup-directory-heading{flex-direction:row;align-items:center}.list-summary.setup-directory-heading>div{flex-basis:100%}}
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
html[data-theme='dark'] .catalog-type-content{background:#101d34;border-color:var(--line)}html[data-theme='dark'] .catalog-type-content .classification-group-row td{background:#172845}html[data-theme='dark'] .catalog-type-content .subclassification-row{background:#101d34}
</style>
