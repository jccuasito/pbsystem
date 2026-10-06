<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

type Dtr = { BatchID: number; AgencyName?: string; ClientName?: string; SiteName?: string; PeriodStart?: string; PeriodEnd?: string; Status?: string }
type Employee = { EmployeeID: number; EmployeeNumber?: string | null; EmployeeName: string; PositionName?: string }

const props = withDefaults(defineProps<{
  targetDtr?: Dtr | null
  employees?: Employee[]
  initialEmployeeId?: number | null
  modal?: boolean
}>(), { targetDtr: null, employees: () => [], initialEmployeeId: null, modal: false })
const emit = defineEmits<{ close: []; changed: [] }>()

const items = ref<any[]>([])
const eligibleDates = ref<any[]>([])
const missedDates = ref<any[]>([])
const shiftCodes = ref<any[]>([])
const entryMode = ref<'saved' | 'manual'>('saved')
type ManualDay = { SourceDate: string; ShiftCodeID: string; RegularHours: number; OTHours: number; OTExtHours: number; NightDiffHours: number }
const verifiedDays = ref<ManualDay[]>([])
const sourceBatches = ref<any[]>([])
const targetEmployees = ref<Employee[]>([...props.employees])
const permissions = ref({ canCreate: false, canApprove: false })
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const formError = ref('')
const creating = ref(false)
const search = ref('')
const statusFilter = ref('')
const expanded = ref<Set<number>>(new Set())
const form = ref({ EmployeeID: '', SourceBatchID: '', SourceDates: [] as string[], Reason: '', VerificationReference: '' })

const dateComponents = ['RegularHours', 'OTHours', 'OTExtHours', 'NightDiffHours', 'RestDayHours', 'RestDayOTHours', 'LegalHolidayHours', 'LegalHolidayOTHours', 'RestDayLegalHolidayHours', 'RestDayLegalHolidayOTHours', 'SpecialHolidayHours', 'SpecialHolidayOTHours', 'RestDaySpecialHolidayHours', 'RestDaySpecialHolidayOTHours']
const canSave = computed(() => Boolean(form.value.SourceBatchID && form.value.Reason.length >= 5 && (entryMode.value === 'saved'
  ? form.value.SourceDates.length
  : form.value.VerificationReference.trim().length >= 5 && verifiedDays.value.length && verifiedDays.value.every(day => day.SourceDate &&
    Number(day.RegularHours) + Number(day.OTHours) + Number(day.OTExtHours) > 0))))
const filteredItems = computed(() => items.value.filter(item => {
  if (statusFilter.value && item.Status !== statusFilter.value) return false
  const q = search.value.trim().toLowerCase()
  return !q || [item.AdjustmentID, item.EmployeeName, item.EmployeeNumber, item.Reason, item.ClientName, item.SiteName].join(' ').toLowerCase().includes(q)
}))

function dateOnly(value: unknown) { return String(value || '').slice(0, 10) }
function prettyDate(value: unknown) {
  const raw = dateOnly(value)
  if (!raw) return '-'
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(raw + 'T00:00:00'))
}
function period(start: unknown, end: unknown) { return `${prettyDate(start)} - ${prettyDate(end)}` }
function money(value: unknown) { return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0)) }
function hours(value: unknown) { return Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 }) }
function payableHours(item: any) { return dateComponents.reduce((sum, key) => sum + Number(item[key] || 0), 0) }
function lineDates(item: any) { return [...new Set((item.Lines || []).map((line: any) => dateOnly(line.SourceDate)))].map(prettyDate).join(', ') }
function statusClass(value: string) { return `status--${String(value).toLowerCase().replace(/[^a-z]+/g, '-')}` }
function isManual(item: any) { return item.AdjustmentType === 'Verified Missed Attendance' }
function resetVerifiedDays() { verifiedDays.value = entryMode.value === 'manual' ? [{ SourceDate: '', ShiftCodeID: '', RegularHours: 0, OTHours: 0, OTExtHours: 0, NightDiffHours: 0 }] : [] }

async function load(silent = false) {
  if (!silent) loading.value = true
  error.value = ''
  try {
    const query: Record<string, string | number> = {}
    if (props.targetDtr?.BatchID) query.targetBatchId = props.targetDtr.BatchID
    const response = await $fetch<any>('/api/payroll/adjustments', { query })
    items.value = response.items || []
    targetEmployees.value = response.targetEmployees?.length ? response.targetEmployees : [...props.employees]
    permissions.value = response.permissions || permissions.value
  } catch (cause: any) {
    error.value = cause?.data?.statusMessage || 'Unable to load payroll adjustments.'
  } finally { if (!silent) loading.value = false }
}

