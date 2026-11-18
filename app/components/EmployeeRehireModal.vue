<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import { requestErrorMessage } from '~~/shared/utils/requestError'
import { lockBodyScroll } from '~/utils/bodyScrollLock'
import { employeeCurrentDate } from '~/utils/employee'

const props = defineProps<{ employeeId: number }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const context = ref<any>(null), loading = ref(true), saving = ref(false), error = ref(''), success = ref('')
const agency = ref(''), position = ref(''), returnDay = ref(employeeCurrentDate()), previousResignation = ref(''), reason = ref('')
const dialog = ref<HTMLElement | null>(null)
let generation = 0, disposed = false, controller: AbortController | null = null, releaseScroll = () => {}, trigger: HTMLElement | null = null
const agencies = computed(() => Array.from(new Map<number, string>((context.value?.positions || []).map((row: any) => [Number(row.AgencyID), row.AgencyName])).entries()))
const positions = computed(() => (context.value?.positions || []).filter((row: any) => String(row.AgencyID) === agency.value))
const canRehire = computed(() => context.value?.permissions.canRehire && !loading.value && !saving.value)
const resignation = computed(() => context.value?.employee.ResignationDate || previousResignation.value)
const earliestReturn = computed(() => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resignation.value || '')) return undefined
  const next = new Date(resignation.value + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1)
  return Number.isNaN(next.getTime()) ? undefined : next.toISOString().slice(0, 10)
})
const canSave = computed(() => canRehire.value && position.value && returnDay.value && resignation.value && reason.value.trim().length >= 5)
const returnLabel = computed(() => Number(agency.value) === Number(context.value?.employee.AgencyID) ? 'Return to the same agency' : 'Return under a different agency')
async function load() {
  const current = ++generation
  controller?.abort(); controller = new AbortController()
  loading.value = true; error.value = ''
  try {
    const data = await $fetch<any>(`/api/employees/${props.employeeId}/employment-history`, { signal: controller.signal, timeout: 15000, retry: 0 })
    if (current !== generation) return
    context.value = data
    if (!agency.value) {
      agency.value = String(data.employee.AgencyID)
      position.value = data.positions.some((row: any) => Number(row.AgencyPositionID) === Number(data.employee.AgencyPositionID)) ? String(data.employee.AgencyPositionID) : ''
    }
  } catch (cause) { if (current === generation) error.value = requestErrorMessage(cause, 'Unable to load employment history.') }
  finally { if (current === generation) loading.value = false }
}
async function save() {
  if (!canSave.value) return
  saving.value = true; error.value = ''; success.value = ''
  try {
    const employee = context.value.employee
    await $fetch(`/api/employees/${props.employeeId}/rehire`, { method: 'POST', retry: 0, body: {
      AgencyPositionID: Number(position.value), RehireDate: returnDay.value, Reason: reason.value.trim(),
      ResignationDate: employee.ResignationDate || previousResignation.value,
      ExpectedAgencyPositionID: Number(employee.AgencyPositionID), ExpectedResignationDate: employee.ResignationDate || null,
      ExpectedLastRehireDate: employee.LastRehireDate || null,
    } })
    if (disposed) return
    success.value = 'Employee rehired. Previous employment history is retained. Assign the new site separately in Deployment History or DTR.'
    emit('changed'); await load()
  } catch (cause) { error.value = requestErrorMessage(cause, 'Unable to rehire employee. Check employment history before trying again.') }
  finally { saving.value = false }
}
function close() { if (!saving.value) emit('close') }
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const nodes = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]') || []).filter(node => node.getClientRects().length)
  const first = nodes[0], last = nodes[nodes.length - 1]
  if (!first) { event.preventDefault(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) { event.preventDefault(); first.focus() }
}
onMounted(async () => {
  trigger = document.activeElement as HTMLElement | null; releaseScroll = lockBodyScroll()
  await nextTick(); dialog.value?.focus(); await load()
})
onDeactivated(() => emit('close'))
onBeforeUnmount(() => { disposed = true; generation++; controller?.abort(); releaseScroll(); if (trigger?.isConnected) trigger.focus() })
</script>

