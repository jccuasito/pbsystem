<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import ModernDateField from '~~/components/ModernDateField.vue'
import '../../../../assets/css/setup-directory.css'

type Cutoff = 'First' | 'Second' | 'Both'
type Version = { AgencyContributionVersionID: number; EffectiveDate: string; AmountPerCutoff: number; DeductOn: Cutoff; Reason: string; CreatedAt: string; CreatedByName: string }
type DateCorrection = { AgencyContributionDateCorrectionID: number; AgencyContributionVersionID: number | null; CorrectionKind: 'Original' | 'Version'; PreviousStartDate: string; PreviousEndDate: string | null; NewStartDate: string; NewEndDate: string | null; PreviousAmountPerCutoff: number | null; NewAmountPerCutoff: number | null; PreviousDeductOn: Cutoff | null; NewDeductOn: Cutoff | null; Reason: string; CreatedAt: string; CreatedByName: string }
type Plan = { AgencyContributionID: number; AgencyID: number; AgencyName: string; AgencyPositionID: number; PositionName: string; DeductionTypeID: number; DeductionName: string; ClassificationName: string; CatalogKind: 'Contribution' | 'Recurring Deduction'; IsRefundable: number; AmountPerCutoff: number; DeductOn: Cutoff; EffectiveStartDate: string; EffectiveEndDate: string | null; Status: 'Active' | 'Inactive'; CreatedAt: string; CreatedByName: string; Versions: Version[]; DateCorrections: DateCorrection[]; PayrollLinkCount: number; OverrideLinkCount: number; CurrentAmountPerCutoff: number; CurrentDeductOn: Cutoff; NextEffectiveDate: string | null }
type Agency = { AgencyID: number; AgencyName: string }
type PositionChoice = { AgencyPositionID: number; AgencyID: number; PositionName: string }
type Catalog = { DeductionTypeID: number; DeductionName: string; ClassificationName: string; CatalogKind: 'Contribution' | 'Recurring Deduction'; IsRefundable: number }
type BulkRow = PositionChoice & { selected: boolean; amounts: Record<number, string> }
type BulkResult = { AgencyPositionID: number; DeductionTypeID: number; AmountPerCutoff: number; DeductOn: Cutoff; action: 'create' | 'duplicate' }
type BulkPreview = { counts: { create: number; duplicate: number }; results: BulkResult[] }

const kindFilter = ref('')
const plans = ref<Plan[]>([])
const agencies = ref<Agency[]>([])
const positions = ref<PositionChoice[]>([])
const catalog = ref<Catalog[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
type ToastKind = 'success' | 'warning'
const toast = ref<{ id: number; message: string; kind: ToastKind } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined
let toastId = 0
function showToast(message: string, kind: ToastKind = 'success') {
  if (toastTimer) clearTimeout(toastTimer)
  toast.value = { id: ++toastId, message, kind }
  toastTimer = setTimeout(() => { toast.value = null }, kind === 'warning' ? 7000 : 5000)
}
onUnmounted(() => { if (toastTimer) clearTimeout(toastTimer) })
function isConflict(cause: any) {
  return [cause?.statusCode, cause?.status, cause?.response?.status, cause?.data?.statusCode].some(code => Number(code) === 409)
}
const modalError = ref('')
const search = ref('')
const agencyFilter = ref('')
const statusFilter = ref('Active')

const createOpen = ref(false)
const createForm = reactive({ AgencyID: '', AgencyPositionID: '', DeductionTypeID: '', AmountPerCutoff: '', DeductOn: 'Second' as Cutoff, EffectiveStartDate: '', EffectiveEndDate: '' })
const editTarget = ref<Plan | null>(null)
const editingVersion = computed(() => !!editTarget.value?.Versions?.length)
const editForm = reactive({ EffectiveStartDate: '', EffectiveEndDate: '', AmountPerCutoff: '', DeductOn: 'Second' as Cutoff, Reason: '' })
const updateTarget = ref<Plan | null>(null)
const updateForm = reactive({ AmountPerCutoff: '', DeductOn: 'Second' as Cutoff, EffectiveDate: '', Reason: '' })
const historyTarget = ref<Plan | null>(null)
const deleteTarget = ref<Plan | null>(null)

const bulkOpen = ref(false)
let bulkPreviousOverflow = ''
watch(bulkOpen, opened => {
  if (opened) { bulkPreviousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden' }
  else document.body.style.overflow = bulkPreviousOverflow
})
onUnmounted(() => { if (bulkOpen.value) document.body.style.overflow = bulkPreviousOverflow })
const bulkReviewOpen = ref(false)
const bulkReviewNeedsRefresh = ref(false)
const bulkReviewedPayload = ref<ReturnType<typeof bulkPayload> | null>(null)
const bulkReviewTitle = ref<HTMLElement | null>(null)
const bulkReviewDialog = ref<HTMLElement | null>(null)
const bulkPreviewTrigger = ref<HTMLButtonElement | null>(null)
const bulkAgencyId = ref('')
const bulkEffectiveDate = ref('')
const bulkTypes = ref<number[]>([])
const bulkCutoffs = reactive<Record<number, Cutoff>>({})
const bulkFillAmounts = reactive<Record<number, string>>({})
const bulkRows = ref<BulkRow[]>([])
const bulkPreview = ref<BulkPreview | null>(null)

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const nextDate = (value: string) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10) }
const money = (value: number | string) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0))
const dateLabel = (value: string | null) => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No end date'
const dateTimeLabel = (value: string) => value ? new Date(value.replace(' ', 'T')).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const cutoffLabel = (value: Cutoff) => value === 'First' ? '1st cutoff' : value === 'Second' ? '2nd cutoff' : 'Both cutoffs'
const contributionLabel = (item: Catalog) => {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (normalize(item.DeductionName) === 'cashbond') return 'Cash Bond'
  const name = item.DeductionName
  const label = normalize(item.ClassificationName) === normalize(name) ? name : `${item.ClassificationName} · ${name}`
  return Number(item.IsRefundable) ? `Refundable ${label}` : label
}
const planLabel = (item: Plan) => contributionLabel(item)