async function loadSourceOptions() {
  eligibleDates.value = []
  missedDates.value = []
  shiftCodes.value = []
  resetVerifiedDays()
  sourceBatches.value = []
  form.value.SourceDates = []
  form.value.SourceBatchID = ''
  formError.value = ''
  if (!props.targetDtr?.BatchID || !form.value.EmployeeID) return
  try {
    const query: Record<string, string | number> = { targetBatchId: props.targetDtr.BatchID, employeeId: form.value.EmployeeID }
    const response = await $fetch<any>('/api/payroll/adjustments', { query })
    permissions.value = response.permissions || permissions.value
    sourceBatches.value = response.sourceBatches || []
  } catch (cause: any) { formError.value = cause?.data?.statusMessage || 'Unable to load previous payroll cutoffs.' }
}

function changeEmployee() {
  void loadSourceOptions()
}

async function loadDates() {
  eligibleDates.value = []
  missedDates.value = []
  shiftCodes.value = []
  resetVerifiedDays()
  form.value.SourceDates = []
  formError.value = ''
  if (!props.targetDtr?.BatchID || !form.value.EmployeeID || !form.value.SourceBatchID) return
  try {
    const response = await $fetch<any>('/api/payroll/adjustments', { query: { targetBatchId: props.targetDtr.BatchID, sourceBatchId: form.value.SourceBatchID, employeeId: form.value.EmployeeID } })
    eligibleDates.value = (response.eligibleDates || []).map((item: any) => ({
      ...item,
      PayableHours: payableHours(item),
    }))
    missedDates.value = response.missedDates || []
    shiftCodes.value = response.shiftCodes || []
  } catch (cause: any) { formError.value = cause?.data?.statusMessage || 'Unable to load eligible attendance dates.' }
}

function openCreate(employeeId?: number) {
  if (!permissions.value.canCreate) return
  form.value = { EmployeeID: String(employeeId || props.initialEmployeeId || ''), SourceBatchID: '', SourceDates: [], Reason: '', VerificationReference: '' }
  entryMode.value = 'saved'
  verifiedDays.value = []
  creating.value = true
  loadSourceOptions()
}

function closeCreate() { if (!busy.value) { creating.value = false; formError.value = '' } }

function addVerifiedDay() { verifiedDays.value.push({ SourceDate: '', ShiftCodeID: '', RegularHours: 0, OTHours: 0, OTExtHours: 0, NightDiffHours: 0 }) }
function chooseShift(day: ManualDay) {
  const shift = shiftCodes.value.find(item => String(item.ShiftCodeID) === day.ShiftCodeID)
  if (!shift) return
  day.RegularHours = Number(shift.RegularHours || 0)
  day.OTHours = Number(shift.RegularOTCap || 0)
  day.OTExtHours = 0
  day.NightDiffHours = 0
}
function availableMissedDate(item: any, row: ManualDay) {
  return !item.PayableHours && !item.ExistingAdjustmentID && !item.UnavailableReason &&
    !verifiedDays.value.some(day => day !== row && day.SourceDate === item.SourceDate)
}

async function save(submit: boolean) {
  if (busy.value || !props.targetDtr?.BatchID) return
  busy.value = true; formError.value = ''
  try {
    await $fetch('/api/payroll/adjustments', { method: 'POST', body: {
      EmployeeID: Number(form.value.EmployeeID), SourceBatchID: Number(form.value.SourceBatchID),
      TargetBatchID: props.targetDtr.BatchID,
      SourceDates: entryMode.value === 'saved' ? form.value.SourceDates : [],
      ManualDays: entryMode.value === 'manual' ? verifiedDays.value : [],
      VerificationReference: form.value.VerificationReference,
      Reason: form.value.Reason, Submit: submit,
    } })
    creating.value = false
    await load(true)
    emit('changed')
  } catch (cause: any) { formError.value = cause?.data?.statusMessage || 'Unable to save the payroll adjustment.' }
  finally { busy.value = false }
}

async function act(item: any, action: string) {
  if (busy.value) return
  const labels: Record<string, string> = { approve: 'approve', reject: 'reject', cancel: 'cancel', reopen: 'reopen', submit: 'submit' }
  if (['reject', 'cancel'].includes(action) && !confirm(`${labels[action][0].toUpperCase() + labels[action].slice(1)} adjustment #${item.AdjustmentID}?`)) return
  busy.value = true; error.value = ''
  try {
    await $fetch('/api/payroll/adjustments', { method: 'PUT', body: { AdjustmentID: item.AdjustmentID, Action: action } })
    await load(true); emit('changed')
  } catch (cause: any) { error.value = cause?.data?.statusMessage || 'Unable to update the payroll adjustment.' }
  finally { busy.value = false }
}

