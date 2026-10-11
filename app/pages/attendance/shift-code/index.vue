<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import ModernTimeField from '~~/components/ModernTimeField.vue'

const items = ref<any[]>([])
const agencies = ref<any[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const modalOpen = ref(false)
const editing = ref<any | null>(null)
const confirmation = ref<{ kind: 'deactivate' | 'delete'; item: any } | null>(null)
const confirmBusy = ref(false)
const confirmError = ref('')
const searchText = ref('')
const appliedSearch = ref('')
const agencyFilter = ref('')
const shiftTypeFilter = ref('')
const form = ref<Record<string, any>>({})

const filteredItems = computed(() => {
  const query = appliedSearch.value.trim().toLowerCase()
  return items.value.filter((item) => {
    const matchesAgency = !agencyFilter.value || String(item.AgencyID) === agencyFilter.value
    const matchesType = !shiftTypeFilter.value || item.ShiftType === shiftTypeFilter.value
    const matchesSearch = !query || [item.ShiftCode, item.ShiftName].some((value) => String(value || '').toLowerCase().includes(query))
    return matchesAgency && matchesType && matchesSearch
  })
})

function resetForm(item: any = null) {
  editing.value = item
  form.value = {
    AgencyID: item?.AgencyID ? String(item.AgencyID) : '',
    ShiftCode: item?.ShiftCode || '',
    ShiftName: item?.ShiftName || '',
    ShiftType: item?.ShiftType || 'DS',
    TimeIn: item?.TimeIn ? String(item.TimeIn).slice(0, 5) : (item?.ShiftType === 'Flexible' ? '' : '08:00'),
    TimeOut: item?.TimeOut ? String(item.TimeOut).slice(0, 5) : (item?.ShiftType === 'Flexible' ? '' : '17:00'),
    RegularHours: item?.RegularHours ?? '8',
    RegularOTCap: item?.RegularOTCap ?? '4',
    WorkdayCount: item?.WorkdayCount ?? (item?.ShiftType === 'SS' ? '2' : '1'),
    NDEnabled: Number(item?.NDEnabled) ? '1' : '0',
    NDStartTime: item?.NDStartTime ? String(item.NDStartTime).slice(0, 5) : '',
    NDEndTime: item?.NDEndTime ? String(item.NDEndTime).slice(0, 5) : '',
    Status: item?.Status || 'Active'
  }
  error.value = ''
}

function add() {
  resetForm()
  modalOpen.value = true
}

function edit(item: any) {
  resetForm(item)
  modalOpen.value = true
}

function closeShiftModal() {
  if (!busy.value) modalOpen.value = false
}

function closeConfirmation() {
  if (confirmBusy.value) return
  confirmation.value = null
  confirmError.value = ''
}

function onShiftTypeChange() {
  if (form.value.ShiftType === 'Flexible') { form.value.TimeIn = ''; form.value.TimeOut = '' }
}

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    const response: any = await $fetch('/api/organization/shift-code')
    items.value = response.items || []
    agencies.value = response.agencies || []
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to load shift codes.'
  } finally {
    if (!silent) loading.value = false
  }
}

async function save() {
  busy.value = true
  error.value = ''
  try {
    const body = editing.value ? { id: editing.value.ShiftCodeID, ...form.value } : form.value
    await $fetch('/api/organization/shift-code', { method: editing.value ? 'PUT' : 'POST', body })
    modalOpen.value = false
    await load()
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to save shift code.'
  } finally {
    busy.value = false
  }
}

function deactivate(item: any) {
  confirmError.value = ''
  confirmation.value = { kind: 'deactivate', item }
}

function remove(item: any) {
  confirmError.value = ''
  confirmation.value = { kind: 'delete', item }
}

async function confirmAction() {
  const request = confirmation.value
  if (!request || confirmBusy.value) return
  confirmBusy.value = true
  confirmError.value = ''
  try {
    await $fetch('/api/organization/shift-code', {
      method: 'DELETE',
      body: { id: request.item.ShiftCodeID, ...(request.kind === 'delete' ? { permanent: true } : {}) }
    })
    confirmation.value = null
    await load()
  } catch (cause: any) {
    confirmError.value = cause.data?.statusMessage || (request.kind === 'delete' ? 'Unable to delete shift code.' : 'Unable to deactivate shift code.')
  } finally {
    confirmBusy.value = false
  }
}

function displayTime(value: unknown) {
  return value ? String(value).slice(0, 5) : '—'
}

onMounted(load)
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !busy.value && !modalOpen.value && !confirmation.value && !confirmBusy.value })
</script>

