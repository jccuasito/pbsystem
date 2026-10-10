<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { payrollHourComponents, payrollTimeDeductions } from '~~/shared/utils/payrollPreview'

const props = defineProps<{ site: any; canReview: boolean; busy: boolean; error: string }>()
const emit = defineEmits<{
  (event: 'close'): void
  (event: 'approve'): void
  (event: 'reject', reason: string): void
  (event: 'cancel', reason: string): void
  (event: 'deduction', change: { action: 'skip' | 'restore'; employeeId: number; entryType: string; recordId: number; reason: string }): void
  (event: 'pause-plan', change: { entryType: string; recordId: number; startDate: string; resumeDate: string; reason: string }): void
}>()
const activeTab = ref<'amounts' | 'employees' | 'history'>('amounts')
const selectedEmployeeId = ref<number | null>(null)
const requestedAction = ref<'approve' | 'reject' | 'cancel' | null>(null)
const rejectionReason = ref('')
const skipKey = ref('')
const skipReason = ref('')
const pauseReason = ref('')
const pauseResumeDate = ref('')
const previouslyOverflow = ref('')
const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value || 0)
const moment = (value: string) => value ? new Date(value.replace(' ', 'T')).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : ''
const day = (value: string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const lines = computed(() => [...payrollHourComponents, ['BTRHours', 'RegularRate', 'BTR (regular rate)'] as const, ...payrollTimeDeductions].map(([code, , label]) => ({
  code, label, direction: ['LateHours', 'UndertimeHours', 'BreakHours'].includes(code) ? 'Deduction' : 'Earning',
  hours: props.site.employees.reduce((sum: number, employee: any) => sum + Number(employee.components.find((line: any) => line.code === code)?.hours || 0), 0),
  amount: props.site.employees.reduce((sum: number, employee: any) => sum + Number(employee.components.find((line: any) => line.code === code)?.amount || 0), 0),
})).filter(line => line.hours))
const accountDeductions = computed(() => props.site.employees.reduce((sum: number, employee: any) => sum + Number(employee.accountDeductions || 0), 0))
const adjustmentLines = computed(() => props.site.employees.flatMap((employee: any) => (employee.adjustments || []).map((line: any) => ({ ...line, employeeName: employee.EmployeeName }))))
const selectedEmployee = computed(() => props.site.employees.find((employee: any) => Number(employee.EmployeeID) === selectedEmployeeId.value) || null)
const earningLines = computed(() => selectedEmployee.value?.components.filter((line: any) => line.direction === 'Earning') || [])
const timeDeductionLines = computed(() => selectedEmployee.value?.components.filter((line: any) => line.direction === 'Deduction') || [])
const employeeAdjustments = computed(() => selectedEmployee.value?.adjustments || [])
const historyCycles = computed(() => {
  const cycles: { events: any[]; revision: number; status: string; date: string }[] = []
  for (const event of [...(props.site.history || [])].reverse()) {
    let cycle = cycles[cycles.length - 1]
    if (!cycle || (event.Action === 'Compute Payroll' && cycle.events.some(item => ['Compute Payroll', 'Approve Payroll', 'Reject Payroll', 'Cancel Payroll'].includes(item.Action)))) {
      cycle = { events: [], revision: cycles.length + 1, status: '', date: '' }
      cycles.push(cycle)
    }
    cycle.events.unshift(event)
  }
  for (const cycle of cycles) {
    const decision = cycle.events.find(event => ['Cancel Payroll', 'Approve Payroll', 'Reject Payroll'].includes(event.Action))
    cycle.status = decision?.Action === 'Cancel Payroll' ? 'Cancelled' : decision?.Action === 'Approve Payroll' ? 'Finalized' : decision?.Action === 'Reject Payroll' ? 'Returned' : 'In review'
    cycle.date = cycle.events[0]?.CreatedAt || ''
  }
  return cycles.reverse()
})
const returnedCount = computed(() => (props.site.history || []).filter((event: any) => event.Action === 'Reject Payroll').length)
const approvedCount = computed(() => (props.site.history || []).filter((event: any) => event.Action === 'Approve Payroll').length)
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') emit('close') }
onMounted(() => { previouslyOverflow.value = document.body.style.overflow; document.body.style.overflow = 'hidden'; window.addEventListener('keydown', onKeydown) })
onBeforeUnmount(() => { document.body.style.overflow = previouslyOverflow.value; window.removeEventListener('keydown', onKeydown) })
function submitAction() {
  if (requestedAction.value === 'approve') emit('approve')
  if (requestedAction.value === 'reject' && rejectionReason.value.trim().length >= 5) emit('reject', rejectionReason.value.trim())
  if (requestedAction.value === 'cancel' && rejectionReason.value.trim().length >= 5) emit('cancel', rejectionReason.value.trim())
}
function changeDeduction(item: any, action: 'skip' | 'restore') {
  if (!selectedEmployee.value) return
  emit('deduction', { action, employeeId: Number(selectedEmployee.value.EmployeeID), entryType: item.entryType, recordId: Number(item.recordId), reason: action === 'skip' ? skipReason.value.trim() : '' })
  skipKey.value = ''; skipReason.value = ''
}
function pausePlan(item: any) {
  emit('pause-plan', { entryType: item.entryType, recordId: Number(item.recordId), startDate: props.site.PeriodStart,
    resumeDate: pauseResumeDate.value, reason: pauseReason.value.trim() })
  skipKey.value = ''; pauseReason.value = ''; pauseResumeDate.value = ''
}
</script>

<template>
  <Teleport to="body">
    <div class="payroll-modal-backdrop" @click.self="emit('close')">
      <section class="payroll-modal" role="dialog" aria-modal="true" aria-labelledby="payroll-modal-title">
        <header class="modal-header">
          <div><p class="eyebrow">PAYROLL PROCESSING · DTR-{{ String(site.BatchID).padStart(4, '0') }}</p><h2 id="payroll-modal-title">{{ site.SiteName }}</h2><p>{{ site.ClientName }} · {{ site.AgencyName }} · {{ day(site.PeriodStart) }}–{{ day(site.PeriodEnd) }}</p></div>
          <button type="button" class="close-button" aria-label="Close payroll details" @click="emit('close')">×</button>
        </header>
        <div class="modal-body">
          <div class="context-row"><span class="review-chip" :class="String(site.ReviewStatus || 'Pending').toLowerCase()">{{ site.ReviewStatus === 'Approved' ? 'Payroll finalized' : site.ReviewStatus === 'Rejected' ? 'Returned to Draft' : site.ReviewStatus === 'Cancelled' ? 'Finalization cancelled' : 'Ready for review' }}</span><span>{{ site.peopleCount }} {{ site.peopleCount===1?'employee':'employees' }} · DTR status: {{ site.Status }}</span></div>
          <p v-if="site.ReviewStatus==='Approved'" class="info">Finalized payroll and posted deductions are saved. Later rate or account changes will not rewrite this cutoff.</p>
          <p v-else-if="site.ReviewStatus==='Rejected'" class="info">This review was rejected. Correct the Draft DTR, then compute it to payroll again for a new review.</p>
          <p v-else-if="site.ReviewStatus==='Cancelled'" class="info">This finalization was cancelled. The DTR is Draft again; correct it and compute it to payroll before finalizing.</p>
          <p v-else class="info">Review attendance, adjustments, and eligible fixed-site deductions. Finalize to post payroll and deduction receipts. Payslip release happens later.</p>
          <div v-if="site.warningCount" class="warning" role="alert">{{ site.warningCount }} payroll note{{ site.warningCount===1?'':'s' }} must be resolved before finalization. See Employees for details.</div>
          <p v-for="warning in site.siteWarnings || []" :key="warning" class="warning" role="alert">{{ warning }}</p>
          <div class="amount-summary"><div><span>Gross</span><strong>{{ money(site.gross) }}</strong></div><div><span>Deductions</span><strong>{{ money(site.deductions) }}</strong></div><div><span>Net for review</span><strong>{{ money(site.netPreview) }}</strong></div></div>
          <div class="modal-tabs" role="tablist" aria-label="Payroll details">
            <button v-for="tab in (['amounts','employees','history'] as const)" :key="tab" type="button" role="tab" :aria-selected="activeTab===tab" :class="{selected:activeTab===tab}" @click="activeTab=tab;selectedEmployeeId=null">{{ tab==='amounts'?'Hours & amounts':tab==='employees'?'Employees':'History' }}</button>
          </div>
          <div v-if="activeTab==='amounts'" class="tab-panel">
            <div class="section-heading"><h3>Site totals</h3><p>Amounts use the rate effective on each saved attendance date.</p></div>
            <div class="line-table-wrap"><table class="line-table"><thead><tr><th>Component</th><th>Hours</th><th>Type</th><th>Amount</th></tr></thead><tbody>
              <tr v-for="line in lines" :key="line.code"><td>{{ line.label }}</td><td>{{ line.hours.toFixed(2) }}</td><td>{{ line.direction }}</td><td>{{ money(line.amount) }}</td></tr>
              <tr v-for="line in adjustmentLines" :key="`adjustment-${line.lineId}`"><td>Adjustment #{{ line.adjustmentId }} · {{ line.employeeName }} · {{ line.description }}</td><td>{{ Number(line.hours).toFixed(2) }}</td><td>{{ line.direction }}</td><td>{{ money(line.amount) }}</td></tr>
              <tr v-if="!lines.length"><td colspan="4" class="empty">No payable attendance hours recorded.</td></tr>
              <tr class="total-line"><td colspan="3">Linked employee installments</td><td>{{ money(accountDeductions) }}</td></tr>
            </tbody></table></div>
            <p class="info">BTR: {{ site.btrEntryCount || 0 }} saved break-coverage entries · {{ Number(site.btrCoverageHours || 0).toFixed(2) }} hours. Reliever coverage is paid separately at the regular rate effective on each BTR date.</p>
          </div>
          <div v-else-if="activeTab==='employees'" class="tab-panel employee-list">
            <template v-if="!selectedEmployee">
              <div class="section-heading"><h3>Employee payroll breakdowns</h3><p>Select an employee to review the cutoff breakdown.</p></div>
              <button v-for="person in site.employees" :key="person.EmployeeID" type="button" class="employee-choice" @click="selectedEmployeeId=Number(person.EmployeeID)">
                <span class="employee-choice-name"><strong>{{ person.EmployeeName }}</strong><small>{{ person.EmployeeNumber || `Employee #${person.EmployeeID}` }} · {{ person.PositionName || 'Position unavailable' }}</small></span>
                <span class="employee-choice-amount"><strong>{{ money(person.netPreview) }}</strong><small>net preview</small></span><span class="employee-choice-arrow" aria-hidden="true">›</span>
              </button>
              <p v-if="!site.employees.length" class="muted">No employees are enrolled in this DTR.</p>
            </template>
            <div v-else class="payslip-view">
              <button type="button" class="payslip-back" @click="selectedEmployeeId=null">← Back to employees</button>
              <article class="payslip-preview" aria-label="Payslip preview">
                <header class="payslip-head"><div><p class="payslip-kicker">PAYSLIP PREVIEW · FOR REVIEW</p><h3>{{ site.AgencyName }}</h3><p>{{ site.SiteName }} · {{ site.ClientName }}</p></div><span class="payslip-period">{{ day(site.PeriodStart) }} – {{ day(site.PeriodEnd) }}</span></header>
                <div class="payslip-person"><div><span>Employee</span><strong>{{ selectedEmployee.EmployeeName }}</strong></div><div><span>Employee no.</span><strong>{{ selectedEmployee.EmployeeNumber || `#${selectedEmployee.EmployeeID}` }}</strong></div><div><span>Position</span><strong>{{ selectedEmployee.PositionName || 'Unavailable' }}</strong></div><div><span>DTR</span><strong>DTR-{{ String(site.BatchID).padStart(4, '0') }}</strong></div></div>
                <p class="info">{{ Number(selectedEmployee.IsPermanentSite) && selectedEmployee.AttendanceType !== 'Reliever' ? 'Fixed at this site: eligible active installments are included.' : 'Reliever at this site: loan and deduction installments are charged only at the fixed site.' }}</p><div class="payslip-columns">
                  <section class="payslip-section"><h4>Gross income</h4><div class="payslip-table-head"><span>Pay item</span><span>Hours</span><span>Amount</span></div><div v-for="line in earningLines" :key="line.code" class="payslip-line"><span>{{ line.label }}</span><span>{{ Number(line.hours).toFixed(2) }}</span><strong>{{ money(line.amount) }}</strong></div><div v-for="line in employeeAdjustments.filter((item: any) => item.direction === 'Earning')" :key="line.lineId" class="payslip-line"><span>Adjustment #{{ line.adjustmentId }} · {{ line.description }}</span><span>{{ Number(line.hours).toFixed(2) }}</span><strong>{{ money(line.amount) }}</strong></div><p v-if="!earningLines.length && !employeeAdjustments.some((item: any) => item.direction === 'Earning')" class="payslip-empty">No earnings recorded.</p><div class="payslip-subtotal"><span>Total earnings</span><strong>{{ money(selectedEmployee.gross) }}</strong></div></section>
                  <section class="payslip-section"><h4>Deductions</h4><div class="payslip-table-head payslip-deduction-head"><span>Deduction item</span><span>Amount</span></div><div v-for="line in timeDeductionLines" :key="line.code" class="payslip-line payslip-deduction-line"><span>{{ line.label }} <small>{{ Number(line.hours).toFixed(2) }} h</small></span><strong>{{ money(line.amount) }}</strong></div><div v-for="item in selectedEmployee.deductions" :key="`${item.entryType}-${item.recordId}`" class="payslip-line payslip-deduction-line"><span>{{ item.name }} <small>{{ item.entryType === 'Recurring' ? item.catalogKind === 'Contribution' ? 'Contribution · recurring' : 'Recurring deduction' : `${item.entryType} · balance ${money(item.remainingBalance)}` }}</small></span><strong>{{ money(item.amount) }}</strong></div><div v-for="line in employeeAdjustments.filter((item: any) => item.direction === 'Deduction')" :key="line.lineId" class="payslip-line payslip-deduction-line"><span>Adjustment #{{ line.adjustmentId }} · {{ line.description }}</span><strong>{{ money(line.amount) }}</strong></div><p v-if="!timeDeductionLines.length && !selectedEmployee.deductions.length && !employeeAdjustments.some((item: any) => item.direction === 'Deduction')" class="payslip-empty">No linked deductions due.</p><div class="payslip-subtotal"><span>Total deductions</span><strong>{{ money(Number(selectedEmployee.timeDeductions || 0) + Number(selectedEmployee.accountDeductions || 0)) }}</strong></div></section>
                </div>
                <section v-if="(selectedEmployee.dueDeductions || []).length" class="cutoff-controls">
                  <h4>Deduction controls</h4>
                  <p>Skip affects this cutoff only. Pause affects the plan from this cutoff onward until its resume date or manual resume.</p>
                  <div v-for="item in selectedEmployee.dueDeductions" :key="`${item.entryType}-${item.recordId}`" class="cutoff-control">
                    <div><strong>{{ item.name }}</strong><small>{{ item.entryType === 'Recurring' ? item.catalogKind === 'Contribution' ? 'Contribution' : 'Recurring deduction' : item.entryType }} · {{ money(item.amount) }}</small><small v-if="item.override" class="skip-note">Skipped by {{ item.override.CreatedByName }}: {{ item.override.Reason }}</small></div>
                    <span v-if="!canReview || site.ReviewStatus !== 'Pending'" class="skip-state">{{ item.override ? 'Skipped' : 'Included' }}</span>
                    <div v-else class="cutoff-buttons">
                      <button v-if="item.override" type="button" :disabled="busy" @click="changeDeduction(item,'restore')">Restore</button>
                      <button v-else type="button" :disabled="busy" @click="skipKey=`${item.entryType}-${item.recordId}`;skipReason=''">Skip cutoff</button>
                      <button type="button" :disabled="busy" @click="skipKey=`pause-${item.entryType}-${item.recordId}`;pauseReason='';pauseResumeDate=''">Pause plan</button>
                    </div>
                    <div v-if="skipKey === `${item.entryType}-${item.recordId}`" class="skip-editor"><label>Reason<input v-model="skipReason" maxlength="500" placeholder="Why skip this deduction?" /></label><button type="button" :disabled="busy || skipReason.trim().length < 5" @click="changeDeduction(item,'skip')">Confirm skip</button><button type="button" @click="skipKey=''">Back</button></div>
                    <div v-if="skipKey === `pause-${item.entryType}-${item.recordId}`" class="skip-editor"><label>Reason<input v-model="pauseReason" maxlength="255" placeholder="Why pause this plan?" /></label><label>Resume date (optional)<input v-model="pauseResumeDate" type="date" :min="site.PeriodStart" /></label><button type="button" :disabled="busy || pauseReason.trim().length < 5" @click="pausePlan(item)">Confirm pause</button><button type="button" @click="skipKey=''">Back</button></div>
                  </div>
                </section>
                <div class="payslip-total"><span>Net preview <small>Gross income less included deductions</small></span><strong>{{ money(selectedEmployee.netPreview) }}</strong></div>
                <p class="payslip-caveat">Review before finalizing. Configured recurring contributions and approved adjustments are included. Payslip release is separate.</p>
                <div v-for="warning in selectedEmployee.warnings" :key="warning" class="warning payslip-warning">{{ warning }}</div>
              </article>
            </div>
          </div>
          <div v-else class="tab-panel history-panel">
            <div class="section-heading"><h3>Workflow history</h3><p>Newest revision first. Open an earlier revision to see its actions.</p></div>
            <section v-if="site.deductionHistory?.length" class="deduction-history"><h4>Cutoff deduction changes</h4><article v-for="item in site.deductionHistory" :key="item.OverrideID"><strong>{{ item.RemovedAt ? 'Restored' : 'Skipped' }} · {{ item.ItemName || `${item.EntryType} #${item.SourceRecordID}` }}</strong><span>{{ item.EmployeeName }} · {{ item.CreatedByName }} skipped on {{ moment(item.CreatedAt) }}</span><small>Reason: {{ item.Reason }}</small><small v-if="item.RemovedAt">Restored by {{ item.RemovedByName }} on {{ moment(item.RemovedAt) }}</small></article></section>
            <div v-if="historyCycles.length" class="history-overview" aria-label="Workflow totals"><span><strong>{{ historyCycles.length }}</strong> revision{{ historyCycles.length===1?'':'s' }}</span><span><strong>{{ returnedCount }}</strong> returned</span><span><strong>{{ approvedCount }}</strong> finalized</span><span><strong>{{ (site.history || []).filter((event: any) => event.Action === 'Cancel Payroll').length }}</strong> cancelled</span></div>
            <div v-if="historyCycles.length" class="history-scroll" tabindex="0" aria-label="Scrollable workflow revisions">
              <details v-for="(cycle, index) in historyCycles" :key="cycle.revision" class="history-cycle" :open="index===0">
                <summary><span class="cycle-heading"><strong>Revision {{ cycle.revision }}</strong><small>{{ moment(cycle.date) }}</small></span><span class="cycle-status" :class="cycle.status.toLowerCase().replace(' ', '-')">{{ cycle.status }}</span><span class="cycle-count">{{ cycle.events.length }} action{{ cycle.events.length===1?'':'s' }}</span><span class="cycle-chevron" aria-hidden="true">⌄</span></summary>
                <ol class="history-timeline">
                  <li v-for="event in cycle.events" :key="event.EventID" class="history-event" :class="event.Action.toLowerCase().replace(' ', '-')">
                    <span class="history-dot" aria-hidden="true"></span>
                    <div class="history-event-content"><div class="history-event-head"><strong>{{ event.Action }}</strong><time>{{ moment(event.CreatedAt) }}</time></div>
                      <p class="history-actor">{{ event.ActorName }} <span v-if="event.ActorRole || event.ActorDepartment">· {{ [event.ActorRole, event.ActorDepartment].filter(Boolean).join(' · ') }}</span></p>
                      <p v-if="event.Reason" class="history-reason">{{ event.Reason }}</p>
                      <small v-if="event.PreviousDtrStatus!==event.NextDtrStatus" class="history-transition">{{ event.PreviousDtrStatus }} → {{ event.NextDtrStatus }}</small>
                    </div>
                  </li>
                </ol>
              </details>
            </div>
            <p v-else class="muted">This DTR was computed before workflow history tracking started. The original actor and time are unavailable.</p>
          </div>
          <div v-if="requestedAction" class="action-confirmation">
            <template v-if="requestedAction==='approve'"><strong>Finalize this DTR payroll?</strong><p>This posts employee payroll records, eligible account installments, and approved adjustments with your name and time. This does not release payslips.</p></template>
            <template v-else-if="requestedAction==='cancel'"><strong>Cancel this finalized payroll?</strong><p>Approved payroll records and deduction receipts will be voided, installment balances restored, and applied adjustments reopened. The DTR returns to Draft. Released or subsequently changed payroll cannot be cancelled here.</p><label>Reason for cancellation<textarea v-model="rejectionReason" rows="3" maxlength="500" placeholder="Explain why this finalization must be cancelled"></textarea></label></template>
            <template v-else><strong>Return this DTR to Draft?</strong><p>Payroll approval and billing compute status, if any, will be invalidated. The history remains visible.</p><label>Reason for rejection<textarea v-model="rejectionReason" rows="3" maxlength="500" placeholder="Explain what needs correction"></textarea></label></template>
            <p v-if="error" class="error" role="alert">{{ error }}</p>
            <div class="confirm-actions"><button type="button" class="secondary" :disabled="busy" @click="requestedAction=null">{{ requestedAction==='cancel'?'Keep payroll':'Back' }}</button><button type="button" :class="requestedAction==='approve'?'primary':'danger'" :disabled="busy || (requestedAction!=='approve' && rejectionReason.trim().length<5)" @click="submitAction">{{ busy?'Saving…':requestedAction==='approve'?'Finalize payroll':requestedAction==='cancel'?'Cancel finalization':'Reject and return to Draft' }}</button></div>
          </div>
        </div>
        <footer class="modal-footer"><button type="button" class="secondary" @click="emit('close')">Close</button><button v-if="canReview && site.ReviewStatus==='Approved'" type="button" class="danger-outline" :disabled="busy" @click="requestedAction='cancel';rejectionReason='';activeTab='amounts'">Cancel finalization</button><template v-if="canReview && site.ReviewStatus==='Pending'"><button type="button" class="danger-outline" :disabled="busy" @click="requestedAction='reject';rejectionReason='';activeTab='amounts'">Reject</button><button type="button" class="primary" :disabled="busy || !!site.warningCount" @click="requestedAction='approve'">Finalize payroll</button></template></footer>
      </section>
    </div>
  </Teleport>
</template>