function toggleLines(id: number) {
  const next = new Set(expanded.value)
  next.has(id) ? next.delete(id) : next.add(id)
  expanded.value = next
}

watch(() => props.initialEmployeeId, value => { if (value && props.modal) openCreate(value) })
watch(entryMode, mode => { if (mode === 'manual' && !verifiedDays.value.length) addVerifiedDay() })
onMounted(async () => { await load(); if (props.initialEmployeeId && props.targetDtr) openCreate(props.initialEmployeeId) })
defineExpose({ openCreate })
</script>

<template>
  <Teleport to="body" :disabled="!modal">
    <div :class="modal ? 'adjustment-backdrop' : 'adjustment-page-host'" @click.self="modal && emit('close')">
      <section class="adjustments-panel" :class="{ 'adjustments-panel--modal': modal }">
        <button v-if="modal" class="panel-close" type="button" aria-label="Close" @click="emit('close')">×</button>
        <header class="panel-head">
          <div><p>PAYROLL</p><h1>{{ targetDtr ? 'Payroll adjustments' : 'Payroll Adjustments' }}</h1><span v-if="targetDtr">For {{ targetDtr.ClientName }} · {{ targetDtr.SiteName }} · {{ period(targetDtr.PeriodStart, targetDtr.PeriodEnd) }}</span><span v-else>Review prior-period corrections before they are included in a later payroll cutoff.</span></div>
          <button v-if="targetDtr && permissions.canCreate" class="primary" type="button" @click="openCreate()">+ Add adjustment</button>
        </header>

        <p v-if="targetDtr" class="target-note"><strong>Adjust this cutoff:</strong> choose an employee and earlier cutoff. Verified missed days can be marked Ready for Payroll without a separate adjustment approval. Compute to Payroll currently changes only the DTR status and does not post adjustment pay.</p>
        <p v-if="error" class="error-banner" role="alert">{{ error }}</p>

        <div class="adjustment-filters">
          <label><span>Search</span><input v-model="search" type="search" placeholder="Employee, reason, site, or adjustment ID"></label>
          <label><span>Status</span><select v-model="statusFilter"><option value="">All statuses</option><option>Draft</option><option>For Approval</option><option>Approved</option><option>Ready for Payroll</option><option>Applied</option><option>Rejected</option><option>Cancelled</option></select></label>
        </div>

        <div class="adjustment-summary">{{ loading ? 'Loading adjustments…' : `${filteredItems.length} adjustment${filteredItems.length === 1 ? '' : 's'}` }}</div>
        <div class="adjustment-table-wrap">
          <table class="adjustment-table">
            <thead><tr><th>Adjustment</th><th>Employee</th><th>Original attendance</th><th>Target cutoff</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              <template v-for="item in filteredItems" :key="item.AdjustmentID">
                <tr>
                  <td><strong>#{{ item.AdjustmentID }} · {{ item.AdjustmentType }}</strong><small>{{ item.Reason }}</small><small v-if="item.VerificationReference">Evidence: {{ item.VerificationReference }}</small></td>
                  <td><strong>{{ item.EmployeeName }}</strong><small>{{ item.EmployeeNumber || `EMP-${String(item.EmployeeID).padStart(4, '0')}` }}</small></td>
                  <td><span>{{ lineDates(item) }}</span><small>{{ period(item.SourcePeriodStart, item.SourcePeriodEnd) }} · {{ item.ClientName }} / {{ item.SiteName }}</small></td>
                  <td><span>{{ period(item.TargetPeriodStart, item.TargetPeriodEnd) }}</span><small>DTR-{{ String(item.TargetBatchID).padStart(4, '0') }}</small></td>
                  <td><strong>{{ money(item.TotalAmount) }}</strong><button class="line-toggle" type="button" @click="toggleLines(item.AdjustmentID)">{{ expanded.has(item.AdjustmentID) ? 'Hide' : 'View' }} breakdown</button></td>
                  <td><span class="status-pill" :class="statusClass(item.Status)">{{ item.Status }}</span></td>
                  <td><div class="row-actions"><button v-if="item.Status === 'Draft'" type="button" :disabled="busy" @click="act(item, 'submit')">{{ isManual(item) ? 'Ready for payroll' : 'Submit' }}</button><button v-if="item.Status === 'For Approval' && !isManual(item) && permissions.canApprove" class="approve" type="button" :disabled="busy" @click="act(item, 'approve')">Approve</button><button v-if="item.Status === 'For Approval' && !isManual(item) && permissions.canApprove" type="button" :disabled="busy" @click="act(item, 'reject')">Reject</button><button v-if="['Draft','For Approval','Approved','Ready for Payroll'].includes(item.Status)" type="button" :disabled="busy" @click="act(item, 'cancel')">Cancel</button><button v-if="['Rejected','Cancelled'].includes(item.Status)" type="button" :disabled="busy" @click="act(item, 'reopen')">Reopen</button></div></td>
                </tr>
                <tr v-if="expanded.has(item.AdjustmentID)" class="line-row"><td colspan="7"><div class="line-list"><div v-for="line in item.Lines" :key="line.AdjustmentLineID"><span>{{ prettyDate(line.SourceDate) }}</span><strong>{{ line.Description.split(' - ')[0] }}<small v-if="line.EntrySource === 'Manual Verification'">Manually verified</small></strong><span>{{ hours(line.Quantity) }} × {{ money(line.Rate) }}</span><b :class="{ deduction: line.Direction === 'Deduction' }">{{ money(line.Amount) }}</b></div></div></td></tr>
              </template>
              <tr v-if="!loading && !filteredItems.length"><td colspan="7" class="empty-state"><strong>No payroll adjustments for this cutoff.</strong><span v-if="targetDtr">Use Add adjustment to bring verified attendance pay from a previous cutoff into this cutoff.</span></td></tr>
            </tbody>
          </table>
        </div>

        <div class="mobile-adjustments">
          <p v-if="!loading && !filteredItems.length" class="mobile-empty-state">No payroll adjustments found.</p>
          <article v-for="item in filteredItems" :key="`mobile-${item.AdjustmentID}`">
            <header><div><strong>#{{ item.AdjustmentID }} · {{ item.EmployeeName }}</strong><small>{{ item.AdjustmentType }}</small></div><span class="status-pill" :class="statusClass(item.Status)">{{ item.Status }}</span></header>
            <dl><div><dt>Original dates</dt><dd>{{ lineDates(item) }}</dd></div><div><dt>Target cutoff</dt><dd>{{ period(item.TargetPeriodStart, item.TargetPeriodEnd) }}</dd></div><div><dt>Amount</dt><dd>{{ money(item.TotalAmount) }}</dd></div><div><dt>Reason</dt><dd>{{ item.Reason }}</dd></div><div v-if="item.VerificationReference"><dt>Evidence</dt><dd>{{ item.VerificationReference }}</dd></div></dl>
            <button class="line-toggle" type="button" @click="toggleLines(item.AdjustmentID)">{{ expanded.has(item.AdjustmentID) ? 'Hide' : 'View' }} breakdown</button>
            <div v-if="expanded.has(item.AdjustmentID)" class="line-list"><div v-for="line in item.Lines" :key="line.AdjustmentLineID"><span>{{ prettyDate(line.SourceDate) }}</span><strong>{{ line.Description.split(' - ')[0] }}</strong><b :class="{ deduction: line.Direction === 'Deduction' }">{{ money(line.Amount) }}</b></div></div>
            <footer class="row-actions"><button v-if="item.Status === 'Draft'" type="button" @click="act(item, 'submit')">{{ isManual(item) ? 'Ready for payroll' : 'Submit' }}</button><button v-if="item.Status === 'For Approval' && !isManual(item) && permissions.canApprove" class="approve" type="button" @click="act(item, 'approve')">Approve</button><button v-if="item.Status === 'For Approval' && !isManual(item) && permissions.canApprove" type="button" @click="act(item, 'reject')">Reject</button><button v-if="['Draft','For Approval','Approved','Ready for Payroll'].includes(item.Status)" type="button" @click="act(item, 'cancel')">Cancel</button><button v-if="['Rejected','Cancelled'].includes(item.Status)" type="button" @click="act(item, 'reopen')">Reopen</button></footer>
          </article>
        </div>

        <div v-if="creating" class="form-backdrop" @click.self="closeCreate">
          <form class="adjustment-form" @submit.prevent="save(true)">
            <button class="panel-close" type="button" :disabled="busy" @click="closeCreate">×</button>
            <header><p>PRIOR-PERIOD CORRECTION</p><h2>Add missed attendance pay</h2><span>Select saved attendance or enter verified days missing from a finalized prior DTR.</span></header>
            <div v-if="targetDtr" class="pay-cutoff-card"><span>TARGET PAYROLL CUTOFF</span><strong>{{ period(targetDtr.PeriodStart, targetDtr.PeriodEnd) }}</strong><small>{{ targetDtr.ClientName }} · {{ targetDtr.SiteName }} · DTR-{{ String(targetDtr.BatchID).padStart(4, '0') }}</small></div>
            <div class="source-selection">
              <label><span>Employee in this cutoff</span><select v-model="form.EmployeeID" required @change="changeEmployee"><option value="" disabled>Select employee</option><option v-for="employee in targetEmployees" :key="employee.EmployeeID" :value="String(employee.EmployeeID)">{{ employee.EmployeeName }} · {{ employee.EmployeeNumber || `EMP-${String(employee.EmployeeID).padStart(4, '0')}` }}</option></select></label>
              <label><span>Original cutoff</span><select v-model="form.SourceBatchID" required :disabled="!form.EmployeeID" @change="loadDates"><option value="" disabled>Select previous cutoff</option><option v-for="batch in sourceBatches" :key="batch.BatchID" :value="String(batch.BatchID)">{{ period(batch.PeriodStart, batch.PeriodEnd) }} · {{ batch.ClientName }} / {{ batch.SiteName }}</option></select></label>
              <p class="source-help" aria-live="polite"><template v-if="!form.EmployeeID">Select an employee to retrieve original cutoffs.</template><template v-else-if="!sourceBatches.length">No earlier cutoff was found for this employee.</template><template v-else>Earlier cutoffs where this employee was assigned are shown.</template></p>
            </div>
            <div class="entry-modes" role="group" aria-label="Adjustment source"><button type="button" :class="{ selected: entryMode === 'saved' }" @click="entryMode = 'saved'">Saved DTR attendance</button><button type="button" :class="{ selected: entryMode === 'manual' }" @click="entryMode = 'manual'">Verified missed day</button></div>
            <div v-if="entryMode === 'manual'" class="verified-section">
              <p>For each day actually worked but omitted from the earlier finalized DTR, choose its original date. Use a shift to prefill hours, or leave it blank and enter verified regular, OT, OT extension, and night differential hours directly. Holiday and Sunday dates need separate rate treatment.</p>
              <p v-if="form.SourceBatchID && !missedDates.some(item => !item.PayableHours && !item.ExistingAdjustmentID && !item.UnavailableReason)">No eligible missed dates in this cutoff. If the DTR is still Draft, edit it there.</p>
              <div v-for="(day, index) in verifiedDays" :key="index" class="verified-day">
                <div class="verified-day-head"><strong>Missed day {{ index + 1 }}</strong><button type="button" @click="verifiedDays.splice(index, 1)">Remove</button></div>
                <div class="verified-day-grid">
                  <label><span>Actual missed date</span><select v-model="day.SourceDate" required :disabled="!form.SourceBatchID"><option value="" disabled>{{ form.SourceBatchID ? 'Select date' : 'Select employee and original cutoff first' }}</option><option v-for="item in missedDates" :key="item.SourceDate" :value="item.SourceDate" :disabled="!availableMissedDate(item, day)">{{ prettyDate(item.SourceDate) }}{{ item.UnavailableReason ? ` - ${item.UnavailableReason}` : item.ExistingAdjustmentID ? ` - adjustment #${item.ExistingAdjustmentID}` : item.PayableHours ? ' - saved attendance' : '' }}</option></select></label>
                  <label><span>Shift code (optional)</span><select v-model="day.ShiftCodeID" :disabled="!form.SourceBatchID" @change="chooseShift(day)"><option value="">Enter hours directly</option><option v-for="shift in shiftCodes" :key="shift.ShiftCodeID" :value="String(shift.ShiftCodeID)">{{ shift.ShiftCode }} - {{ shift.ShiftName }}</option></select></label>
                  <label><span>Regular hours</span><input v-model.number="day.RegularHours" type="number" min="0" max="24" step="0.01" required></label>
                  <label><span>Regular OT</span><input v-model.number="day.OTHours" type="number" min="0" max="24" step="0.01" required></label>
                  <label><span>OT extension</span><input v-model.number="day.OTExtHours" type="number" min="0" max="24" step="0.01" required></label>
                  <label><span>Night differential</span><input v-model.number="day.NightDiffHours" type="number" min="0" max="24" step="0.01" required></label>
                </div>
              </div>
              <button class="add-day" type="button" :disabled="!form.SourceBatchID || !missedDates.some(item => !item.PayableHours && !item.ExistingAdjustmentID && !item.UnavailableReason)" @click="addVerifiedDay">+ Add missed day</button>
              <label class="reason-field"><span>Verification reference</span><input v-model.trim="form.VerificationReference" minlength="5" maxlength="255" required placeholder="Signed timesheet or work log reference"></label>
            </div>
            <fieldset v-if="entryMode === 'saved'" class="date-picker"><legend>Original attendance dates</legend><p v-if="!form.EmployeeID">Select an employee first.</p><p v-else-if="!form.SourceBatchID">Select the original cutoff to view its saved attendance.</p><p v-else-if="!eligibleDates.length">No saved payable attendance dates were found. Use Verified missed day if the prior DTR is finalized.</p><label v-for="item in eligibleDates" :key="item.AttendanceID" :class="{ claimed: item.ExistingAdjustmentID || !item.PayableHours }"><input v-model="form.SourceDates" type="checkbox" :value="item.AttendanceDate" :disabled="Boolean(item.ExistingAdjustmentID) || !item.PayableHours"><span><strong>{{ prettyDate(item.AttendanceDate) }}</strong><small>{{ item.AttendanceStatus || 'Present' }} · {{ hours(item.PayableHours) }} payable component hours</small><em v-if="item.ExistingAdjustmentID">Already in adjustment #{{ item.ExistingAdjustmentID }} · {{ item.ExistingAdjustmentStatus }}</em><em v-else-if="!item.PayableHours">No payable attendance components</em></span></label></fieldset>
            <label class="reason-field"><span>Reason</span><textarea v-model.trim="form.Reason" minlength="5" maxlength="500" required placeholder="Example: September 1 and 2 attendance was verified but was not included in the original payroll."></textarea></label>
            <p class="calculation-note">{{ entryMode === 'saved' ? 'Saved attendance components are copied at the linked payroll rates. This mode retains its adjustment approval step.' : 'Verified hours are priced using the original deployment linked payroll rates and marked Ready for Payroll without a separate adjustment approval.' }} The original DTR remains unchanged. Compute to Payroll does not yet add this amount to a payroll record.</p>
            <p v-if="formError" class="error-banner" role="alert">{{ formError }}</p>
            <footer><button type="button" :disabled="busy" @click="closeCreate">Cancel</button><button type="button" :disabled="busy || !canSave" @click="save(false)">Save draft</button><button class="primary" :disabled="busy || !canSave">{{ busy ? 'Saving…' : entryMode === 'manual' ? 'Save for payroll review' : 'Submit for approval' }}</button></footer>
          </form>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.adjustment-page-host{width:100%}.adjustment-backdrop{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:32px;background:rgba(12,29,61,.34)}