<template>
  <div class="rehire-layer" @click.self="close" @keydown.esc.stop.prevent="close" @keydown="trapFocus">
    <section ref="dialog" class="rehire-modal" role="dialog" aria-modal="true" aria-labelledby="rehire-title" tabindex="-1" :aria-busy="loading || saving">
      <header><div><p>EMPLOYMENT RECORD</p><h2 id="rehire-title">Employment history &amp; rehire</h2><span>{{ context?.employee.EmployeeName || 'Loading employee...' }}</span></div><button type="button" aria-label="Close employment history" :disabled="saving" @click="close">×</button></header>
      <p v-if="success" class="rehire-success" role="status">{{ success }}</p>
      <p v-if="error" class="rehire-error" role="alert">{{ error }} <button v-if="!context" type="button" @click="load">Retry</button></p>
      <p v-if="loading" role="status">Loading employment history...</p>
      <template v-if="context">
        <dl class="employment-overview"><div><dt>Employment status</dt><dd>{{ context.employee.Status === 'Inactive' ? 'Resigned' : 'Active' }}</dd></div><div><dt>Agency / position</dt><dd>{{ context.employee.AgencyName }} / {{ context.employee.PositionName }}</dd></div><div><dt>Original hire date</dt><dd>{{ context.employee.DateHired || 'Not recorded' }}</dd></div><div><dt>Latest return date</dt><dd>{{ context.employee.LastRehireDate || 'No rehire recorded' }}</dd></div><div v-if="context.employee.Status === 'Inactive'"><dt>Resignation date</dt><dd>{{ context.employee.ResignationDate || 'Not recorded - confirm below' }}</dd></div></dl>
        <form v-if="context.permissions.canRehire" @submit.prevent="save">
          <h3>Rehire this employee</h3>
          <p class="rehire-note">Keep the same Employee ID and original hire date. Select the return agency and position; the previous site will not be reopened automatically. Earlier attendance, payroll and payslips remain under their original records.</p>
          <label v-if="!context.employee.ResignationDate">Previous resignation date<input v-model="previousResignation" type="date" :min="context.employee.LastRehireDate || context.employee.DateHired || undefined" :max="employeeCurrentDate()" :disabled="!canRehire" required><small>This legacy record has no date. Confirm the actual resignation date; do not guess.</small></label>
          <div class="rehire-fields"><label>Return agency<select v-model="agency" aria-label="Return agency" :disabled="!canRehire" required @change="position = ''"><option disabled value="">Select agency</option><option v-for="[id, name] in agencies" :key="id" :value="String(id)">{{ name }}</option></select></label><label>Return position<select v-model="position" aria-label="Return position" :disabled="!canRehire || !agency" required><option disabled value="">Select position</option><option v-for="row in positions" :key="row.AgencyPositionID" :value="String(row.AgencyPositionID)">{{ row.PositionName }}</option></select></label></div>
          <p class="return-kind">{{ returnLabel }}</p>
          <label>Return date<input v-model="returnDay" type="date" :min="earliestReturn" :max="employeeCurrentDate()" :disabled="!canRehire" required></label>
          <label>Reason / reference<textarea v-model.trim="reason" rows="3" minlength="5" maxlength="500" :disabled="!canRehire" placeholder="Confirmed re-employment and supporting reference" required /></label>
          <button class="rehire-primary" type="submit" :disabled="!canSave">{{ saving ? 'Saving rehire...' : 'Confirm rehire' }}</button>
        </form>
        <p v-else-if="context.employee.Status === 'Inactive'" class="rehire-note">Rehiring requires Employees edit access. Ask an authorized staff member to review this record.</p>
        <section class="rehire-history"><h3>Recorded returns</h3><p v-if="!context.history.length">No rehires recorded. The original hire and current resignation dates are shown above.</p><ol v-else><li v-for="row in context.history" :key="row.RehireID"><strong>Returned {{ row.RehireDate }} · {{ row.AgencyName }} / {{ row.PositionName }}</strong><span>Previous period: {{ row.PreviousStartDate || 'Start not recorded' }} to {{ row.ResignationDate }}</span><span>Previous agency / position: {{ row.PreviousAgencyName }} / {{ row.PreviousPositionName }}</span><p>{{ row.Reason }}</p><small>{{ row.CreatedByName || 'Recorder not available' }} · {{ row.CreatedAt }}</small></li></ol></section>
      </template>
      <footer><button type="button" :disabled="saving" @click="close">Close</button></footer>
    </section>
  </div>
