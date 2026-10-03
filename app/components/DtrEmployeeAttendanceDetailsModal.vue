<script setup lang="ts">
type EmployeeRecord = {
  EmployeeID: number
  EmployeeName?: string
  EmployeeNumber?: string | null
  PositionName?: string | null
  DeploymentType?: string | null
}

type AttendanceRecord = {
  EmployeeID: number
  AttendanceDate?: string | null
  AttendanceStatus?: string | null
  ShiftType?: string | null
  ShiftCode?: string | null
  TimeIn?: string | null
  TimeOut?: string | null
}

type DetailsData = {
  item: {
    BatchID: number
    ClientName: string
    SiteName: string
    PeriodStart: string
    PeriodEnd: string
    Status: string
  }
  records?: EmployeeRecord[]
  attendanceRows?: AttendanceRecord[]
}

const props = defineProps<{ data: DetailsData }>()
const emit = defineEmits<{ close: [] }>()
const selectedEmployeeId = ref<number | null>(null)

const employees = computed(() => {
  const rows = new Map<number, EmployeeRecord>()
  for (const employee of props.data.records || []) rows.set(Number(employee.EmployeeID), employee)
  for (const attendance of props.data.attendanceRows || []) {
    const id = Number(attendance.EmployeeID)
    if (!rows.has(id)) rows.set(id, { EmployeeID: id, EmployeeName: `Employee ${id}` })
  }
  return [...rows.values()].sort((a, b) => String(a.EmployeeName || '').localeCompare(String(b.EmployeeName || '')))
})

watch(employees, (rows) => {
  if (!rows.some(row => Number(row.EmployeeID) === selectedEmployeeId.value)) selectedEmployeeId.value = rows[0]?.EmployeeID ?? null
}, { immediate: true })

const selectedEmployee = computed(() => employees.value.find(row => Number(row.EmployeeID) === selectedEmployeeId.value) || null)
const attendance = computed(() => (props.data.attendanceRows || [])
  .filter(row => Number(row.EmployeeID) === selectedEmployeeId.value)
  .sort((a, b) => datePart(a.AttendanceDate).localeCompare(datePart(b.AttendanceDate))))

function datePart(value: unknown) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] || ''
}