const createPositions = computed(() => positions.value.filter(position => String(position.AgencyID) === createForm.AgencyID))
const visible = computed(() => plans.value.filter(item =>
  (!agencyFilter.value || String(item.AgencyID) === agencyFilter.value) &&
  (!statusFilter.value || item.Status === statusFilter.value) &&
  (!kindFilter.value || (kindFilter.value === 'Refundable' ? Number(item.IsRefundable) : item.CatalogKind === kindFilter.value)) &&
  (!search.value.trim() || `${item.AgencyName} ${item.PositionName || ''} ${planLabel(item)}`.toLowerCase().includes(search.value.trim().toLowerCase()))
))
// Group the filtered plans by IDs so similarly named agencies or positions stay separate.
const agencyGroups = computed(() => {
  const groups = new Map<number, { id: number; name: string; count: number; positions: { id: number; name: string; items: Plan[] }[] }>()
  for (const item of visible.value) {
    let agency = groups.get(item.AgencyID)
    if (!agency) {
      agency = { id: item.AgencyID, name: item.AgencyName, count: 0, positions: [] }
      groups.set(item.AgencyID, agency)
    }
    let position = agency.positions.find(position => position.id === item.AgencyPositionID)
    if (!position) {
      position = { id: item.AgencyPositionID, name: item.PositionName || 'Unassigned position', items: [] }
      agency.positions.push(position)
    }
    position.items.push(item)
    agency.count++
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).map(agency => ({
    ...agency,
    preview: [...new Set(agency.positions.flatMap(position => position.items.map(item => planLabel(item))))].join(' · '),
    positions: agency.positions.sort((a, b) => a.name.localeCompare(b.name)).map(position => ({
      ...position, items: position.items.sort((a, b) => planLabel(a).localeCompare(planLabel(b))),
    })),
  }))
})
const expandedAgencies = ref(new Set<number>())
const expandedPositions = ref(new Set<string>())
const positionKey = (agencyId: number, positionId: number) => `${agencyId}-${positionId}`
function toggleAgency(id: number) {
  const next = new Set(expandedAgencies.value)
  next.has(id) ? next.delete(id) : next.add(id)
  expandedAgencies.value = next
}
function togglePosition(key: string) {
  const next = new Set(expandedPositions.value)
  next.has(key) ? next.delete(key) : next.add(key)
  expandedPositions.value = next
}
// Open matching branches when filtering so the result is immediately visible.
watch([search, agencyFilter, kindFilter, statusFilter], () => {
  const filtered = search.value.trim() || agencyFilter.value || kindFilter.value || statusFilter.value !== 'Active'
  expandedAgencies.value = new Set(filtered ? agencyGroups.value.map(agency => agency.id) : [])
  expandedPositions.value = new Set(filtered ? agencyGroups.value.flatMap(agency => agency.positions.map(position => positionKey(agency.id, position.id))) : [])
})
const selectedCatalog = computed(() => catalog.value.filter(item => bulkTypes.value.includes(Number(item.DeductionTypeID))))
const updateMinDate = computed(() => updateTarget.value ? nextDate(updateTarget.value.Versions?.at(-1)?.EffectiveDate || updateTarget.value.EffectiveStartDate) : '')
const historyEntries = computed(() => {
  if (!historyTarget.value) return []
  const plan = historyTarget.value
  const entries = [{ id: 0, original: true, EffectiveDate: plan.EffectiveStartDate, AmountPerCutoff: plan.AmountPerCutoff,
    DeductOn: plan.DeductOn, Reason: '', CreatedAt: plan.CreatedAt, CreatedByName: plan.CreatedByName },
  ...(plan.Versions || []).map(version => ({ id: version.AgencyContributionVersionID, original: false, ...version }))]
  const applicable = entries.filter(entry => entry.EffectiveDate <= today())
  const currentId = applicable.at(-1)?.id
  return entries.reverse().map(entry => ({ ...entry,
    state: entry.EffectiveDate > today() ? 'Scheduled' : entry.id === currentId ? 'Current' : 'Previous' }))
})
const historyCorrections = computed(() => [...(historyTarget.value?.DateCorrections || [])].reverse())
const bulkSelectedCount = computed(() => bulkRows.value.filter(row => row.selected).length)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{ items: Plan[]; agencies: Agency[]; positions: PositionChoice[]; catalogItems: Catalog[] }>('/api/deductions-loans/agency-contributions')
    plans.value = response.items || []
    agencies.value = response.agencies || []
    positions.value = response.positions || []
    catalog.value = (response.catalogItems || []).filter(item => ['Contribution','Recurring Deduction'].includes(item.CatalogKind))
  } catch (cause: any) {
    error.value = cause?.data?.statusMessage || 'Unable to load contributions.'
  } finally { loading.value = false }
}

function catalogChanged() {
  const item = catalog.value.find(item => String(item.DeductionTypeID) === createForm.DeductionTypeID)
  createForm.DeductOn = item?.CatalogKind === 'Recurring Deduction' ? 'First' : 'Second'
}
function openCreate() {
  Object.assign(createForm, { AgencyID: agencyFilter.value || '', AgencyPositionID: '',
    DeductionTypeID: '', AmountPerCutoff: '', DeductOn: 'Second', EffectiveStartDate: today(), EffectiveEndDate: '' })
  modalError.value = ''
  createOpen.value = true
}
function createAgencyChanged() { createForm.AgencyPositionID = '' }
async function saveCreate() {
  if (saving.value) return
  if (!createPositions.value.some(position => String(position.AgencyPositionID) === createForm.AgencyPositionID)) { modalError.value = 'Select a valid agency position.'; return }
  if (createForm.EffectiveEndDate && createForm.EffectiveEndDate < createForm.EffectiveStartDate) { modalError.value = 'End date must be on or after the start date.'; return }
  saving.value = true; modalError.value = ''
  try {
    await $fetch('/api/deductions-loans/agency-contributions', { method: 'POST', body: {
      AgencyID: Number(createForm.AgencyID), AgencyPositionID: Number(createForm.AgencyPositionID),
      DeductionTypeID: Number(createForm.DeductionTypeID), AmountPerCutoff: Number(createForm.AmountPerCutoff),
      DeductOn: createForm.DeductOn, EffectiveStartDate: createForm.EffectiveStartDate,
      EffectiveEndDate: createForm.EffectiveEndDate || null, Status: 'Active',
    } })
    createOpen.value = false; showToast('Plan added.'); await load()
  } catch (cause: any) {
    modalError.value = isConflict(cause)
      ? 'This agency position already has a plan for these dates. Use Update to change the amount or cutoff.'
      : cause?.data?.statusMessage || 'Unable to save contribution.'
    if (isConflict(cause)) showToast(modalError.value, 'warning')
  }
  finally { saving.value = false }
}

function openEdit(item: Plan) {
  if (Number(item.PayrollLinkCount)) return
  editTarget.value = item
  const latest = item.Versions?.at(-1)
  Object.assign(editForm, { EffectiveStartDate: latest?.EffectiveDate || item.EffectiveStartDate,
    EffectiveEndDate: item.EffectiveEndDate || '', AmountPerCutoff: String(latest?.AmountPerCutoff ?? item.AmountPerCutoff),
    DeductOn: latest?.DeductOn || item.DeductOn, Reason: '' })
  modalError.value = ''
}
async function saveEdit() {
  if (!editTarget.value || saving.value) return
  if (!editForm.EffectiveStartDate) { modalError.value = 'Choose an effective start date.'; return }
  if (!editingVersion.value && editForm.EffectiveEndDate && editForm.EffectiveEndDate < editForm.EffectiveStartDate) {
    modalError.value = 'End date must be on or after the start date.'; return
  }
  saving.value = true; modalError.value = ''
  try {
    const wasVersion = editingVersion.value
    const result = await $fetch<{ action: string }>('/api/deductions-loans/agency-contributions', { method: 'PUT', body: {
      mode: editingVersion.value ? 'version-correction' : 'original',
      AgencyContributionID: editTarget.value.AgencyContributionID,
      EffectiveStartDate: editForm.EffectiveStartDate, EffectiveDate: editForm.EffectiveStartDate,
      EffectiveEndDate: editForm.EffectiveEndDate || null,
      AmountPerCutoff: Number(editForm.AmountPerCutoff), DeductOn: editForm.DeductOn,
      Reason: editForm.Reason,
    } })
    editTarget.value = null
    showToast(result.action === 'unchanged' ? 'No changes were needed.' : `${wasVersion ? 'Latest update' : 'Original contribution'} corrected and recorded in History.`)
    await load()
  } catch (cause: any) {
    modalError.value = cause?.data?.statusMessage || 'Unable to edit the original contribution.'
    if (isConflict(cause)) showToast(modalError.value, 'warning')
  }
  finally { saving.value = false }
}

function openUpdate(item: Plan) {
  updateTarget.value = item
  updateForm.AmountPerCutoff = String(item.Versions?.at(-1)?.AmountPerCutoff ?? item.CurrentAmountPerCutoff)
  updateForm.DeductOn = item.Versions?.at(-1)?.DeductOn ?? item.CurrentDeductOn
  updateForm.EffectiveDate = updateMinDate.value > today() ? updateMinDate.value : today()
  updateForm.Reason = ''
  modalError.value = ''
}
async function saveUpdate() {
  if (!updateTarget.value || saving.value) return
  if (updateForm.EffectiveDate < updateMinDate.value) { modalError.value = `Choose a date on or after ${dateLabel(updateMinDate.value)}.`; return }
  saving.value = true; modalError.value = ''
  try {
    await $fetch('/api/deductions-loans/agency-contributions', { method: 'PUT', body: {
      mode: 'version', AgencyContributionID: updateTarget.value.AgencyContributionID,
      AmountPerCutoff: Number(updateForm.AmountPerCutoff), DeductOn: updateForm.DeductOn,
      EffectiveDate: updateForm.EffectiveDate, Reason: updateForm.Reason,
    } })
    updateTarget.value = null; showToast('Dated contribution update saved.'); await load()
  } catch (cause: any) { modalError.value = cause?.data?.statusMessage || 'Unable to save update.' }
  finally { saving.value = false }
}

