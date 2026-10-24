<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps<{ employeeId: number }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
const effectiveDate = ref(today()), newPosition = ref(''), siteRateId = ref(''), reason = ref('')
const context = ref<any>(null), loading = ref(true), saving = ref(false), error = ref(''), success = ref(''), loadedDate = ref('')
let request = 0
const dialog = ref<HTMLElement | null>(null)
let trigger: HTMLElement | null = null
const positions = computed(() => (context.value?.positions || []).filter((item: any) => Number(item.AgencyPositionID) !== Number(context.value?.employee.AgencyPositionID)))
const rates = computed(() => (context.value?.siteRates || []).filter((item: any) => String(item.AgencyPositionID) === newPosition.value))
const canEdit = computed(() => context.value?.permissions.canEdit && !loading.value && !saving.value)
const canSave = computed(() => canEdit.value && loadedDate.value === effectiveDate.value && newPosition.value && reason.value.trim().length >= 5 && (!context.value.assignment || siteRateId.value))
watch(rates, options => { if (!options.some((item: any) => String(item.SiteRateID) === siteRateId.value)) siteRateId.value = options.length === 1 ? String(options[0].SiteRateID) : '' })
async function load() {
  const current = ++request, date = effectiveDate.value
  loading.value = true; error.value = ''; loadedDate.value = ''
  try {
    const result = await $fetch<any>(`/api/employees/${props.employeeId}/position-changes`, { query: { effectiveDate: date } })
    if (current !== request) return
    context.value = result; loadedDate.value = date
  } catch (cause: any) { if (current === request) error.value = cause?.data?.statusMessage || 'Unable to load position history.' }
  finally { if (current === request) loading.value = false }
}
async function save() {
  if (!canSave.value) return
  saving.value = true; error.value = ''; success.value = ''
  try {
    await $fetch(`/api/employees/${props.employeeId}/position-changes`, { method: 'POST', body: {
      AgencyPositionID: Number(newPosition.value), ExpectedAgencyPositionID: Number(context.value.employee.AgencyPositionID),
      EffectiveDate: effectiveDate.value, Reason: reason.value.trim(), SiteRateID: siteRateId.value ? Number(siteRateId.value) : null,
    } })
    newPosition.value = ''; siteRateId.value = ''; reason.value = ''
    success.value = 'Position updated. Employee ID, employee number, agency, and site retained.'
    emit('changed'); await load()
  } catch (cause: any) { error.value = cause?.data?.statusMessage || 'Unable to change position.' }
  finally { saving.value = false }
}
onMounted(async () => { trigger = document.activeElement as HTMLElement | null; await load(); await nextTick(); dialog.value?.focus() })
onBeforeUnmount(() => { request++; if (trigger?.isConnected) trigger.focus() })
</script>