function formatDate(value: unknown) {
  const date = datePart(value)
  if (!date) return '—'
  const parsed = new Date(`${date}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(value: unknown) {
  const match = String(value || '').match(/[T\s](\d{2}):(\d{2})/)
  if (!match) return '—'
  const hour = Number(match[1])
  const minute = match[2]
  if (!Number.isFinite(hour)) return '—'
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`
}

function statusClass(value: unknown) {
  const status = String(value || '').toLowerCase()
  if (status.includes('present')) return 'is-present'
  if (status.includes('late')) return 'is-late'
  if (status.includes('absent')) return 'is-absent'
  if (status.includes('leave')) return 'is-leave'
  if (status.includes('rest')) return 'is-rest'
  if (status.includes('holiday')) return 'is-holiday'
  return 'is-neutral'
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="attendance-details-layer" @click.self="emit('close')">
      <section class="attendance-details-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-details-title">
        <header class="attendance-details-header">
          <div>
            <p class="attendance-details-eyebrow">READ-ONLY ATTENDANCE</p>
            <h2 id="attendance-details-title">Employee Attendance Details</h2>
            <p>{{ data.item.ClientName }} · {{ data.item.SiteName }} · {{ formatDate(data.item.PeriodStart) }}–{{ formatDate(data.item.PeriodEnd) }}</p>
          </div>
          <div class="attendance-details-header-actions">
            <span class="attendance-details-batch">DTR-{{ String(data.item.BatchID).padStart(4, '0') }}</span>
            <button type="button" class="attendance-details-close" aria-label="Close attendance details" @click="emit('close')">×</button>
          </div>
        </header>

        <div class="attendance-details-content">
          <div class="attendance-details-picker">
            <label>
              <span>Employee</span>
              <select v-model.number="selectedEmployeeId" :disabled="!employees.length">
                <option v-for="employee in employees" :key="employee.EmployeeID" :value="employee.EmployeeID">
                  {{ employee.EmployeeName }}{{ employee.EmployeeNumber ? ` · ${employee.EmployeeNumber}` : '' }}
                </option>
              </select>
            </label>
            <p><strong>Viewing only.</strong> Attendance changes are made through Edit DTR.</p>
          </div>

          <div v-if="selectedEmployee" class="attendance-details-profile">
            <div class="attendance-details-avatar" aria-hidden="true">
              {{ String(selectedEmployee.EmployeeName || 'E').split(/[\s,]+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() }}
            </div>
            <div class="attendance-details-person">
              <span>Selected employee</span>
              <strong>{{ selectedEmployee.EmployeeName || 'Unnamed employee' }}</strong>
              <small>{{ selectedEmployee.EmployeeNumber || `Employee ID ${selectedEmployee.EmployeeID}` }}</small>
            </div>
            <div class="attendance-details-fact">
              <span>Position</span>
              <strong>{{ selectedEmployee.PositionName || '—' }}</strong>
            </div>
            <div class="attendance-details-fact">
              <span>Employee type</span>
              <strong>{{ selectedEmployee.DeploymentType || '—' }}</strong>
            </div>
            <div class="attendance-details-fact">
              <span>Attendance records</span>
              <strong>{{ attendance.length }}</strong>
            </div>
          </div>

          <div class="attendance-details-table-wrap">
            <table class="attendance-details-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Employee Status</th>
                  <th scope="col">Shift Type</th>
                  <th scope="col">Shift Code</th>
                  <th scope="col">Date In</th>
                  <th scope="col">Time In</th>
                  <th scope="col">Date Out</th>
                  <th scope="col">Time Out</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in attendance" :key="`${row.EmployeeID}-${row.AttendanceDate}-${index}`">
                  <td><strong>{{ formatDate(row.AttendanceDate) }}</strong></td>
                  <td><span class="attendance-details-status" :class="statusClass(row.AttendanceStatus)">{{ row.AttendanceStatus || 'Not set' }}</span></td>
                  <td>{{ row.ShiftType || '—' }}</td>
                  <td><span class="attendance-details-code">{{ row.ShiftCode || '—' }}</span></td>
                  <td>{{ formatDate(row.TimeIn) }}</td>
                  <td>{{ formatTime(row.TimeIn) }}</td>
                  <td>{{ formatDate(row.TimeOut) }}</td>
                  <td>{{ formatTime(row.TimeOut) }}</td>
                </tr>
                <tr v-if="!attendance.length">
                  <td colspan="8" class="attendance-details-empty">No attendance records found for this employee in the selected cutoff.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <footer class="attendance-details-footer">
          <span>{{ data.item.Status }} DTR · {{ employees.length }} {{ employees.length === 1 ? 'employee' : 'employees' }}</span>
          <button type="button" @click="emit('close')">Close</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.attendance-details-layer { position: fixed; z-index: 90; inset: 0; display: grid; place-items: center; box-sizing: border-box; padding: 24px; background: rgba(15, 27, 52, .36); }
.attendance-details-modal { display: flex; flex-direction: column; width: min(1460px, 100%); max-height: min(900px, 92vh); overflow: hidden; border: 1px solid #d7e1ef; border-radius: 18px; background: #fff; box-shadow: 0 24px 70px rgba(20, 39, 72, .25); color: #17335d; }
.attendance-details-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding: 25px 28px 21px; border-bottom: 1px solid #e1e8f2; }
.attendance-details-eyebrow { margin: 0 0 6px; color: #2867d8; font-size: 12px; font-weight: 800; letter-spacing: .1em; }
.attendance-details-header h2 { margin: 0; color: #122c57; font-size: 27px; line-height: 1.2; }
.attendance-details-header p:not(.attendance-details-eyebrow) { margin: 7px 0 0; color: #61718b; font-size: 14px; }
.attendance-details-header-actions { display: flex; align-items: center; gap: 14px; }
.attendance-details-batch { padding: 7px 11px; border-radius: 999px; background: #edf3ff; color: #2858bd; font-size: 12px; font-weight: 800; }
.attendance-details-close { display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 1px solid #d4deed; border-radius: 9px; background: #fff; color: #24436c; font: inherit; font-size: 25px; line-height: 1; cursor: pointer; }
.attendance-details-close:hover { background: #f1f5fb; }
.attendance-details-content { min-height: 0; overflow: auto; padding: 22px 28px 26px; background: #f8faff; }
.attendance-details-picker { display: flex; align-items: flex-end; gap: 18px; }
.attendance-details-picker label { display: grid; gap: 7px; width: min(580px, 100%); color: #344b6d; font-size: 13px; font-weight: 800; }
.attendance-details-picker select { width: 100%; min-height: 48px; padding: 0 42px 0 13px; border: 1px solid #b9c9e2; border-radius: 10px; background: #fff; color: #17335d; font: inherit; font-weight: 650; }
.attendance-details-picker p { margin: 0 0 11px; color: #687892; font-size: 13px; }
.attendance-details-picker p strong { color: #355580; }
.attendance-details-profile { display: grid; grid-template-columns: auto minmax(220px, 1.4fr) repeat(3, minmax(150px, 1fr)); align-items: center; gap: 16px; margin-top: 18px; padding: 16px 18px; border: 1px solid #d9e4f3; border-radius: 13px; background: #fff; }
.attendance-details-avatar { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 12px; background: #e8f0ff; color: #2863cd; font-size: 14px; font-weight: 900; }
.attendance-details-person, .attendance-details-fact { min-width: 0; }
.attendance-details-person span, .attendance-details-fact span { display: block; margin-bottom: 5px; color: #6b7c97; font-size: 11px; font-weight: 800; letter-spacing: .025em; text-transform: uppercase; }
.attendance-details-person strong, .attendance-details-fact strong { display: block; overflow-wrap: anywhere; color: #16345f; font-size: 14px; }
.attendance-details-person small { display: block; margin-top: 4px; color: #697a94; font-size: 12px; }
.attendance-details-table-wrap { margin-top: 16px; overflow: auto; border: 1px solid #d8e2f0; border-radius: 13px; background: #fff; }
.attendance-details-table { width: 100%; min-width: 1100px; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.attendance-details-table th, .attendance-details-table td { padding: 13px 14px; border-bottom: 1px solid #e5ebf4; text-align: left; vertical-align: middle; white-space: nowrap; }
.attendance-details-table th { position: sticky; top: 0; z-index: 1; background: #f2f6fc; color: #526884; font-size: 11px; font-weight: 850; letter-spacing: .025em; text-transform: uppercase; }
.attendance-details-table tbody tr:last-child td { border-bottom: 0; }
.attendance-details-table tbody tr:hover td { background: #f9fbff; }
.attendance-details-table td { color: #405473; }
.attendance-details-table td strong { color: #17365f; }
.attendance-details-code { display: inline-block; padding: 5px 8px; border-radius: 6px; background: #f0f4fa; color: #345171; font-weight: 750; }
.attendance-details-status { display: inline-flex; padding: 5px 9px; border-radius: 999px; background: #edf1f6; color: #53657d; font-size: 11px; font-weight: 850; }
.attendance-details-status.is-present { background: #dcf8e7; color: #087a39; }
.attendance-details-status.is-late, .attendance-details-status.is-holiday { background: #fff1ce; color: #8a5a00; }
.attendance-details-status.is-absent { background: #fee7e7; color: #b42318; }
.attendance-details-status.is-leave { background: #f0e8ff; color: #7043bb; }
.attendance-details-status.is-rest { background: #e5f3ff; color: #1764a5; }
.attendance-details-empty { padding: 42px 20px !important; color: #718099 !important; text-align: center !important; white-space: normal !important; }
.attendance-details-footer { display: flex; justify-content: space-between; align-items: center; gap: 18px; padding: 16px 28px; border-top: 1px solid #e1e8f2; background: #fff; }
.attendance-details-footer span { color: #72819a; font-size: 12px; }
.attendance-details-footer button { min-width: 92px; min-height: 42px; padding: 8px 16px; border: 1px solid #cbd7e9; border-radius: 9px; background: #fff; color: #24436d; font: inherit; font-weight: 800; cursor: pointer; }
.attendance-details-footer button:hover, .attendance-details-close:hover { border-color: #aebfda; background: #f3f6fb; }
.attendance-details-modal button:focus-visible, .attendance-details-modal select:focus-visible { outline: 3px solid rgba(40, 103, 216, .24); outline-offset: 2px; }

@media (max-width: 900px) {
  .attendance-details-layer { padding: 12px; }
  .attendance-details-modal { max-height: 95vh; border-radius: 14px; }
  .attendance-details-header, .attendance-details-content, .attendance-details-footer { padding-left: 18px; padding-right: 18px; }
  .attendance-details-profile { grid-template-columns: auto 1fr 1fr; }
  .attendance-details-person { grid-column: span 2; }
  .attendance-details-picker { display: grid; gap: 8px; }
  .attendance-details-picker p { margin: 0; }
}

@media (max-width: 560px) {
  .attendance-details-header h2 { font-size: 22px; }
  .attendance-details-batch { display: none; }
  .attendance-details-profile { grid-template-columns: auto 1fr; }
  .attendance-details-person { grid-column: auto; }
  .attendance-details-fact { grid-column: 1 / -1; padding-top: 10px; border-top: 1px solid #e6ecf5; }
  .attendance-details-footer span { display: none; }
  .attendance-details-footer button { width: 100%; }
}
</style>