async function deactivate(item: Plan) {
  if (!window.confirm(`Deactivate ${planLabel(item)} for ${item.AgencyName} / ${item.PositionName}?`)) return
  error.value = ''
  try {
    await $fetch('/api/deductions-loans/agency-contributions', { method: 'DELETE', body: { AgencyContributionID: item.AgencyContributionID, action: 'deactivate' } })
    showToast('Plan deactivated.'); await load()
  } catch (cause: any) { error.value = cause?.data?.statusMessage || 'Unable to deactivate contribution.' }
}

function openDelete(item: Plan) {
  if (item.Status !== 'Inactive' || Number(item.PayrollLinkCount) || Number(item.OverrideLinkCount)) return
  modalError.value = ''
  deleteTarget.value = item
}
async function deletePlan() {
  if (!deleteTarget.value || saving.value) return
  saving.value = true; modalError.value = ''
  try {
    await $fetch('/api/deductions-loans/agency-contributions', { method: 'DELETE', body: {
      AgencyContributionID: deleteTarget.value.AgencyContributionID, action: 'delete',
    } })
    deleteTarget.value = null
    showToast('Unused plan permanently deleted.')
    await load()
  } catch (cause: any) {
    modalError.value = cause?.data?.statusMessage || 'Unable to delete plan.'
    if (isConflict(cause)) showToast(modalError.value, 'warning')
  } finally { saving.value = false }
}