<template>
  <div class="position-change-layer" @click.self="!saving && emit('close')" @keydown.esc.stop="!saving && emit('close')">
    <section ref="dialog" class="position-change-modal" role="dialog" aria-modal="true" aria-labelledby="position-change-title" tabindex="-1">
      <header><div><p>EMPLOYEE POSITION</p><h2 id="position-change-title">Change position</h2><span>{{ context?.employee.EmployeeName || 'Loading employee...' }}</span></div><button type="button" aria-label="Close position history" :disabled="saving" @click="emit('close')">×</button></header>
      <p v-if="success" class="position-success" role="status">{{ success }}</p>
      <p v-if="error" class="position-error" role="alert">{{ error }} <button v-if="!context" type="button" @click="load">Retry</button></p>
      <p v-if="loading" role="status">Loading position details...</p>
      <form v-if="context" @submit.prevent="save">
        <dl class="position-context"><div><dt>Agency</dt><dd>{{ context.employee.AgencyName }}</dd></div><div><dt>Current position</dt><dd>{{ context.employee.PositionName }}</dd></div></dl>
        <div class="position-fields"><label>Effective date<input v-model="effectiveDate" type="date" :max="today()" :min="context.employee.DateHired || undefined" :disabled="loading || saving || !context.permissions.canEdit" required @change="load"></label><label>New position<select v-model="newPosition" :disabled="!canEdit" required><option disabled value="">Select position</option><option v-for="item in positions" :key="item.AgencyPositionID" :value="String(item.AgencyPositionID)">{{ item.PositionName }}</option></select></label></div>
        <p class="position-note">Choose today or an earlier effective date. Existing attendance or payroll from that date must be reviewed before changing position.</p>
        <template v-if="context.assignment"><p class="position-site"><strong>Same site:</strong> {{ context.assignment.ClientName }} — {{ context.assignment.SiteName }}</p><label>New position site rate<select v-model="siteRateId" :disabled="!canEdit || !newPosition" required><option disabled value="">Select site rate</option><option v-for="rate in rates" :key="rate.SiteRateID" :value="String(rate.SiteRateID)">{{ rate.PositionName }} · Site rate #{{ rate.SiteRateID }}</option></select></label><p v-if="newPosition && !rates.length" class="position-error">Set up an active payroll and billing rate for this position at the same site before saving.</p></template>
        <p v-else class="position-note">No fixed deployment covers this date. This change updates the agency position without assigning a site. Existing cutoff-only reliever assignments keep their recorded rates.</p>
        <label>Reason<textarea v-model.trim="reason" rows="3" minlength="5" maxlength="500" :disabled="!canEdit" placeholder="Promotion or reason for changing position" required></textarea></label>
        <button v-if="context.permissions.canEdit" class="position-save" type="submit" :disabled="!canSave">{{ saving ? 'Saving...' : 'Save position change' }}</button>
      </form>
      <section v-if="context" class="position-history"><h3>Position history</h3><p v-if="!context.history.length">No position changes recorded.</p><div v-else class="position-history-scroll"><table><thead><tr><th>Effective date</th><th>Position change</th><th>Reason</th><th>Recorded by</th></tr></thead><tbody><tr v-for="item in context.history" :key="item.PositionChangeID"><td>{{ item.EffectiveDate }}</td><td><strong>{{ item.OldPositionName }} → {{ item.NewPositionName }}</strong><small>{{ item.AgencyName }}</small></td><td>{{ item.Reason }}</td><td>{{ item.CreatedByName || 'Not recorded' }}<small>{{ item.CreatedAt }}</small></td></tr></tbody></table></div></section>
      <footer><button type="button" :disabled="saving" @click="emit('close')">Close</button></footer>
    </section>
  </div>
</template>

<style scoped>
.position-change-layer{position:fixed;inset:0;z-index:350;display:grid;place-items:center;padding:20px;background:#0f172a94}.position-change-modal{box-sizing:border-box;width:min(840px,100%);max-height:calc(100dvh - 40px);overflow:auto;padding:26px;border-radius:16px;background:#fff;color:#183352;box-shadow:0 24px 70px #0f172a40}.position-change-modal header{display:flex;justify-content:space-between;gap:20px}.position-change-modal header p{margin:0 0 7px;color:#3262d4;font-size:12px;font-weight:800;letter-spacing:.08em}.position-change-modal h2{margin:0 0 8px}.position-change-modal header span{color:#65768c}.position-change-modal button{min-height:38px;border:1px solid #cfd8e6;border-radius:8px;padding:8px 14px;background:#fff;color:#24446c;font:inherit;font-weight:700;cursor:pointer}.position-change-modal header button{align-self:flex-start;font-size:22px;border:0;padding:0 8px}.position-change-modal form{display:grid;gap:14px;margin-top:20px}.position-context{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:0;padding:14px;border-radius:10px;background:#f3f7fd}.position-context dt{color:#65768c;font-size:12px}.position-context dd{margin:5px 0 0;font-weight:700}.position-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}.position-change-modal label{display:grid;gap:7px;color:#50617a;font-size:13px;font-weight:700}.position-change-modal input,.position-change-modal select,.position-change-modal textarea{box-sizing:border-box;width:100%;min-height:42px;padding:9px 12px;border:1px solid #cbd8ea;border-radius:9px;background:#fff;color:#183352;font:inherit}.position-note{margin:0;color:#65768c;font-size:12px;line-height:1.5}.position-site{margin:0}.position-change-modal .position-save{justify-self:end;background:#285be3;color:#fff;border-color:#285be3}.position-change-modal button:disabled{opacity:.5;cursor:not-allowed}.position-history{margin-top:24px;border-top:1px solid #dce4ee;padding-top:8px}.position-history-scroll{overflow:auto;max-height:250px}.position-history table{width:100%;border-collapse:collapse;font-size:12px}.position-history th,.position-history td{padding:11px;text-align:left;vertical-align:top;border-bottom:1px solid #e1e8f1}.position-history th{background:#f4f7fc}.position-history small{display:block;margin-top:5px;color:#65768c}.position-error{color:#b42318}.position-success{padding:12px;border-radius:8px;background:#dcfce7;color:#166534}.position-change-modal footer{display:flex;justify-content:flex-end;margin-top:18px}@media(max-width:600px){.position-change-modal{padding:20px}.position-fields,.position-context{grid-template-columns:1fr}.position-history table{min-width:600px}}
</style>