</template>

<style scoped>
.rehire-layer{position:fixed;inset:0;z-index:350;display:grid;place-items:center;padding:20px;background:#0f172a94}.rehire-modal{box-sizing:border-box;width:min(800px,100%);max-height:calc(100dvh - 40px);overflow:auto;padding:26px;border-radius:16px;background:var(--theme-surface,#fff);color:var(--theme-ink,#183352);box-shadow:0 24px 70px #0f172a40}.rehire-modal header{display:flex;justify-content:space-between;gap:16px}.rehire-modal header p{margin:0 0 6px;color:var(--theme-accent,#3262d4);font-size:12px;font-weight:800;letter-spacing:.08em}.rehire-modal h2{margin:0 0 8px;font-size:23px}.rehire-modal header span,.rehire-modal small{color:var(--theme-muted,#65768c)}.rehire-modal button{min-height:38px;border:1px solid var(--theme-line,#cfd8e6);border-radius:8px;padding:8px 14px;background:var(--theme-surface,#fff);color:inherit;font:inherit;font-weight:700;cursor:pointer}.rehire-modal header button{align-self:flex-start;font-size:24px;border:0;padding:0 8px}.employment-overview{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:20px 0;padding:15px;border-radius:10px;background:var(--theme-soft,#f3f7fd)}.employment-overview dt{font-size:12px;color:var(--theme-muted,#65768c)}.employment-overview dd{margin:5px 0 0;font-weight:700;overflow-wrap:anywhere}.rehire-modal form{display:grid;gap:14px}.rehire-modal h3{margin:8px 0;font-size:17px}.rehire-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}.rehire-modal label{display:grid;gap:7px;color:var(--theme-muted,#50617a);font-size:13px;font-weight:700}.rehire-modal input,.rehire-modal select,.rehire-modal textarea{box-sizing:border-box;width:100%;min-width:0;min-height:42px;padding:9px 12px;border:1px solid var(--theme-line,#cbd8ea);border-radius:9px;background:var(--theme-surface,#fff);color:var(--theme-ink,#183352);font:inherit}.rehire-note{margin:0;font-size:13px;line-height:1.55;color:var(--theme-muted,#65768c)}.return-kind{margin:0;color:var(--theme-accent,#3262d4);font-size:13px;font-weight:700}.rehire-modal .rehire-primary{justify-self:end;background:#285be3;color:#fff;border-color:#285be3}.rehire-modal button:disabled{opacity:.5;cursor:not-allowed}.rehire-history{margin-top:24px;border-top:1px solid var(--theme-line,#dce4ee);padding-top:8px}.rehire-history>p{font-size:13px;color:var(--theme-muted,#65768c)}.rehire-history ol{list-style:none;padding:0;display:grid;gap:12px}.rehire-history li{display:grid;gap:5px;padding:13px;border:1px solid var(--theme-line,#dce4ee);border-radius:10px;font-size:13px;overflow-wrap:anywhere}.rehire-history li span{color:var(--theme-muted,#65768c)}.rehire-history li p{margin:5px 0}.rehire-error{color:#b42318}.rehire-success{padding:12px;border-radius:8px;background:#dcfce7;color:#166534;line-height:1.5}.rehire-modal footer{display:flex;justify-content:flex-end;margin-top:20px}@media(max-width:600px){.rehire-layer{padding:12px}.rehire-modal{padding:18px;max-height:calc(100dvh - 24px)}.employment-overview,.rehire-fields{grid-template-columns:1fr}.rehire-modal h2{font-size:21px}}
</style>