<template>
  <main class="shift-page">
    <header class="page-head">
      <div><p>ATTENDANCE</p><h1>Shift Codes</h1><span>Define work schedules per agency.</span></div>
      <button class="primary" @click="add">+ Add shift code</button>
    </header>

    <form class="filters" @submit.prevent="appliedSearch = searchText">
      <label>Search shift code or name
        <input v-model="searchText" placeholder="e.g. DS0700 or day shift" />
      </label>
      <label>Agency
        <select v-model="agencyFilter">
          <option value="">All agencies</option>
          <option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option>
        </select>
      </label>
      <label>Shift type
        <select v-model="shiftTypeFilter"><option value="">All types</option><option value="DS">DS — Day Shift</option><option value="NS">NS — Night Shift</option><option value="MS">MS — Mid Shift</option><option value="SS">SS — Straight Shift</option><option>Flexible</option></select>
      </label>
      <button class="secondary" type="submit">Search</button>
    </form>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Shift code</th><th>Shift name</th><th>Agency</th><th>Type</th><th>Time in</th><th>Time out</th><th>Regular hrs</th><th>OT cap</th><th>ND window</th><th>Status</th><th class="actions-head">Actions</th></tr></thead>
        <tbody>
          <tr v-if="loading"><td colspan="11">Loading…</td></tr>
          <tr v-else-if="!filteredItems.length"><td colspan="11">No shift codes found.</td></tr>
          <tr v-for="item in filteredItems" :key="item.ShiftCodeID">
            <td class="code" :title="item.ShiftCode">{{ item.ShiftCode }}</td><td>{{ item.ShiftName }}</td><td>{{ item.AgencyName }}</td><td>{{ item.ShiftType }}</td><td>{{ displayTime(item.TimeIn) }}</td><td>{{ displayTime(item.TimeOut) }}</td><td>{{ item.RegularHours }}</td><td>{{ item.RegularOTCap }}</td>
            <td>{{ Number(item.NDEnabled) ? `${displayTime(item.NDStartTime)}–${displayTime(item.NDEndTime)}` : 'Disabled' }}</td>
            <td><span class="status" :class="`status--${String(item.Status).toLowerCase()}`">{{ item.Status }}</span></td>
            <td class="actions-cell"><div class="actions">
              <button type="button" class="icon-action" :title="`Edit ${item.ShiftCode}`" :aria-label="`Edit ${item.ShiftCode}`" @click="edit(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
              <button type="button" class="icon-action" :disabled="item.Status === 'Inactive'" :title="item.Status === 'Inactive' ? 'Already inactive' : `Deactivate ${item.ShiftCode}`" :aria-label="`Deactivate ${item.ShiftCode}`" @click="deactivate(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 8.5 7 7"/></svg></button>
              <button type="button" class="icon-action delete" :title="`Delete ${item.ShiftCode}`" :aria-label="`Delete ${item.ShiftCode}`" @click="remove(item)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg></button>
            </div></td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="modalOpen" class="backdrop" @click.self="closeShiftModal">
        <form class="modal shift-modal" role="dialog" aria-modal="true" aria-labelledby="shift-modal-title" @submit.prevent="save">
          <header class="shift-modal__head">
            <div><p class="eyebrow">ATTENDANCE · SHIFT CODES</p><h2 id="shift-modal-title">{{ editing ? 'Edit shift code' : 'Add shift code' }}</h2><p>{{ editing ? `Update ${editing.ShiftCode} and its schedule.` : 'Set up a work schedule for an agency.' }}</p></div>
            <button class="close" type="button" aria-label="Close shift code form" :disabled="busy" @click="closeShiftModal">×</button>
          </header>
          <div class="shift-modal__body">
            <section class="form-section">
              <div class="form-section__heading"><div><span>SHIFT INFORMATION</span><h3>Code and agency</h3></div></div>
              <label>Agency<select v-model="form.AgencyID" required><option value="">Select agency</option><option v-for="agency in agencies" :key="agency.AgencyID" :value="String(agency.AgencyID)">{{ agency.AgencyName }}</option></select></label>
              <div class="grid"><label>Shift code<input v-model.trim="form.ShiftCode" maxlength="20" placeholder="e.g. DS0700-1900" required /></label><label>Shift name<input v-model.trim="form.ShiftName" maxlength="100" placeholder="e.g. Day duty 7 AM–7 PM" required /></label></div>
              <div class="grid"><label>Shift type<select v-model="form.ShiftType" required @change="onShiftTypeChange"><option value="DS">DS — Day Shift</option><option value="NS">NS — Night Shift</option><option value="MS">MS — Mid Shift</option><option value="SS">SS — Straight Shift</option><option>Flexible</option></select></label><label>Status<select v-model="form.Status" required><option>Active</option><option>Inactive</option></select></label></div>
            </section>
            <section class="form-section">
              <div class="form-section__heading"><div><span>WORK SCHEDULE</span><h3>Time and payable hours</h3></div></div>
              <div class="grid"><ModernTimeField v-model="form.TimeIn" :label="form.ShiftType === 'Flexible' ? 'Default time in (optional)' : 'Time in'" :required="form.ShiftType !== 'Flexible'" /><ModernTimeField v-model="form.TimeOut" :label="form.ShiftType === 'Flexible' ? 'Default time out (optional)' : 'Time out'" :required="form.ShiftType !== 'Flexible'" align="end" /></div>
              <div class="grid"><label>Regular hours<input v-model="form.RegularHours" type="number" min="0" max="24" step="0.25" required /></label><label>Regular OT cap<input v-model="form.RegularOTCap" type="number" min="0" max="24" step="0.25" required /></label></div>
              <label>Payable DTR days<input v-model="form.WorkdayCount" type="number" min="1" max="31" step="1" required /></label>
              <p class="form-note">Flexible shifts can leave default times blank. Their hours come from biometric Time In/Out; hours below Regular Hours are treated as OT only.</p>
            </section>
            <section class="form-section">
              <div class="form-section__heading"><div><span>PAY SETTINGS</span><h3>Night differential</h3></div></div>
              <label>Night differential<select v-model="form.NDEnabled"><option value="0">Disabled</option><option value="1">Enabled for this shift code</option></select></label>
              <div v-if="form.NDEnabled === '1'" class="grid"><ModernTimeField v-model="form.NDStartTime" label="ND start time" required /><ModernTimeField v-model="form.NDEndTime" label="ND end time" required align="end" /></div>
              <p class="form-note">ND hours use actual Time In/Out and this shift code's ND window.</p>
            </section>
            <p v-if="error" class="error modal-error" role="alert">{{ error }}</p>
          </div>
          <footer class="shift-modal__foot"><button class="secondary" type="button" :disabled="busy" @click="closeShiftModal">Cancel</button><button class="primary" type="submit" :disabled="busy">{{ busy ? 'Saving…' : editing ? 'Save changes' : 'Save shift code' }}</button></footer>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="confirmation" class="backdrop" @click.self="closeConfirmation">
        <section class="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="shift-confirm-title" aria-describedby="shift-confirm-message">
          <div class="confirm-modal__icon" aria-hidden="true">!</div>
          <h2 id="shift-confirm-title">{{ confirmation.kind === 'delete' ? 'Delete shift code?' : 'Deactivate shift code?' }}</h2>
          <p id="shift-confirm-message"><strong>{{ confirmation.item.ShiftCode }}</strong>{{ confirmation.kind === 'delete' ? ' will be permanently deleted. This cannot be undone.' : ' will be marked inactive.' }}</p>
          <p v-if="confirmError" class="error" role="alert">{{ confirmError }}</p>
          <footer><button type="button" class="secondary" :disabled="confirmBusy" @click="closeConfirmation">Cancel</button><button type="button" :class="confirmation.kind === 'delete' ? 'danger' : 'primary'" :disabled="confirmBusy" @click="confirmAction">{{ confirmBusy ? 'Working…' : confirmation.kind === 'delete' ? 'Delete permanently' : 'Deactivate' }}</button></footer>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.shift-page{padding:32px;max-width:1450px;margin:auto;color:#162033;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:24px}.page-head p{margin:0;color:#5271a5;font-size:.75rem;letter-spacing:.08em;font-weight:800}.page-head h1{margin:4px 0;font-size:1.8rem}.page-head span{color:#64748b}.primary,.secondary{border:0;border-radius:9px;padding:10px 14px;font-weight:700;cursor:pointer}.primary{background:#2349e6;color:#fff}.secondary{background:#edf2ff;color:#2349c9}.filters{display:flex;align-items:end;gap:14px;flex-wrap:wrap;margin-bottom:16px}.filters label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#56657b}.filters input,.filters select{min-height:40px;min-width:220px;border:1px solid #ccd5e4;border-radius:8px;padding:8px 10px;background:#fff;font:inherit}.table-wrap{overflow:auto;border:1px solid #dce3ee;border-radius:14px;background:#fff}table{width:100%;border-collapse:collapse}th,td{padding:13px 14px;text-align:left;border-bottom:1px solid #edf1f6;font-size:.88rem;white-space:nowrap}th{background:#f8fafc;color:#526174;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}.code{font-weight:800;color:#1f3fcf}.status{padding:3px 8px;border-radius:999px;font-size:.74rem;font-weight:700}.status--active{background:#dcfce7;color:#166534}.status--inactive{background:#fee2e2;color:#991b1b}.actions{display:flex;gap:8px}.actions button,footer button{border:1px solid #cfd8e6;border-radius:7px;padding:7px 10px;background:#fff;font-weight:700;cursor:pointer}.actions .delete{border-color:#fecaca;color:#b42318}.actions button:disabled{opacity:.5;cursor:not-allowed}.error{color:#b42318;margin:0 0 12px}.backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px}.modal{position:relative;width:min(100%,700px);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;padding:26px;display:grid;gap:12px}.modal h2{margin:0 0 4px}.modal label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#475569}.modal input,.modal select{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #cfd8e6;border-radius:8px;padding:9px 10px;font:inherit}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.hint{margin:0;padding:10px 12px;background:#eff6ff;border-radius:8px;color:#335884;font-size:.84rem}.close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.5rem;cursor:pointer}.modal footer{display:flex;justify-content:flex-end;gap:10px;margin-top:5px}@media(max-width:700px){.shift-page{padding:20px}.page-head,.filters{flex-direction:column;align-items:stretch}.filters input,.filters select,.primary,.secondary{width:100%;min-width:0}.grid{grid-template-columns:1fr}}
.shift-page{max-width:none;padding:34px 36px 48px;color:#112b53}
.table-wrap{max-width:100%;overflow-x:auto;border-color:#d5e1f2}
.table-wrap table{width:100%;min-width:1180px;table-layout:fixed}
.table-wrap th,.table-wrap td{padding:12px 9px;white-space:normal;vertical-align:middle;border-bottom-color:#e5edf8}
.table-wrap th{background:#f3f7fc;color:#526c92;font-size:.69rem;line-height:1.35}
.table-wrap td{font-size:.8rem;line-height:1.35;overflow-wrap:anywhere}
.table-wrap th:nth-child(1){width:11%}.table-wrap th:nth-child(2){width:14%}.table-wrap th:nth-child(3){width:19%}.table-wrap th:nth-child(4){width:5%}.table-wrap th:nth-child(5),.table-wrap th:nth-child(6){width:6%}.table-wrap th:nth-child(7){width:7%}.table-wrap th:nth-child(8){width:6%}.table-wrap th:nth-child(9){width:11%}.table-wrap th:nth-child(10){width:7%}
.table-wrap th.actions-head{position:sticky;right:0;z-index:2;width:136px;min-width:136px;text-align:center;box-shadow:-8px 0 14px -14px #294773}
.table-wrap td.actions-cell{position:sticky;right:0;z-index:1;width:136px;min-width:136px;padding-left:4px;padding-right:4px;background:#fff;box-shadow:-8px 0 14px -14px #294773}
.table-wrap td.code{color:#2054c5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal}
.actions{display:flex;align-items:center;justify-content:center;gap:5px;width:100%}
.actions .icon-action{box-sizing:border-box;display:grid;place-items:center;flex:none;width:36px;height:36px;padding:0;border:1px solid #c8d7ed;border-radius:9px;background:#fff;color:#1b4b91;cursor:pointer}
.actions .icon-action:hover:not(:disabled){background:#edf3ff;border-color:#9db8ed}
.actions .icon-action.delete{border-color:#f1cccc;color:#bd3737}
.actions .icon-action.delete:hover:not(:disabled){background:#fff2f2;border-color:#eaa9a9}
.actions .icon-action:focus-visible{outline:2px solid #2864e8;outline-offset:2px}
.actions .icon-action svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.actions .icon-action:disabled{opacity:.4;cursor:not-allowed}
@media(max-width:700px){.shift-page{padding:20px 16px}.table-wrap table{min-width:1180px}}
.backdrop{background:rgba(20,36,64,.55);font-family:Inter,'Segoe UI',sans-serif;color:#112b53}
.shift-modal{box-sizing:border-box;display:flex;flex-direction:column;gap:0;width:min(100%,900px);max-height:calc(100vh - 48px);padding:0;overflow:hidden;border:1px solid #d5e1f2;border-radius:20px;background:#f7f9fc;box-shadow:0 25px 75px rgba(9,31,75,.28);font-family:Inter,'Segoe UI',sans-serif}
.shift-modal__head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex:none;padding:26px 30px 21px;border-bottom:1px solid #d5e1f2;background:#fff}
.shift-modal__head .eyebrow{margin:0;color:#2863db;font-size:.72rem;font-weight:850;letter-spacing:.09em}
.shift-modal__head h2{margin:6px 0 5px;color:#112b53;font-size:1.65rem;line-height:1.2}
.shift-modal__head p:not(.eyebrow){margin:0;color:#657d9f;font-size:.85rem}
.shift-modal .close{position:static;display:grid;place-items:center;flex:none;width:38px;height:38px;margin:-6px -6px 0 0;border:0;border-radius:9px;background:transparent;color:#48648d;font:inherit;font-size:1.6rem;line-height:1;cursor:pointer}
.shift-modal .close:hover:not(:disabled){background:#edf3fc}
.shift-modal__body{display:grid;gap:15px;min-height:0;padding:20px 30px 24px;overflow:auto}
.form-section{display:grid;gap:14px;padding:19px;border:1px solid #dce4ef;border-radius:14px;background:#fff;box-shadow:0 4px 14px rgba(30,54,85,.035)}
.form-section__heading{padding-bottom:11px;border-bottom:1px solid #edf1f6}
.form-section__heading span{color:#3767ba;font-size:.68rem;font-weight:900;letter-spacing:.09em}
.form-section__heading h3{margin:3px 0 0;color:#1d304d;font-size:1rem}
.shift-modal label{display:grid;gap:7px;color:#3b5478;font-size:.78rem;font-weight:750}
.shift-modal input,.shift-modal select{box-sizing:border-box;width:100%;min-height:47px;padding:9px 12px;border:1px solid #cbd9ee;border-radius:9px;background:#fff;color:#112b53;font:inherit;font-size:.85rem}
.shift-modal input:focus,.shift-modal select:focus{outline:2px solid #a4beff;outline-offset:1px}
.shift-modal .grid{gap:14px}
.form-note{margin:0;padding:11px 13px;border-radius:9px;background:#eef4ff;color:#315486;font-size:.77rem;line-height:1.5}
.shift-modal__foot{display:flex;justify-content:flex-end;gap:10px;flex:none;margin:0!important;padding:15px 30px;border-top:1px solid #d5e1f2;background:#fff}
.shift-modal__foot button,.confirm-modal footer button{min-height:43px;padding:0 16px;border-radius:9px;font:inherit;font-size:.81rem;font-weight:750;cursor:pointer}
.shift-modal__foot .secondary,.confirm-modal footer .secondary{border:1px solid #c8d7ed;background:#fff;color:#1b4b91}
.shift-modal__foot .primary,.confirm-modal footer .primary{border:1px solid #2864e8;background:#2864e8;color:#fff}
.shift-modal__foot button:disabled,.confirm-modal footer button:disabled{opacity:.5;cursor:default}
.modal-error{margin:0;padding:11px 13px;border:1px solid #fecaca;border-radius:8px;background:#fff1f1;font-size:.79rem}
.confirm-modal{box-sizing:border-box;display:grid;justify-items:center;gap:12px;width:min(100%,520px);padding:30px;border:1px solid #d5e1f2;border-radius:18px;background:#fff;box-shadow:0 25px 75px rgba(9,31,75,.28);text-align:center;font-family:Inter,'Segoe UI',sans-serif}
.confirm-modal__icon{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:#fff0e8;color:#bd5b1c;font-size:1.4rem;font-weight:850}
.confirm-modal h2{margin:0;color:#112b53;font-size:1.35rem}.confirm-modal p{margin:0;color:#526986;font-size:.86rem;line-height:1.5}
.confirm-modal p strong{color:#112b53}.confirm-modal .error{width:100%;box-sizing:border-box;padding:11px 13px;border:1px solid #fecaca;border-radius:8px;background:#fff1f1;color:#9c2525;text-align:left}
.confirm-modal footer{display:flex;justify-content:flex-end;gap:10px;width:100%;margin-top:10px}
.confirm-modal footer .danger{border:1px solid #c73b3b;background:#c73b3b;color:#fff}
@media(max-width:700px){.shift-modal{width:100%;height:100vh;max-height:100vh;border-radius:0}.backdrop{padding:0}.shift-modal__head,.shift-modal__body,.shift-modal__foot{padding-left:18px;padding-right:18px}.shift-modal .grid{grid-template-columns:1fr}.confirm-modal{width:calc(100% - 32px);margin:16px}.confirm-modal footer{flex-wrap:wrap}.confirm-modal footer button{flex:1}}
</style>