function resetBulkRows() {
  bulkRows.value = positions.value.filter(position => String(position.AgencyID) === bulkAgencyId.value)
    .map(position => ({ ...position, selected: true, amounts: {} }))
  bulkPreview.value = null
}
function openBulk() {
  bulkReviewOpen.value = false
  bulkReviewNeedsRefresh.value = false
  bulkReviewedPayload.value = null
  bulkAgencyId.value = agencyFilter.value || (agencies.value.length === 1 ? String(agencies.value[0].AgencyID) : '')
  bulkEffectiveDate.value = today()
  bulkTypes.value = []
  for (const item of catalog.value) { bulkCutoffs[item.DeductionTypeID] = item.CatalogKind === 'Recurring Deduction' ? 'First' : 'Second'; bulkFillAmounts[item.DeductionTypeID] = '' }
  resetBulkRows()
  modalError.value = ''
  bulkOpen.value = true
}
function invalidateBulk() { bulkPreview.value = null; bulkReviewedPayload.value = null; modalError.value = '' }
async function backToBulkEdit() {
  if (saving.value) return
  bulkReviewOpen.value = false
  bulkReviewNeedsRefresh.value = false
  invalidateBulk()
  await nextTick()
  bulkPreviewTrigger.value?.focus({ preventScroll: true })
}
function trapBulkReviewFocus(event: KeyboardEvent) {
  const buttons = bulkReviewDialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled)')
  if (!buttons?.length) return
  const first = buttons[0]!, last = buttons[buttons.length - 1]!
  if (event.shiftKey && (document.activeElement === first || document.activeElement === bulkReviewTitle.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
function fillSelected(typeId: number) {
  const value = bulkFillAmounts[typeId]
  if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0) { modalError.value = 'Enter a positive amount to fill selected rows.'; return }
  for (const row of bulkRows.value) if (row.selected) row.amounts[typeId] = value
  invalidateBulk()
}
function selectAllRows(checked: boolean) { for (const row of bulkRows.value) row.selected = checked; invalidateBulk() }
function bulkPayload(dryRun: boolean) {
  const rows: { AgencyPositionID: number; DeductionTypeID: number; AmountPerCutoff: number; DeductOn: Cutoff }[] = []
  for (const row of bulkRows.value.filter(item => item.selected)) {
    for (const typeId of bulkTypes.value) {
      const raw = String(row.amounts[typeId] || '').trim()
      if (!raw) continue
      rows.push({ AgencyPositionID: row.AgencyPositionID, DeductionTypeID: typeId,
        AmountPerCutoff: Number(raw), DeductOn: bulkCutoffs[typeId] || 'Second' })
    }
  }
  return { AgencyID: Number(bulkAgencyId.value), EffectiveDate: bulkEffectiveDate.value,
    DryRun: dryRun, Rows: rows }
}
async function previewBulk() {
  if (saving.value) return
  const payload = bulkPayload(true)
  if (!payload.AgencyID || !payload.EffectiveDate || !payload.Rows.length) { modalError.value = 'Choose an agency, date, and at least one amount.'; return }
  saving.value = true; modalError.value = ''
  try {
    bulkPreview.value = await $fetch<BulkPreview>('/api/deductions-loans/agency-contributions/bulk', { method: 'POST', body: payload })
    bulkReviewedPayload.value = { ...payload, DryRun: false }
    bulkReviewNeedsRefresh.value = false
    bulkReviewOpen.value = true
    await nextTick()
    bulkReviewTitle.value?.focus({ preventScroll: true })
    if (bulkPreview.value.counts.duplicate) {
      showToast(`${bulkPreview.value.counts.duplicate} selected plan${bulkPreview.value.counts.duplicate === 1 ? '' : 's'} already exist. Remove duplicate rows before saving; nothing has changed.`, 'warning')
    }
  } catch (cause: any) {
    bulkPreview.value = null; modalError.value = cause?.data?.statusMessage || 'Unable to preview bulk contributions.'
    if (isConflict(cause)) showToast(modalError.value, 'warning')
  }
  finally { saving.value = false }
}
async function saveBulk() {
  if (!bulkPreview.value || !bulkReviewedPayload.value || !bulkReviewOpen.value || bulkReviewNeedsRefresh.value || bulkPreview.value.counts.duplicate || !bulkPreview.value.counts.create || saving.value) return
  saving.value = true; modalError.value = ''
  try {
    const result = await $fetch<BulkPreview>('/api/deductions-loans/agency-contributions/bulk', { method: 'POST', body: bulkReviewedPayload.value })
    bulkOpen.value = false
    bulkReviewOpen.value = false
    bulkReviewedPayload.value = null
    showToast(`${result.counts.create} plan${result.counts.create === 1 ? '' : 's'} added.`)
    await load()
  } catch (cause: any) {
    bulkReviewNeedsRefresh.value = true; modalError.value = cause?.data?.statusMessage || 'Unable to save the plans. Go back to edit and preview again.'
    if (isConflict(cause)) showToast(modalError.value, 'warning')
  }
  finally { saving.value = false }
}
function bulkPosition(id: number) { return bulkRows.value.find(row => row.AgencyPositionID === id) }
function bulkCatalog(id: number) { return catalog.value.find(item => Number(item.DeductionTypeID) === id) }

onMounted(load)
</script>

<template>
  <section class="contributions-page">
    <header class="page-head">
      <div><span class="eyebrow">DEDUCTIONS &amp; LOANS</span><h1>Contributions and Others</h1><p>Manage contributions and recurring deductions by agency and position.</p></div>
      <div class="head-actions"><button type="button" @click="openCreate">+ Single plan</button><button class="primary" type="button" @click="openBulk">+ Bulk setup</button></div>
    </header>
    <Transition name="snackbar">
      <div v-if="toast" :key="toast.id" class="snackbar" :class="`snackbar--${toast.kind}`" :role="toast.kind === 'warning' ? 'alert' : 'status'" :aria-live="toast.kind === 'warning' ? 'assertive' : 'polite'">
        <svg v-if="toast.kind === 'success'" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></svg>
        <span>{{ toast.message }}</span>
        <button type="button" aria-label="Dismiss notification" @click="toast = null">×</button>
      </div>
    </Transition>
    <div class="filters directory-filters">
      <label>Search<input v-model="search" type="search" placeholder="Search agency, position, or item"></label>
      <label>Agency<select v-model="agencyFilter"><option value="">All agencies</option><option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option></select></label>
      <label>Type<select v-model="kindFilter"><option value="">All items</option><option>Contribution</option><option>Recurring Deduction</option><option value="Refundable">Refundable deductions</option></select></label>
      <label>Status<select v-model="statusFilter"><option value="Active">Active</option><option value="Inactive">Inactive</option><option value="">All statuses</option></select></label>
    </div>
    <div class="setup-directory-heading"><div><h2>Agency plans</h2><p>Select an agency, then a position to manage its items.</p></div><span class="directory-total">{{ visible.length }} {{ visible.length === 1 ? 'plan' : 'plans' }}</span></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="!agencyGroups.length" class="empty">{{ loading ? 'Loading plans...' : 'No plans match the filters.' }}</p>
    <div v-else class="agency-groups setup-directory">
      <div class="directory-columns" aria-hidden="true"><span>Agency</span><span>Positions</span><span>Plans</span><span></span></div>
      <section v-for="agency in agencyGroups" :key="agency.id" class="agency-group" :class="{'is-open':expandedAgencies.has(agency.id)}" :aria-labelledby="`plan-agency-${agency.id}`">
        <header class="agency-heading">
          <h2 :id="`plan-agency-${agency.id}`"><button type="button" class="agency-toggle directory-row" :aria-expanded="expandedAgencies.has(agency.id)" :aria-controls="`agency-plans-${agency.id}`" @click="toggleAgency(agency.id)">
            <span class="directory-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 21V5h10v16M14 10h6v11M2 21h20M8 9h2M8 13h2M8 17h2M17 14h1M17 18h1"/></svg></span>
            <span class="directory-identity"><span class="agency-name directory-title">{{ agency.name }}</span><span class="directory-subtitle" :title="agency.preview">{{ agency.preview }}</span></span>
            <span class="directory-stats">
            <span class="directory-metric"><span class="metric-value">{{ agency.positions.length }}</span><span class="metric-label">{{ agency.positions.length === 1 ? 'position' : 'positions' }}</span></span>
            <span class="directory-metric"><span class="metric-value">{{ agency.count }}</span><span class="metric-label">{{ agency.count === 1 ? 'plan' : 'plans' }}</span></span>
            </span>
            <span class="directory-chevron" :class="{expanded:expandedAgencies.has(agency.id)}" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m7 4 6 6-6 6"/></svg></span>
          </button></h2>
        </header>
        <div v-show="expandedAgencies.has(agency.id)" :id="`agency-plans-${agency.id}`" class="agency-content">
        <section v-for="position in agency.positions" :key="position.id" class="position-group" :aria-labelledby="`plan-position-${agency.id}-${position.id}`">
          <header class="position-heading"><h3 :id="`plan-position-${agency.id}-${position.id}`"><button type="button" class="position-toggle" :aria-expanded="expandedPositions.has(positionKey(agency.id,position.id))" :aria-controls="`position-plans-${agency.id}-${position.id}`" @click="togglePosition(positionKey(agency.id,position.id))">
            <span class="tree-chevron" :class="{expanded:expandedPositions.has(positionKey(agency.id,position.id))}" aria-hidden="true"></span>
            <span class="position-name">{{ position.name }}</span><span class="group-count">{{ position.items.length }} {{ position.items.length === 1 ? 'item' : 'items' }}</span>
          </button></h3></header>
          <div v-show="expandedPositions.has(positionKey(agency.id,position.id))" :id="`position-plans-${agency.id}-${position.id}`" class="table-wrap plan-table"><table :aria-label="`${agency.name} / ${position.name} plans`"><thead><tr><th>Item</th><th class="numeric">Amount / cutoff</th><th>Deduct every</th><th>Effective</th><th>Status</th><th>Actions</th></tr></thead><tbody>
            <tr v-for="item in position.items" :key="item.AgencyContributionID">
              <td class="plan-item"><strong>{{ planLabel(item) }}</strong><small>{{ item.CatalogKind }}</small></td>
              <td class="numeric" data-label="Amount / cutoff"><strong>{{ money(item.CurrentAmountPerCutoff) }}</strong></td>
              <td data-label="Deduct every">{{ cutoffLabel(item.CurrentDeductOn) }}</td>
              <td data-label="Effective">{{ dateLabel(item.Versions?.filter(version => version.EffectiveDate <= today()).at(-1)?.EffectiveDate || item.EffectiveStartDate) }}<small v-if="item.NextEffectiveDate">Next: {{ dateLabel(item.NextEffectiveDate) }}</small></td>
              <td data-label="Status"><span class="status" :class="item.Status.toLowerCase()">{{ item.Status }}</span></td>
              <td class="plan-actions" data-label="Actions"><div class="actions" role="group" :aria-label="`Actions for ${planLabel(item)} / ${item.AgencyName} / ${item.PositionName}`">
                <button class="rate-icon-action" type="button" :disabled="item.Status !== 'Active' || !!Number(item.PayrollLinkCount)" :title="Number(item.PayrollLinkCount) ? 'Plan is locked after payroll posting' : 'Edit the latest amount, cutoff, and date'" :aria-label="`Edit plan for ${planLabel(item)} / ${item.PositionName}`" @click="openEdit(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4L16.5 3.5Z" /></svg></button>
                <button class="rate-icon-action" type="button" title="Update plan with effective date" :aria-label="`Update ${planLabel(item)} / ${item.PositionName} with effective date`" :disabled="item.Status !== 'Active'" @click="openUpdate(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M12 14v4M10 16h4" /></svg></button>
                <button class="rate-icon-action" type="button" :title="`View plan history (${(item.Versions || []).length + (item.DateCorrections || []).length + 1} entries)`" :aria-label="`View ${planLabel(item)} history / ${item.PositionName}`" @click="historyTarget = item"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></button>
                <button v-if="item.Status === 'Active'" class="rate-icon-action rate-icon-action--danger" type="button" title="Deactivate plan" :aria-label="`Deactivate ${planLabel(item)} / ${item.PositionName}`" @click="deactivate(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6 18.4 18.4" /></svg></button>
                <button v-else class="rate-icon-action rate-icon-action--danger" type="button" :title="Number(item.PayrollLinkCount) || Number(item.OverrideLinkCount) ? 'Cannot delete: payroll or deduction review history exists' : 'Permanently delete unused plan'" :aria-label="`Delete ${planLabel(item)} / ${item.PositionName}`" :disabled="!!Number(item.PayrollLinkCount) || !!Number(item.OverrideLinkCount)" @click="openDelete(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg></button>
              </div></td>
            </tr>
          </tbody></table></div>
        </section>
        </div>
      </section>
    </div>
    <p class="setup-directory-note"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v5m0-8v.5"/></svg>Employee collections and refunds are available in Employee Accounts.</p>

    <div v-if="createOpen" class="modal-backdrop" @click.self="!saving && (createOpen = false)">
      <form class="modal small-modal" role="dialog" aria-modal="true" aria-label="Add plan" @submit.prevent="saveCreate">
        <button class="close" type="button" aria-label="Close" :disabled="saving" @click="createOpen = false">×</button>
        <header><span class="eyebrow">AGENCY POSITION PLAN</span><h2>Add plan</h2><p>Create one amount for this position across the agency's sites.</p></header>
        <div class="form-grid">
          <label>Agency<select aria-label="Agency" v-model="createForm.AgencyID" required @change="createAgencyChanged"><option disabled value="">Select agency</option><option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option></select></label>
          <label>Position<select aria-label="Position" v-model="createForm.AgencyPositionID" required :disabled="!createForm.AgencyID"><option disabled value="">Select position</option><option v-for="position in createPositions" :key="position.AgencyPositionID" :value="String(position.AgencyPositionID)">{{ position.PositionName }}</option></select></label>
          <label>Catalog item<select aria-label="Catalog item" v-model="createForm.DeductionTypeID" required @change="catalogChanged"><option disabled value="">Select catalog item</option><option v-for="item in catalog" :key="item.DeductionTypeID" :value="String(item.DeductionTypeID)">{{ contributionLabel(item) }}</option></select></label>
          <label>Amount per employee / cutoff<input v-model="createForm.AmountPerCutoff" type="number" min="0.01" max="99999999.99" step="0.01" required></label>
          <label>Deduct every<select aria-label="Deduct every" v-model="createForm.DeductOn"><option value="First">1st cutoff</option><option value="Second">2nd cutoff</option><option value="Both">Both cutoffs</option></select></label>
          <ModernDateField v-model="createForm.EffectiveStartDate" label="Effective start" required />
          <ModernDateField v-model="createForm.EffectiveEndDate" label="Effective end (optional)" />
        </div>
        <p v-if="modalError" class="error" role="alert">{{ modalError }}</p>
        <footer><button type="button" :disabled="saving" @click="createOpen = false">Cancel</button><button class="primary" :disabled="saving">{{ saving ? 'Saving...' : 'Save plan' }}</button></footer>
      </form>
    </div>

    <div v-if="editTarget" class="modal-backdrop" @click.self="!saving && (editTarget = null)">
      <form class="modal small-modal" role="dialog" aria-modal="true" aria-label="Edit original contribution" @submit.prevent="saveEdit">
        <button class="close" type="button" aria-label="Close" :disabled="saving" @click="editTarget = null">×</button>
        <header><span class="eyebrow">{{ editingVersion ? 'LATEST UPDATE CORRECTION' : 'ORIGINAL PLAN CORRECTION' }}</span><h2>Edit plan</h2><p>{{ editTarget.AgencyName }} · {{ editTarget.PositionName }}</p></header>
        <div class="current-summary"><span>{{ planLabel(editTarget) }}</span><strong>{{ money(editingVersion ? editTarget.Versions.at(-1)?.AmountPerCutoff || 0 : editTarget.AmountPerCutoff) }} · {{ cutoffLabel(editingVersion ? editTarget.Versions.at(-1)?.DeductOn || editTarget.DeductOn : editTarget.DeductOn) }}</strong></div>
        <div class="form-grid">
          <label>Amount per employee / cutoff<input v-model="editForm.AmountPerCutoff" type="number" min="0.01" max="99999999.99" step="0.01" required></label>
          <label>Deduct every<select v-model="editForm.DeductOn"><option value="First">1st cutoff</option><option value="Second">2nd cutoff</option><option value="Both">Both cutoffs</option></select></label>
          <ModernDateField v-model="editForm.EffectiveStartDate" :label="editingVersion ? 'Update effective date' : 'Effective start'" required />
          <ModernDateField v-if="!editingVersion" v-model="editForm.EffectiveEndDate" label="Effective end (optional)" />
          <label class="wide">Reason for correction <span class="optional">optional</span><textarea v-model="editForm.Reason" maxlength="500" rows="3" placeholder="e.g. incorrect amount or effective date entered during setup"></textarea></label>
        </div>
        <p class="hint">{{ editingVersion ? 'Correct the latest dated update before payroll posting. Earlier versions stay unchanged.' : 'Correct the original plan before a dated update or payroll posting.' }} The old and new values remain in History.</p>
        <p v-if="modalError" class="error" role="alert">{{ modalError }}</p>
        <footer><button type="button" :disabled="saving" @click="editTarget = null">Cancel</button><button class="primary" :disabled="saving">{{ saving ? 'Saving...' : 'Save correction' }}</button></footer>
      </form>
    </div>

    <div v-if="updateTarget" class="modal-backdrop" @click.self="!saving && (updateTarget = null)">
      <form class="modal small-modal" role="dialog" aria-modal="true" aria-label="Update plan" @submit.prevent="saveUpdate">
        <button class="close" type="button" aria-label="Close" :disabled="saving" @click="updateTarget = null">×</button>
        <header><span class="eyebrow">DATED UPDATE</span><h2>Update plan</h2><p>{{ updateTarget.AgencyName }} · {{ updateTarget.PositionName }}</p></header>
        <div class="current-summary"><span>{{ planLabel(updateTarget) }}</span><strong>{{ money(updateTarget.CurrentAmountPerCutoff) }} · {{ cutoffLabel(updateTarget.CurrentDeductOn) }}</strong></div>
        <div class="form-grid">
          <ModernDateField v-model="updateForm.EffectiveDate" label="New effective date" :min="updateMinDate" required />
          <label>New amount per employee / cutoff<input v-model="updateForm.AmountPerCutoff" type="number" min="0.01" max="99999999.99" step="0.01" required></label>
          <label>Deduct every<select v-model="updateForm.DeductOn"><option value="First">1st cutoff</option><option value="Second">2nd cutoff</option><option value="Both">Both cutoffs</option></select></label>
          <label class="wide">Reason / government reference <span class="optional">optional</span><textarea v-model="updateForm.Reason" maxlength="500" rows="3" placeholder="e.g. circular or contribution schedule reference"></textarea></label>
        </div>
        <p class="hint">This saves a new version. Earlier amounts remain in History; finalized payroll is not recalculated.</p>
        <p v-if="modalError" class="error" role="alert">{{ modalError }}</p>
        <footer><button type="button" :disabled="saving" @click="updateTarget = null">Cancel</button><button class="primary" :disabled="saving">{{ saving ? 'Saving...' : 'Save dated update' }}</button></footer>
      </form>
    </div>

    <div v-if="deleteTarget" class="modal-backdrop" @click.self="!saving && (deleteTarget = null)">
      <section class="modal small-modal" role="dialog" aria-modal="true" aria-label="Delete plan">
        <button class="close" type="button" aria-label="Close" :disabled="saving" @click="deleteTarget = null">&times;</button>
        <header><span class="eyebrow">PERMANENT DELETE</span><h2>Delete unused plan?</h2><p>{{ deleteTarget.AgencyName }} · {{ deleteTarget.PositionName }}</p></header>
        <div class="current-summary"><span>{{ planLabel(deleteTarget) }}</span><strong>{{ money(deleteTarget.CurrentAmountPerCutoff) }} · {{ cutoffLabel(deleteTarget.CurrentDeductOn) }}</strong></div>
        <p class="hint">This permanently removes the inactive plan and its update and correction history. Plans linked to payroll or deduction review cannot be deleted.</p>
        <p v-if="modalError" class="error" role="alert">{{ modalError }}</p>
        <footer><button type="button" :disabled="saving" @click="deleteTarget = null">Cancel</button><button class="danger" type="button" :disabled="saving" @click="deletePlan">{{ saving ? 'Deleting...' : 'Delete plan' }}</button></footer>
      </section>
    </div>

    <div v-if="historyTarget" class="modal-backdrop" @click.self="historyTarget = null">
      <section class="modal history-modal" role="dialog" aria-modal="true" aria-label="Plan history">
        <button class="close" type="button" aria-label="Close" @click="historyTarget = null">×</button>
        <header><span class="eyebrow">CONTRIBUTION HISTORY</span><h2>{{ planLabel(historyTarget) }}</h2><p>{{ historyTarget.AgencyName }} · {{ historyTarget.PositionName }}</p></header>
        <div class="history-scroll"><article v-for="entry in historyEntries" :key="entry.id" class="history-entry">
          <div class="history-head"><div><span class="eyebrow">{{ entry.original ? 'ORIGINAL PLAN' : 'DATED UPDATE' }}</span><h3>Effective {{ dateLabel(entry.EffectiveDate) }}</h3></div><span class="history-state" :class="entry.state.toLowerCase()">{{ entry.state }}</span></div>
          <div class="history-amount"><strong>{{ money(entry.AmountPerCutoff) }}</strong><span>{{ cutoffLabel(entry.DeductOn) }} · per employee</span></div>
          <p v-if="entry.Reason" class="history-reason">{{ entry.Reason }}</p>
          <small>Saved by {{ entry.CreatedByName || 'Unknown user' }} · {{ dateTimeLabel(entry.CreatedAt) }}</small>
        </article>
        <article v-for="correction in historyCorrections" :key="`correction-${correction.AgencyContributionDateCorrectionID}`" class="history-entry">
          <span class="eyebrow">{{ correction.CorrectionKind === 'Version' ? 'DATED UPDATE CORRECTION' : 'ORIGINAL PLAN CORRECTION' }}</span>
          <h3>{{ dateLabel(correction.PreviousStartDate) }} → {{ dateLabel(correction.NewStartDate) }}</h3>
          <p v-if="correction.CorrectionKind !== 'Version'" class="hint">End date: {{ dateLabel(correction.PreviousEndDate) }} → {{ dateLabel(correction.NewEndDate) }}</p>
          <p v-if="correction.PreviousAmountPerCutoff !== null" class="hint">Amount: {{ money(correction.PreviousAmountPerCutoff) }} → {{ money(correction.NewAmountPerCutoff || 0) }}</p>
          <p v-if="correction.PreviousDeductOn && correction.NewDeductOn" class="hint">Cutoff: {{ cutoffLabel(correction.PreviousDeductOn) }} → {{ cutoffLabel(correction.NewDeductOn) }}</p>
          <p v-if="correction.Reason" class="history-reason">{{ correction.Reason }}</p>
          <small>Corrected by {{ correction.CreatedByName || 'Unknown user' }} · {{ dateTimeLabel(correction.CreatedAt) }}</small>
        </article></div>
        <footer><button type="button" @click="historyTarget = null">Close</button></footer>
      </section>
    </div>

    <div v-if="bulkOpen" class="modal-backdrop" @click.self="!saving && (bulkOpen = false)">
      <section v-show="!bulkReviewOpen" class="modal bulk-modal" role="dialog" aria-modal="true" aria-label="Bulk contribution setup">
        <button class="close" type="button" aria-label="Close" :disabled="saving" @click="bulkOpen = false">×</button>
        <header><span class="eyebrow">BULK SETUP</span><h2>Plans by agency position</h2><p>Fill common amounts once, then adjust each position before saving.</p></header>
        <div class="bulk-scroll">
          <div class="bulk-settings">
            <label>Agency<select v-model="bulkAgencyId" @change="resetBulkRows"><option disabled value="">Select agency</option><option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option></select></label>
            <ModernDateField v-model="bulkEffectiveDate" label="Effective date" required @update:model-value="invalidateBulk" />
          </div>
          <p class="hint">Bulk setup adds new plans only. Existing agency-position contributions are duplicates and block the whole batch. Use each plan's Update action for a future amount or cutoff change.</p>
          <div v-if="bulkAgencyId" class="bulk-stage">
            <h3>1. Choose items and common amounts</h3>
            <div class="type-picks"><label v-for="item in catalog" :key="item.DeductionTypeID"><input v-model="bulkTypes" type="checkbox" :value="Number(item.DeductionTypeID)" @change="invalidateBulk"><span>{{ contributionLabel(item) }}</span></label></div>
            <div v-if="selectedCatalog.length" class="fill-grid"><div v-for="item in selectedCatalog" :key="item.DeductionTypeID" class="fill-card">
              <strong>{{ contributionLabel(item) }}</strong>
              <label>Deduct every<select v-model="bulkCutoffs[item.DeductionTypeID]" @change="invalidateBulk"><option value="First">1st cutoff</option><option value="Second">2nd cutoff</option><option value="Both">Both cutoffs</option></select></label>
              <div class="fill-action"><label>Common amount<input v-model="bulkFillAmounts[item.DeductionTypeID]" type="number" min="0.01" step="0.01" placeholder="0.00"></label><button type="button" @click="fillSelected(item.DeductionTypeID)">Fill selected</button></div>
            </div></div>
            <h3>2. Review each position</h3>
            <p class="list-count">{{ bulkSelectedCount }} of {{ bulkRows.length }} positions selected · Blank amount cells are skipped.</p>
            <div class="bulk-table-wrap"><table class="bulk-table"><thead><tr><th><label class="select-all"><input type="checkbox" :checked="bulkRows.length > 0 && bulkSelectedCount === bulkRows.length" @change="selectAllRows(($event.target as HTMLInputElement).checked)">Position</label></th><th v-for="item in selectedCatalog" :key="item.DeductionTypeID" class="numeric">{{ contributionLabel(item) }}</th></tr></thead><tbody>
              <tr v-for="row in bulkRows" :key="row.AgencyPositionID"><td><label class="site-pick"><input v-model="row.selected" type="checkbox" @change="invalidateBulk"><span><strong>{{ row.PositionName }}</strong></span></label></td><td v-for="item in selectedCatalog" :key="item.DeductionTypeID"><input v-model="row.amounts[item.DeductionTypeID]" class="amount-input" type="number" min="0.01" step="0.01" placeholder="—" :disabled="!row.selected" :aria-label="`${contributionLabel(item)} for ${row.PositionName}`" @input="invalidateBulk"></td></tr>
              <tr v-if="!bulkRows.length"><td :colspan="selectedCatalog.length + 1" class="empty">No active positions for this agency.</td></tr>
            </tbody></table></div>
          </div>

        </div>
        <p v-if="modalError" class="error" role="alert">{{ modalError }}</p>
        <footer><button type="button" :disabled="saving" @click="bulkOpen = false">Cancel</button><button ref="bulkPreviewTrigger" type="button" class="primary" :disabled="saving || !bulkAgencyId" @click="previewBulk">{{ saving ? 'Checking...' : 'Preview plans' }}</button></footer>
      </section>
      <section v-if="bulkReviewOpen && bulkPreview && bulkReviewedPayload" ref="bulkReviewDialog" class="modal bulk-modal bulk-review-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-review-title" @keydown.esc.prevent.stop="backToBulkEdit" @keydown.tab="trapBulkReviewFocus">
        <button class="close" type="button" aria-label="Close review" :disabled="saving" @click="backToBulkEdit">&times;</button>
        <header><span class="eyebrow">REVIEW PLANS</span><h2 id="bulk-review-title" ref="bulkReviewTitle" tabindex="-1">Review plans before saving</h2><p>Check the amounts and cutoffs, then choose Save new plans to create this batch.</p></header>
        <div class="bulk-scroll review-scroll">
          <dl class="review-context"><div><dt>Agency</dt><dd>{{ agencies.find(agency => Number(agency.AgencyID) === bulkReviewedPayload!.AgencyID)?.AgencyName }}</dd></div><div><dt>Effective date</dt><dd>{{ dateLabel(bulkReviewedPayload.EffectiveDate) }}</dd></div></dl>
          <div class="preview-counts"><span>{{ bulkPreview.counts.create }} new plans</span><span :class="{ 'duplicate-count': bulkPreview.counts.duplicate }">{{ bulkPreview.counts.duplicate }} duplicates</span></div>
          <p v-if="bulkPreview.counts.duplicate" class="error" role="alert">Some plans already exist. Go back to edit and remove the duplicates before saving. No plans have been changed.</p>
          <div class="review-table-wrap"><table><thead><tr><th>Position / item</th><th class="numeric">Amount / cutoff</th><th>Deduct every</th><th>Action</th></tr></thead><tbody><tr v-for="(result,index) in bulkPreview.results" :key="index"><td><strong>{{ bulkPosition(result.AgencyPositionID)?.PositionName }}</strong><small>{{ bulkCatalog(result.DeductionTypeID) ? contributionLabel(bulkCatalog(result.DeductionTypeID)!) : result.DeductionTypeID }}</small></td><td class="numeric" data-label="Amount / cutoff"><strong>{{ money(result.AmountPerCutoff) }}</strong></td><td data-label="Deduct every">{{ cutoffLabel(result.DeductOn) }}</td><td data-label="Action"><span class="review-action" :class="{ 'duplicate-result': result.action === 'duplicate' }">{{ result.action === 'duplicate' ? 'Already exists' : 'Create' }}</span></td></tr></tbody></table></div>
          <p class="hint">Saving creates the plans for the selected positions. Payroll deductions follow each plan's cutoff and effective date.</p>
        </div>
        <p v-if="modalError" class="error" role="alert">{{ modalError }}</p>
        <footer><button type="button" :disabled="saving" @click="backToBulkEdit">Back to edit</button><button type="button" class="primary" :disabled="saving || bulkReviewNeedsRefresh || !bulkPreview.counts.create || !!bulkPreview.counts.duplicate" @click="saveBulk">{{ saving ? 'Saving...' : 'Save new plans' }}</button></footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.modal.bulk-review-modal{width:min(1000px,calc(100vw - 40px))}.bulk-review-modal .review-scroll{padding-top:20px}.review-context{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:18px;margin:0 0 20px;padding:16px;background:#f4f7fc;border:1px solid #dce5f4;border-radius:10px}.review-context dt{font-size:.72rem;color:#647c9f;margin-bottom:6px}.review-context dd{margin:0;font-size:.87rem;font-weight:700;overflow-wrap:anywhere}.review-table-wrap{border:1px solid #dae5f5;border-radius:10px;overflow:auto;margin-top:18px}.review-table-wrap table{min-width:560px}.review-action{font-size:.77rem;color:#315d98;font-weight:700}.bulk-review-modal h2:focus{outline:none}.bulk-review-modal .error{flex:none}.bulk-review-modal header,.bulk-review-modal footer{flex:none}.bulk-review-modal .close{z-index:1}@media(max-width:700px){.review-context{grid-template-columns:1fr}.bulk-review-modal footer button{flex:1;padding:11px 9px}}


.contributions-page{max-width:1650px;margin:auto;padding:32px;color:#102b55;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:20px}.eyebrow{color:#2860dd;font-size:.73rem;font-weight:800;letter-spacing:.08em}.page-head h1{font-size:2rem;margin:6px 0}.page-head p,.modal header p{margin:0;color:#647c9f}.head-actions,.actions{display:flex;gap:8px;flex-wrap:wrap}.head-actions button,.actions button,.modal footer button,.fill-action button{border:1px solid #cbd8ee;border-radius:9px;background:#fff;padding:11px 15px;color:#1d4d91;font:inherit;font-weight:750;cursor:pointer}.primary,.head-actions .primary,.modal footer .primary{border-color:#2563eb;background:#2563eb;color:#fff}.primary:disabled,.modal button:disabled{opacity:.55;cursor:default}.info{border-left:3px solid #77a5fa;background:#edf3ff;border-radius:7px;padding:14px 18px;color:#315684;line-height:1.5;margin-bottom:22px}.notice{background:#e5f9ee;color:#087146;border-radius:8px;padding:12px 16px}.filters{display:grid;grid-template-columns:minmax(260px,2fr) repeat(3,minmax(150px,1fr));gap:14px;align-items:end}.filters label,.form-grid label,.bulk-settings label,.fill-card label{display:grid;gap:7px;color:#425b80;font-size:.78rem;font-weight:750}.filters input,.filters select,.form-grid input,.form-grid select,.form-grid textarea,.bulk-settings input,.bulk-settings select,.fill-card input,.fill-card select{box-sizing:border-box;width:100%;min-height:48px;border:1px solid #cbd8ef;border-radius:9px;padding:10px 13px;background:#fff;color:#102b55;font:inherit;font-size:.9rem}.form-grid textarea{resize:vertical}.list-count{color:#6480a5;font-size:.82rem;margin:16px 0 10px}.table-wrap,.bulk-table-wrap{overflow-x:auto;border:1px solid #dae5f5;border-radius:12px;background:#fff}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:14px;border-bottom:1px solid #e9eef7;white-space:nowrap;font-size:.85rem}th{background:#f4f7fc;color:#526d92;text-transform:uppercase;font-size:.68rem}td strong,td small{display:block}td small{color:#7188a8;margin-top:4px}.numeric{text-align:right;font-variant-numeric:tabular-nums}.status,.history-state{display:inline-block;border-radius:999px;padding:5px 10px;font-size:.72rem;font-weight:800}.status.active,.history-state.current{background:#d9fbe7;color:#087940}.status.inactive,.history-state.previous{background:#edf0f5;color:#586b84}.history-state.scheduled{background:#eaf2ff;color:#2458c4}.actions button{padding:8px 11px}.count{color:#7890b1}.empty{text-align:center;color:#7188a8;padding:34px}.error{color:#b42318;background:#fff4f2;padding:11px 14px;border-radius:8px}.modal-backdrop{position:fixed;inset:0;z-index:500;display:grid;place-items:center;padding:20px;background:rgba(12,28,61,.55)}.modal{position:relative;box-sizing:border-box;width:min(800px,100%);max-height:calc(100dvh - 40px);overflow:auto;border:1px solid #dce5f4;border-radius:17px;padding:30px;background:#fff;box-shadow:0 25px 80px rgba(11,28,60,.28)}.modal h2{margin:6px 0;font-size:1.65rem}.close{position:absolute;top:16px;right:17px;border:0;background:transparent;color:#527098;font-size:1.5rem;cursor:pointer}.form-grid,.bulk-settings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:17px;margin-top:25px}.wide{grid-column:1/-1}.optional{font-weight:500;color:#7a8eaa}.modal footer{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}.current-summary{display:flex;justify-content:space-between;gap:10px;padding:15px;margin-top:22px;border-radius:10px;background:#f3f7fd;color:#3b5a83}.hint{color:#6480a5;font-size:.83rem;line-height:1.5}.history-modal{width:min(760px,100%)}.history-scroll{max-height:min(65vh,650px);overflow:auto;display:grid;gap:12px;margin-top:24px}.history-entry{border:1px solid #dce5f4;border-radius:12px;padding:17px;background:#fff}.history-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.history-head h3{margin:6px 0;font-size:1.05rem}.history-amount{display:flex;align-items:baseline;gap:12px;margin:12px 0}.history-amount strong{font-size:1.25rem}.history-amount span,.history-entry small{color:#6a82a4}.history-reason{border-left:3px solid #9dbbf0;padding-left:10px;color:#425b80}.bulk-modal{width:min(1400px,calc(100vw - 40px));padding:0;display:flex;flex-direction:column;overflow:hidden}.bulk-modal>header{padding:26px 30px 20px;border-bottom:1px solid #e3eaf5}.bulk-scroll{padding:0 30px 24px;overflow:auto;min-height:0}.bulk-modal>footer{padding:16px 30px;margin:0;border-top:1px solid #e3eaf5;background:#fff}.bulk-modal>.error{margin:0 30px 14px}.bulk-settings{grid-template-columns:1fr 1fr 1.6fr}.bulk-settings .wide{grid-column:auto}.bulk-stage h3,.preview-panel h3{margin:26px 0 12px;font-size:1rem}.type-picks{display:flex;flex-wrap:wrap;gap:9px}.type-picks label{display:flex;gap:8px;align-items:center;border:1px solid #cfdbef;border-radius:999px;padding:9px 12px;font-size:.82rem;font-weight:700;cursor:pointer}.type-picks input,.site-pick input,.select-all input{accent-color:#2563eb}.fill-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin-top:16px}.fill-card{display:grid;gap:13px;border:1px solid #dce5f4;border-radius:12px;padding:16px;background:#f8fbff}.fill-card strong{font-size:.88rem}.fill-action{display:flex;align-items:end;gap:8px}.fill-action label{flex:1}.fill-action button{white-space:nowrap;min-height:48px}.bulk-table-wrap{max-height:390px;overflow:auto}.bulk-table th{position:sticky;top:0;z-index:1}.bulk-table td{min-width:160px}.bulk-table td:first-child{min-width:260px}.site-pick,.select-all{display:flex;align-items:center;gap:9px;cursor:pointer}.site-pick strong,.site-pick small{display:block}.amount-input{box-sizing:border-box;width:100%;min-width:125px;border:1px solid #cbd8ef;border-radius:7px;padding:10px;font:inherit;text-align:right}.amount-input:disabled{background:#f3f5f8}.preview-panel{border-top:1px solid #dce5f4;margin-top:24px}.preview-counts{display:flex;gap:9px;flex-wrap:wrap}.preview-counts span{border-radius:8px;background:#edf3ff;padding:9px 12px;color:#2458a5;font-weight:750;font-size:.83rem}.preview-list{max-height:190px;overflow:auto;margin-top:12px;border:1px solid #dce5f4;border-radius:9px}.preview-list>div{display:grid;grid-template-columns:1fr auto auto;gap:12px;padding:10px 12px;border-bottom:1px solid #e8eef7;font-size:.82rem}.preview-list em{text-transform:capitalize;color:#5073a3;font-style:normal}@media(max-width:1000px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}.bulk-settings{grid-template-columns:1fr 1fr}.bulk-settings .wide{grid-column:1/-1}}@media(max-width:700px){.contributions-page{padding:18px}.page-head{flex-direction:column}.filters,.form-grid,.bulk-settings{grid-template-columns:1fr}.bulk-settings .wide{grid-column:auto}.head-actions{width:100%}.head-actions button{flex:1}.modal{padding:24px 18px}.bulk-modal{padding:0}.bulk-modal>header,.bulk-scroll,.bulk-modal>footer{padding-left:18px;padding-right:18px}.current-summary,.preview-list>div{display:block}.fill-action{flex-wrap:wrap}}
td .actions{display:flex;align-items:center;flex-wrap:nowrap;gap:7px}
td .actions .rate-icon-action{display:grid;place-items:center;flex:none;box-sizing:border-box;width:38px;height:38px;min-height:38px;margin:0;border:1px solid #cfd8e6;border-radius:9px;padding:0;background:#fff;color:#29486e;cursor:pointer}
td .actions .rate-icon-action:hover:not(:disabled),td .actions .rate-icon-action:focus-visible{border-color:#91afe5;background:#edf3ff;color:#1e4fb0;outline:0}
td .actions .rate-icon-action--danger:hover:not(:disabled),td .actions .rate-icon-action--danger:focus-visible{border-color:#efb0b0;background:#fff1f2;color:#b42318}
td .actions .rate-icon-action svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
td .actions .rate-icon-action:disabled{opacity:.45;cursor:not-allowed}
.bulk-settings{grid-template-columns:repeat(2,minmax(0,1fr))}
@media(max-width:700px){.bulk-settings{grid-template-columns:1fr}}
.preview-counts .duplicate-count{background:#fff1df;color:#9a530d}
.preview-list .duplicate-result{color:#b45309;font-weight:800}
.snackbar{position:fixed;right:24px;bottom:calc(24px + env(safe-area-inset-bottom, 0px));z-index:650;display:flex;align-items:center;gap:12px;box-sizing:border-box;width:max-content;max-width:min(440px,calc(100vw - 32px));min-height:54px;padding:11px 12px 11px 16px;border:1px solid #315473;border-radius:12px;background:#17345b;color:#fff;box-shadow:0 14px 35px rgba(11,32,67,.25);font-size:.88rem;font-weight:650;line-height:1.35}
.snackbar>svg{flex:none;width:21px;height:21px;fill:none;stroke:#a7f3c5;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.snackbar--warning{border-color:#a76721;background:#603b18}
.snackbar--warning>svg{stroke:#ffdc91}
.snackbar>span{min-width:0;overflow-wrap:anywhere}
.snackbar>button{display:grid;flex:none;place-items:center;width:30px;height:30px;margin-left:4px;border:0;border-radius:7px;background:transparent;color:#dbe9fa;font:inherit;font-size:1.3rem;cursor:pointer}
.snackbar>button:hover,.snackbar>button:focus-visible{background:#315473;outline:0}
.snackbar-enter-active,.snackbar-leave-active{transition:opacity .2s ease,transform .2s ease}
.modal footer .danger{border-color:#b42318;background:#b42318;color:#fff}
.modal footer .danger:hover:not(:disabled){background:#941d14}
.snackbar-enter-from,.snackbar-leave-to{opacity:0;transform:translateY(12px)}
.filters{grid-template-columns:minmax(260px,2fr) repeat(3,minmax(150px,1fr))}
.bulk-settings{grid-template-columns:repeat(2,minmax(0,1fr))}
@media(max-width:1000px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:700px){.filters,.bulk-settings{grid-template-columns:1fr}}
@media(max-width:700px){.snackbar{right:16px;bottom:calc(16px + env(safe-area-inset-bottom, 0px))}}
@media(prefers-reduced-motion:reduce){.snackbar-enter-active,.snackbar-leave-active{transition:none}}
@media(max-width:700px){
.bulk-review-modal .review-table-wrap table{min-width:0}.bulk-review-modal .review-table-wrap thead{display:none}.bulk-review-modal .review-table-wrap tbody{display:block}.bulk-review-modal .review-table-wrap tr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;padding:15px;border-bottom:1px solid #e3eaf5}.bulk-review-modal .review-table-wrap td{display:block;min-width:0;border:0;padding:0;white-space:normal;text-align:left}.bulk-review-modal .review-table-wrap td:first-child{grid-column:1/-1}.bulk-review-modal .review-table-wrap td[data-label]::before{content:attr(data-label);display:block;margin-bottom:5px;font-size:.68rem;color:#7188a8}.bulk-review-modal .review-table-wrap tr:last-child{border:0}
}

.agency-groups{display:block}.agency-group{min-width:0}.agency-heading h2{margin:0;font-size:1rem}.agency-content{padding:0 20px 18px 68px;border-top:1px solid #e6edf5;background:#fafcff}.position-group{border-left:1px solid #dce5f1;padding-left:16px}.position-group+.position-group{border-top:1px solid #e8eef5}.position-heading h3{margin:0;font-size:.82rem}.position-toggle{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;border:0;padding:16px 8px;background:transparent;color:#29476b;font:inherit;font-weight:650;text-align:left;cursor:pointer}.position-name{flex:1;min-width:0;overflow-wrap:anywhere}.position-toggle .group-count{font-size:.7rem;font-weight:500;color:#71809a;background:#edf2f8;border-radius:5px;padding:4px 8px;white-space:nowrap}.position-toggle:hover{color:#245fce}.position-toggle:focus-visible{outline:2px solid #2563eb;outline-offset:-3px}.tree-chevron{display:block;flex:none;width:6px;height:6px;border-right:1.5px solid #72849c;border-bottom:1.5px solid #72849c;transform:rotate(-45deg)}.tree-chevron.expanded{transform:rotate(45deg)}.plan-table{border:1px solid #e1e8f1;border-radius:8px;margin-bottom:12px;background:#fff;overflow:auto}.plan-table th,.plan-table td{padding:13px 15px}.plan-table table{table-layout:fixed;min-width:950px}.plan-table th:first-child{width:25%}.plan-table th:nth-child(2){width:15%}.plan-table th:nth-child(3){width:14%}.plan-table th:nth-child(4){width:16%}.plan-table th:nth-child(5){width:10%}.plan-table th:nth-child(6){width:20%}.plan-table td:first-child{white-space:normal;min-width:180px}.plan-table tbody tr:last-child td{border-bottom:0}.plan-table td small{font-size:.72rem}.plan-table tbody tr:hover{background:#fafcff}
@media(max-width:700px){.agency-content{padding:0 12px 12px 20px}.position-group{padding-left:10px}.position-toggle{gap:10px;padding:15px 5px}.plan-table{overflow:visible}.plan-table thead{display:none}.plan-table table,.plan-table tbody{display:block;min-width:0}.plan-table tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:15px;border-bottom:1px solid #e3eaf5}.plan-table td{display:block;border:0;padding:0;white-space:normal;min-width:0;text-align:left;overflow-wrap:anywhere}.plan-table td:first-child{min-width:0}.plan-table td[data-label]::before{content:attr(data-label);display:block;color:#7188a8;font-size:.65rem;margin-bottom:6px}.plan-table .plan-item,.plan-table .plan-actions{grid-column:1/-1}.plan-table tr:last-child{border:0}.plan-actions .actions{gap:9px}}
html[data-theme='dark'] .agency-content{background:#101d34;border-color:var(--line)}html[data-theme='dark'] :is(.position-group,.plan-table){border-color:var(--line)}html[data-theme='dark'] .position-toggle{color:var(--ink)}html[data-theme='dark'] .position-toggle .group-count{background:#233754;color:#b8c9e1}html[data-theme='dark'] .plan-table{background:var(--surface)}
</style>