.adjustments-panel{--ink:#152442;--muted:#657694;--line:#d8e2f0;--soft:#f5f8fc;position:relative;box-sizing:border-box;color:var(--ink);background:#fff;font-family:'Plus Jakarta Sans','Inter',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.45}.adjustments-panel--modal{width:min(1180px,calc(100vw - 64px));max-height:calc(100vh - 64px);overflow:auto;border:1px solid rgba(203,216,234,.9);border-radius:16px;padding:28px;box-shadow:0 24px 64px rgba(14,35,72,.28)}
.panel-close{position:absolute;z-index:2;top:16px;right:16px;display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;color:#415777;font-family:inherit;font-size:24px;line-height:1;cursor:pointer}.panel-close:hover{background:#eef3fa;color:#183b6e}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:22px;padding-right:42px}.panel-head>div{min-width:0}.panel-head p,.adjustment-form header p{margin:0 0 5px;color:#2b63df;font-size:12px;font-weight:800;letter-spacing:.08em}.panel-head h1{margin:0;font-size:28px;line-height:1.2}.panel-head span,.adjustment-form header span{display:block;margin-top:6px;color:var(--muted);line-height:1.5}
button,.primary,input,select,textarea{font:inherit}.primary{border:1px solid #2867e8!important;background:#2867e8!important;color:#fff!important;font-weight:800}.panel-head button{min-height:48px;padding:0 18px;border-radius:10px}.target-note,.error-banner{margin:0 0 18px;padding:12px 14px;border-radius:9px}.target-note{border:1px solid #cfe0fb;background:#eff6ff;color:#315887}.error-banner{border:1px solid #fecaca;background:#fff1f2;color:#b42318}
.adjustment-filters{display:grid;grid-template-columns:minmax(280px,1fr) 240px;gap:14px}.adjustment-filters label,.source-selection label,.reason-field{display:grid;gap:7px;color:#41516d;font-size:13px;font-weight:800}.adjustment-filters input,.adjustment-filters select,.source-selection select,.reason-field textarea{width:100%;box-sizing:border-box;border:1px solid #cbd8ea;border-radius:9px;background:#fff;color:var(--ink);min-height:48px;padding:0 13px}.reason-field textarea{min-height:96px;padding:12px;resize:vertical}.adjustment-summary{padding:12px 2px;color:var(--muted);font-size:13px}
.adjustment-table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px}.adjustment-table{width:100%;min-width:1050px;border-collapse:collapse}.adjustment-table th{padding:11px 12px;background:var(--soft);color:#485a78;font-size:11px;letter-spacing:.035em;text-align:left;text-transform:uppercase}.adjustment-table td{padding:13px 12px;border-top:1px solid var(--line);vertical-align:top;font-size:13px}.adjustment-table td strong,.adjustment-table td small{display:block}.adjustment-table td small{margin-top:4px;color:var(--muted);line-height:1.35}.line-toggle{display:block;margin-top:5px;padding:0;border:0;background:transparent;color:#1f59cf;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer}.status-pill{display:inline-flex;padding:5px 9px;border-radius:999px;background:#e8eef7;color:#45536c;font-size:11px;font-weight:800;white-space:nowrap}.status--for-approval{background:#fff0c2;color:#8a5a00}.status--approved,.status--applied{background:#d7f8e4;color:#08753c}.status--rejected,.status--cancelled{background:#fee2e2;color:#b42318}.row-actions{display:flex;flex-wrap:wrap;gap:6px}.row-actions button{min-height:34px;padding:0 10px;border:1px solid #cbd8ea;border-radius:8px;background:#fff;color:#23436f;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer}.row-actions .approve{border-color:#1e9b5a;background:#1e9b5a;color:#fff}.line-row td{background:#f9fbfe}.line-list{display:grid;gap:1px;overflow:hidden;border:1px solid var(--line);border-radius:8px;background:var(--line)}.line-list>div{display:grid;grid-template-columns:130px 1fr 180px 120px;gap:12px;padding:9px 12px;background:#fff}.line-list b{text-align:right;color:#08753c}.line-list b.deduction{color:#b42318}.empty-state{text-align:center!important;padding:38px!important}.empty-state strong,.empty-state span{display:block}.empty-state span{margin-top:5px;color:var(--muted)}.mobile-adjustments{display:none}.mobile-empty-state{padding:30px 12px;text-align:center;color:var(--muted)}
.form-backdrop{position:fixed;inset:0;z-index:1250;display:grid;place-items:center;padding:32px;background:rgba(12,29,61,.38)}.adjustment-form{position:relative;width:min(980px,calc(100vw - 96px));max-height:calc(100vh - 64px);overflow:auto;box-sizing:border-box;border-radius:16px;background:#fff;padding:30px 36px;color:var(--ink);box-shadow:0 24px 70px rgba(8,26,57,.35)}.adjustment-form header h2{margin:0;font-size:27px}.pay-cutoff-card{display:grid;gap:3px;margin-top:20px;padding:13px 15px;border:1px solid #bfd4f5;border-radius:10px;background:#f3f7ff}.pay-cutoff-card span{color:#3567b8;font-size:10px;font-weight:900;letter-spacing:.08em}.pay-cutoff-card strong{font-size:15px}.pay-cutoff-card small{color:var(--muted)}.source-selection{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px 16px;margin-top:18px;padding:15px 16px 12px;border:1px solid var(--line);border-radius:10px}.source-help{grid-column:1/-1;margin:0;color:var(--muted);font-size:12px}.date-picker{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:18px 0;padding:15px;border:1px solid var(--line);border-radius:10px}.date-picker legend{padding:0 6px;font-weight:800}.date-picker>p{grid-column:1/-1;color:var(--muted)}.date-picker label{display:flex;gap:9px;padding:10px;border:1px solid var(--line);border-radius:8px;cursor:pointer}.date-picker label:has(input:checked){border-color:#2867e8;background:#edf4ff}.date-picker label.claimed{opacity:.64;cursor:not-allowed}.date-picker input{margin-top:3px}.date-picker strong,.date-picker small,.date-picker em{display:block}.date-picker small{margin-top:3px;color:var(--muted);font-size:11px}.date-picker em{margin-top:4px;color:#b45309;font-size:11px;font-style:normal}.calculation-note{padding:11px 13px;border-radius:8px;background:#eef5ff;color:#385779;font-size:12px;line-height:1.45}.adjustment-form footer{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}.adjustment-form footer button{min-height:44px;padding:0 16px;border:1px solid #cbd8ea;border-radius:9px;background:#fff;color:#23436f;font-weight:800}
:global(html[data-theme='dark']) .adjustments-panel,:global(html[data-theme='dark']) .adjustment-form{--ink:#edf3ff;--muted:#9fb0cc;--line:#2b4165;--soft:#162643;background:#0d1930;color:var(--ink)}:global(html[data-theme='dark']) .adjustment-table td,:global(html[data-theme='dark']) .line-list>div,:global(html[data-theme='dark']) .adjustment-filters input,:global(html[data-theme='dark']) .adjustment-filters select,:global(html[data-theme='dark']) .source-selection select,:global(html[data-theme='dark']) .reason-field textarea,:global(html[data-theme='dark']) .row-actions button,:global(html[data-theme='dark']) .adjustment-form footer button{background:#12213d;color:#edf3ff;border-color:#344b70}:global(html[data-theme='dark']) .line-row td{background:#101e38}:global(html[data-theme='dark']) .calculation-note,:global(html[data-theme='dark']) .target-note,:global(html[data-theme='dark']) .pay-cutoff-card{background:#172b4d;border-color:#344b70;color:#c6d5ec}:global(html[data-theme='dark']) .panel-close:hover{background:#172a49;color:#fff}
@media(max-width:760px){.adjustment-backdrop{place-items:stretch;padding:0}.adjustments-panel--modal{width:100%;max-height:100vh;border:0;border-radius:0;padding:64px 14px 24px}.panel-close{top:14px;right:14px}.panel-head{display:grid;gap:16px;margin-bottom:18px;padding-right:0}.panel-head h1{font-size:25px}.panel-head button{width:100%}.adjustment-filters{grid-template-columns:1fr}.adjustment-table-wrap{display:none}.mobile-adjustments{display:grid;gap:11px}.mobile-adjustments article{border:1px solid var(--line);border-radius:11px;padding:13px}.mobile-adjustments article>header{display:flex;justify-content:space-between;gap:10px}.mobile-adjustments header strong,.mobile-adjustments header small{display:block}.mobile-adjustments header small{margin-top:3px;color:var(--muted)}.mobile-adjustments dl{display:grid;gap:8px;margin:14px 0}.mobile-adjustments dl div{display:grid;grid-template-columns:105px 1fr;gap:10px}.mobile-adjustments dt{color:var(--muted);font-size:11px;font-weight:800;text-transform:uppercase}.mobile-adjustments dd{margin:0;font-size:12px}.mobile-adjustments footer{margin-top:13px}.mobile-adjustments .line-list{margin-top:10px}.line-list>div{grid-template-columns:1fr auto}.line-list>div span:first-child{grid-column:1/-1}.line-list>div span:nth-child(3){display:none}.form-backdrop{padding:0;place-items:stretch}.adjustment-form{width:100%;max-height:100vh;border-radius:0;padding:64px 15px 22px}.source-selection,.date-picker{grid-template-columns:1fr}.adjustment-form footer{display:grid;grid-template-columns:1fr 1fr}.adjustment-form footer .primary{grid-column:1/-1;grid-row:1}.adjustment-form footer button{width:100%}}
.status--ready-for-payroll{background:#dbeafe;color:#1e40af}.entry-modes{display:flex;gap:8px;margin-top:18px}.entry-modes button,.add-day,.verified-day-head button{border:1px solid var(--line);border-radius:8px;background:#fff;color:#244670;padding:9px 13px;font-weight:800;cursor:pointer}.entry-modes button.selected{border-color:#2867e8;background:#eaf2ff;color:#164dbd}.verified-section{display:grid;gap:14px;margin:18px 0;padding:16px;border:1px solid var(--line);border-radius:10px}.verified-section>p{margin:0;color:var(--muted);font-size:12px}.verified-day{padding:13px;border:1px solid var(--line);border-radius:9px}.verified-day-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.verified-day-head button{padding:5px 10px;color:#b42318}.verified-day-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.verified-day-grid label{display:grid;gap:6px;min-width:0;color:#41516d;font-size:12px;font-weight:800}.verified-day-grid input,.verified-day-grid select,.verified-section .reason-field input{box-sizing:border-box;width:100%;min-height:42px;padding:8px 10px;border:1px solid #cbd8ea;border-radius:8px;background:#fff;color:var(--ink)}.add-day:disabled{opacity:.5;cursor:not-allowed}:global(html[data-theme='dark']) .verified-day-grid input,:global(html[data-theme='dark']) .verified-day-grid select,:global(html[data-theme='dark']) .verified-section .reason-field input,:global(html[data-theme='dark']) .entry-modes button,:global(html[data-theme='dark']) .add-day{background:#12213d;color:#edf3ff;border-color:#344b70}@media(max-width:760px){.entry-modes{flex-wrap:wrap}.verified-day-grid{grid-template-columns:1fr 1fr}}
</style>
