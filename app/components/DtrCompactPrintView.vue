<script setup lang="ts">
type CompactDtrData = {
  item?: Record<string, any>
  batch?: Record<string, any>
  summary?: Record<string, any>
  records?: Record<string, any>[]
  attendanceRows?: Record<string, any>[]
}

const props = defineProps<{ data: CompactDtrData }>()
const emit = defineEmits<{ close: [] }>()

const failedLogos = ref(new Set<string>())
const batch = computed(() => ({ ...(props.data.item || {}), ...(props.data.batch || {}) }))
const records = computed(() => props.data.records || [])
const attendanceRows = computed(() => (props.data.attendanceRows || []).map(row => ({ ...row, AttendanceDate: dateOnly(row.AttendanceDate) })))
const attendanceMap = computed(() => new Map(attendanceRows.value.map(row => [`${row.EmployeeID}:${row.AttendanceDate}`, row])))

const summaryFields = [
  ['RegularHours', 'REG HRS', 'Regular hours'],
  ['OTHours', 'REG OT', 'Regular OT'],
  ['OTExtHours', 'OT EXT', 'OT extension'],
  ['NightDiffHours', 'NIGHT DIFF', 'Night differential'],
  ['WDODays', 'WDO', 'Work Day Off'],
  ['RestDayOTHours', 'WDO OT', 'Rest day OT'],
  ['LateHours', 'LATE', 'Late hours'],
  ['UndertimeHours', 'UNDER TIME', 'Undertime hours'],
  ['LegalHolidayHours', 'LH', 'Legal holiday hours'],
  ['LegalHolidayOTHours', 'LH OT', 'Legal holiday OT'],
  ['RestDayLegalHolidayHours', 'WDO LH', 'Rest day legal holiday hours'],
  ['RestDayLegalHolidayOTHours', 'WDO LH OT', 'Rest day legal holiday OT'],
  ['SpecialHolidayHours', 'SH', 'Special holiday hours'],
  ['SpecialHolidayOTHours', 'SH OT', 'Special holiday OT'],
  ['RestDaySpecialHolidayHours', 'WDO SH', 'Rest day special holiday hours'],
  ['RestDaySpecialHolidayOTHours', 'WDO SH OT', 'Rest day special holiday OT']
] as const
const paidHourFields = [...summaryFields.map(([key]) => key).filter(key => !['WDODays', 'LateHours', 'UndertimeHours'].includes(key)), 'RestDayHours']
const noWorkStatuses = new Set(['Absent', 'Rest Day', 'On-Leave', 'Vacation Leave', 'Reliever', 'Sick Leave'])
const colorLegend = [
  ['Late / undertime', 'tone-late'], ['Half-day', 'tone-half-day'], ['Absent', 'tone-absent'],
  ['On-leave', 'tone-on-leave'], ['Vacation leave', 'tone-vacation-leave'], ['Holiday', 'tone-holiday'],
  ['Rest day', 'tone-rest-day'], ['Reliever', 'tone-reliever'], ['Sick leave', 'tone-sick-leave'],
  ['Day shift', 'tone-shift-ds'], ['Night shift', 'tone-shift-ns'], ['Straight / split shift', 'tone-shift-ss']
] as const

function dateOnly(value: unknown) {
  return String(value || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || ''
}
function cutoffDates() {
  const result: string[] = []
  const start = dateOnly(batch.value.PeriodStart)
  const end = dateOnly(batch.value.PeriodEnd)
  if (!start || !end) return result
  for (const day = new Date(`${start}T00:00:00`); day <= new Date(`${end}T00:00:00`); day.setDate(day.getDate() + 1)) {
    result.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`)
  }
  return result
}
function formatDate(value: unknown) {
  const normalized = dateOnly(value)
  return normalized ? new Date(`${normalized}T00:00:00`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'
}
function formatPeriod() {
  return `${formatDate(batch.value.PeriodStart)} to ${formatDate(batch.value.PeriodEnd)}`
}
function logoInitials(name: unknown) {
  return String(name || '').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() || '—'
}
function logoKey(resource: 'agency' | 'site') {
  return `${resource}-${resource === 'agency' ? batch.value.AgencyID : batch.value.SiteID}`
}
function entry(employeeId: unknown, date: string) {
  return attendanceMap.value.get(`${employeeId}:${date}`)
}
function isWorked(record: any) {
  if (!record || noWorkStatuses.has(String(record.AttendanceStatus || 'Present'))) return false
  return paidHourFields.some(key => Number(record[key] || 0) > 0) || Boolean(record.TimeIn || record.TimeOut)
}
function totalDays(row: any) {
  return attendanceRows.value.filter(item => String(item.EmployeeID) === String(row.EmployeeID) && isWorked(item)).reduce((sum, item) => sum + Math.max(1, Number(item.WorkdayCount || 1)), 0)
}
function wdoDays(row: any) {
  return attendanceRows.value.filter(item => String(item.EmployeeID) === String(row.EmployeeID) && isWorked(item) && Number(item.IsWDO || 0) === 1).length
}
function rowSummary(row: any, key: string) {
  if (key === 'WDODays') return wdoDays(row)
  return attendanceRows.value.filter(item => String(item.EmployeeID) === String(row.EmployeeID)).reduce((sum, item) => sum + Number(item[key] || 0), 0)
}
function totalSummary(key: string) {
  return records.value.reduce((sum, row) => sum + Number(rowSummary(row, key) || 0), 0)
}
function number(value: unknown, integer = false) {
  const amount = Number(value || 0)
  return integer ? String(Math.round(amount)) : amount.toFixed(2)
}
function shiftTag(row: any) {
  const labels: Record<string, string> = {
    DAY: 'DS',
    NIGHT: 'NS',
    SPLIT: 'SS'
  }
  const values = attendanceRows.value
    .filter(item => String(item.EmployeeID) === String(row.EmployeeID))
    .map((item) => {
      const type = String(item.ShiftType || '').trim().toUpperCase()
      return labels[type] || type
    })
    .filter(Boolean)
  return [...new Set(values)].join('/') || '—'
}
function dayToneClass(row: any, record: any) {
  if (!record) return ''
  const status = String(record.AttendanceStatus || 'Present')
  if (noWorkStatuses.has(status) && Number(record.LegalHolidayHours || 0) > 0) return ''
  if (status === 'Late' || Number(record.UndertimeHours || 0) > 0) return 'tone-late'
  if (status !== 'Present') return `tone-${status.toLowerCase().replace(/[^a-z]+/g, '-')}`
  if (Number(record.IsStraightDuty) === 1) return 'tone-shift-ss'
  if (row.DefaultShiftCodeID && String(record.ShiftCodeID) === String(row.DefaultShiftCodeID)) return ''
  const shiftType = String(record.ShiftType || '').toUpperCase()
  if (shiftType === 'DS' || shiftType === 'DAY') return 'tone-shift-ds'
  if (shiftType === 'NS' || shiftType === 'NIGHT') return 'tone-shift-ns'
  if (shiftType === 'SS' || shiftType === 'SPLIT') return 'tone-shift-ss'
  return ''
}
function dayMain(record: any) {
  if (!record) return ''
  const status = String(record.AttendanceStatus || 'Present')
  const labels: Record<string, string> = { Absent: 'A', 'Rest Day': 'RD', 'On-Leave': 'OL', 'Vacation Leave': 'VL', Reliever: 'REL', 'Sick Leave': 'SL' }
  if (noWorkStatuses.has(status) && Number(record.LegalHolidayHours || 0) > 0) return ''
  if (noWorkStatuses.has(status)) return labels[status] || status
  const regular = Number(record.RegularHours || 0)
  const restDay = Number(record.RestDayHours || 0)
  const holiday = Number(record.LegalHolidayHours || 0) + Number(record.SpecialHolidayHours || 0)
  const hours = regular || restDay || holiday
  return hours ? hours.toFixed(2) : status === 'Holiday' ? 'H' : ''
}
function daySub(record: any) {
  if (!record || noWorkStatuses.has(String(record.AttendanceStatus || 'Present'))) return ''
  const overtime = Number(record.OTHours || 0) + Number(record.OTExtHours || 0)
  return overtime ? overtime.toFixed(2) : String(record.AttendanceStatus || 'Present') === 'Present' ? '' : String(record.AttendanceStatus)
}
function printDtr() {
  window.print()
}
</script>

<template>
  <div class="compact-dtr-layer" role="dialog" aria-modal="true" aria-labelledby="compact-dtr-title">
    <section class="compact-dtr-window">
      <div class="compact-dtr-toolbar no-print">
        <div>
          <p>READ-ONLY PRINT VIEW</p>
          <h2 id="compact-dtr-title">Compact DTR</h2>
        </div>
        <div class="compact-dtr-actions">
          <button class="print-button" type="button" @click="printDtr">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/></svg>
            Print DTR
          </button>
          <button class="close-button" type="button" @click="emit('close')">Close</button>
        </div>
      </div>

      <div class="compact-dtr-scroll">
        <article class="compact-dtr-print-root">
          <header class="print-header">
            <div class="agency-brand">
              <div class="brand-logo agency-logo">
                <img v-if="Number(batch.AgencyHasLogo) === 1 && !failedLogos.has(logoKey('agency'))" :src="`/api/organization/logo?resource=agency&id=${batch.AgencyID}`" :alt="`${batch.AgencyName} logo`" @error="failedLogos.add(logoKey('agency'))">
                <span v-else>{{ logoInitials(batch.AgencyName) }}</span>
              </div>
              <div class="company-heading">
                <h1>{{ batch.AgencyName }}</h1>
                <p v-if="batch.AgencyAddress">{{ batch.AgencyAddress }}</p>
                <p v-if="batch.AgencyContact">Contact: {{ batch.AgencyContact }}</p>
              </div>
            </div>
            <strong class="document-status">{{ batch.Status }}</strong>
          </header>

          <div class="document-meta">
            <div class="period-meta"><span>Payroll period:</span><strong>{{ formatPeriod() }}</strong></div>
            <div class="site-meta">
              <span>Detachment / Site:</span>
              <div class="site-identity">
                <div class="site-identity-line">
                  <strong>{{ batch.SiteName }}</strong>
                  <div class="brand-logo site-logo">
                    <img v-if="Number(batch.SiteHasLogo) === 1 && !failedLogos.has(logoKey('site'))" :src="`/api/organization/logo?resource=site&id=${batch.SiteID}`" :alt="`${batch.SiteName} logo`" @error="failedLogos.add(logoKey('site'))">
                    <span v-else>{{ logoInitials(batch.SiteName) }}</span>
                  </div>
                </div>
                <small v-if="batch.SiteAddress">{{ batch.SiteAddress }}</small>
              </div>
            </div>
          </div>
          <h2 class="document-title">Summary Daily Time Record</h2>
          <div class="compact-legend" aria-label="Attendance color legend">
            <span v-for="[label, tone] in colorLegend" :key="tone"><i :class="tone" aria-hidden="true"></i>{{ label }}</span>
          </div>

          <div class="print-table-wrap">
            <table class="compact-table">
              <thead>
                <tr>
                  <th class="number-column">No.</th>
                  <th class="name-column">Name of personnel</th>
                  <th class="position-column">Position</th>
                  <th class="type-column">Type</th>
                  <th class="shift-column">Shift</th>
                  <th v-for="date in cutoffDates()" :key="date" class="date-column">{{ Number(date.slice(-2)) }}</th>
                  <th class="metric-column">Total days</th>
                  <th v-for="field in summaryFields" :key="field[0]" class="metric-column" :title="field[2]">{{ field[1] }}</th>
                  <th class="signature-column" title="Signature">Sign</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in records" :key="row.EmployeeID">
                  <td>{{ index + 1 }}</td>
                  <td class="employee-cell"><strong>{{ row.EmployeeName }}</strong><small>{{ row.EmployeeNumber || `EMP-${String(row.EmployeeID).padStart(4, '0')}` }}</small></td>
                  <td>{{ row.PositionName || '—' }}</td>
                  <td>{{ row.DeploymentType || 'Regular' }}</td>
                  <td>{{ shiftTag(row) }}</td>
                  <td v-for="date in cutoffDates()" :key="date" :class="['attendance-cell', dayToneClass(row, entry(row.EmployeeID, date))]" :title="entry(row.EmployeeID, date)?.AttendanceStatus || ''">
                    <strong>{{ dayMain(entry(row.EmployeeID, date)) }}</strong>
                    <small>{{ daySub(entry(row.EmployeeID, date)) }}</small>
                  </td>
                  <td class="metric-value">{{ number(totalDays(row), true) }}</td>
                  <td v-for="field in summaryFields" :key="field[0]" class="metric-value">{{ number(rowSummary(row, field[0]), field[0] === 'WDODays') }}</td>
                  <td></td>
                </tr>
                <tr v-if="!records.length"><td :colspan="7 + cutoffDates().length + summaryFields.length" class="empty-row">No employees are enrolled in this DTR.</td></tr>
              </tbody>
              <tfoot v-if="records.length">
                <tr>
                  <th :colspan="5 + cutoffDates().length">Total</th>
                  <th class="metric-value">{{ records.reduce((sum, row) => sum + totalDays(row), 0) }}</th>
                  <th v-for="field in summaryFields" :key="field[0]" class="metric-value">{{ number(totalSummary(field[0]), field[0] === 'WDODays') }}</th>
                  <th></th>
                </tr>
              </tfoot>
            </table>
          </div>

          <footer class="signature-blocks">
            <div><strong>Prepared by:</strong><span></span><small>Signature over printed name / date</small></div>
            <div><strong>Checked by:</strong><span></span><small>Signature over printed name / date</small></div>
            <div><strong>Noted by:</strong><span></span><small>Signature over printed name / date</small></div>
          </footer>
          <p class="document-reference">DTR-{{ String(batch.BatchID).padStart(4, '0') }} · Generated {{ new Date().toLocaleString('en-PH') }}</p>
        </article>
      </div>
    </section>
  </div>
</template>

<style>
.compact-dtr-layer{position:fixed;z-index:90;inset:0;display:grid;place-items:center;padding:18px;background:rgba(15,27,52,.32);font-family:'Plus Jakarta Sans','Inter',system-ui,-apple-system,'Segoe UI',sans-serif}
.compact-dtr-window{display:flex;flex-direction:column;width:min(1840px,100%);height:min(94vh,1040px);overflow:hidden;border-radius:16px;background:#eef2f7;box-shadow:0 24px 70px rgba(15,31,58,.24)}
.compact-dtr-toolbar{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px 20px;border-bottom:1px solid #d8e0ec;background:#fff}
.compact-dtr-toolbar p{margin:0 0 3px;color:#2867d8;font-size:11px;font-weight:800;letter-spacing:.09em}
.compact-dtr-toolbar h2{margin:0;color:#102d58;font-size:24px}
.compact-dtr-actions{display:flex;gap:9px}
.compact-dtr-actions button{display:inline-flex;align-items:center;gap:7px;min-height:42px;padding:9px 15px;border:1px solid #ccd8ea;border-radius:8px;background:#fff;color:#20436f;font:inherit;font-weight:750;cursor:pointer}
.compact-dtr-actions button:hover{background:#edf4ff;border-color:#9ab8eb}
.compact-dtr-actions .print-button{border-color:#2867d8;background:#2867d8;color:#fff}
.compact-dtr-actions .print-button:hover{background:#1e58c3}
.compact-dtr-actions svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.compact-dtr-scroll{flex:1;min-width:0;overflow-x:hidden;overflow-y:auto;padding:18px}
.compact-dtr-print-root{box-sizing:border-box;width:min(1800px,100%);min-width:0;margin:0 auto;padding:22px;background:#fff;color:#101820;box-shadow:0 4px 18px rgba(18,45,88,.12);print-color-adjust:exact;-webkit-print-color-adjust:exact}
.compact-dtr-print-root .print-header{position:relative;display:flex;align-items:center;justify-content:center;min-height:72px;padding:6px 85px}
.brand-logo{display:grid;place-items:center;flex:none;overflow:visible;border:0;background:transparent;color:#52647d;font-size:14px;font-weight:850}
.compact-dtr-print-root .brand-logo>img{display:block!important;box-sizing:border-box!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;padding:0!important;border:0!important;background:transparent!important;object-fit:contain!important;object-position:center!important}
.compact-dtr-print-root .agency-brand{display:flex;align-items:flex-start;justify-content:center;gap:14px;min-width:0}
.compact-dtr-print-root .agency-logo{width:50px;height:50px}
.compact-dtr-print-root .company-heading{flex:0 1 auto;max-width:680px;text-align:center}
.compact-dtr-print-root .company-heading h1{margin:0;text-transform:uppercase;font-size:23px;line-height:1.2}
.compact-dtr-print-root .company-heading p{margin:5px 0 0;font-size:11px}
.compact-dtr-print-root .document-status{position:absolute;top:6px;right:0;padding:0 3px 2px;border-bottom:1px solid #111;text-transform:capitalize;font-size:12px;font-style:italic}
.document-meta{display:grid;grid-template-columns:1fr 1fr;align-items:start;gap:80px;margin-top:4px;font-size:11px}
.document-meta .period-meta,.document-meta .site-meta{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:8px}
.document-meta .period-meta>span,.document-meta .site-meta>span{padding-top:2px;white-space:nowrap}
.document-meta .site-meta>span{padding-top:10px}
.document-meta strong{padding:0 8px 4px;border-bottom:1px solid #111;text-align:center;text-transform:uppercase}
.document-meta span{text-transform:uppercase;font-weight:800}
.document-meta .site-identity{display:flex;min-width:0;flex-direction:column;align-items:stretch;gap:3px}
.document-meta .site-identity-line{display:flex;align-items:flex-end;justify-content:flex-start;gap:8px;min-width:0;min-height:34px;padding-bottom:3px;border-bottom:1px solid #111}
.document-meta .site-logo{width:58px;height:24px}
.document-meta .site-identity strong{box-sizing:border-box;flex:none;min-width:0;padding:0 0 2px 8px;border-bottom:0;text-align:left;white-space:nowrap}
.document-meta .site-identity small{display:block;margin:2px 0 0 0;padding-left:8px;color:#4b5563;text-align:left}
.document-title{margin:10px 0 9px;text-align:center;text-transform:uppercase;font-size:12px}
.compact-dtr-print-root .compact-legend{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:5px 12px;margin:0 0 9px;color:#43536b;font-size:10px}
.compact-dtr-print-root .compact-legend span{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.compact-dtr-print-root .compact-legend i{display:inline-block;flex:none;width:10px;height:10px;border-radius:2px}
.compact-legend i.tone-late{background:#f97316}.compact-legend i.tone-half-day{background:#64748b}.compact-legend i.tone-absent{background:#ef4444}.compact-legend i.tone-on-leave{background:#8b5cf6}.compact-legend i.tone-vacation-leave{background:#eab308}.compact-legend i.tone-holiday{background:#f59e0b}.compact-legend i.tone-rest-day{background:#0ea5e9}.compact-legend i.tone-reliever{background:#10b981}.compact-legend i.tone-sick-leave{background:#e11d48}.compact-legend i.tone-shift-ds{background:#e0ad16}.compact-legend i.tone-shift-ns{background:#356aa8}.compact-legend i.tone-shift-ss{background:#2f7a52}
.print-table-wrap{min-width:0;max-width:100%;overflow:visible}
.compact-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8px}
.compact-table th,.compact-table td{height:34px;padding:3px 2px;border:1px solid #202020;text-align:center;vertical-align:middle;overflow-wrap:anywhere}
.compact-table thead th{height:42px;background:#fff600;text-transform:uppercase;font-size:7px;line-height:1.12}
.compact-table thead th.metric-column{overflow-wrap:normal;word-break:normal;hyphens:none}
.compact-table .metric-value{white-space:nowrap;overflow-wrap:normal;font-variant-numeric:tabular-nums}
.compact-table .number-column{width:26px}.compact-table .name-column{width:145px}.compact-table .position-column{width:70px}.compact-table .type-column{width:54px}.compact-table .shift-column{width:42px}.compact-table .date-column{width:35px}.compact-table .metric-column{width:43px}.compact-table .signature-column{width:110px}
.compact-table .employee-cell{text-align:left;padding-inline:5px}.compact-table .employee-cell strong,.compact-table .employee-cell small{display:block}.compact-table .employee-cell small{margin-top:3px;color:#475569;font-size:7px}
.compact-table .attendance-cell{padding:2px 1px}.compact-table .attendance-cell strong,.compact-table .attendance-cell small{display:block;line-height:1.15}.compact-table .attendance-cell small{margin-top:2px;font-size:6px}
.compact-table tbody tr:nth-child(even) td{background:#fbfcfe}.compact-table tfoot th{height:24px;background:#c6dfb5;text-transform:uppercase}
.compact-table tbody tr td.tone-late{background:#fff0db;color:#9a4b00;box-shadow:inset 0 -3px 0 #f97316}
.compact-table tbody tr td.tone-half-day{background:#e8edf5;color:#233044;box-shadow:inset 0 -3px 0 #475569}
.compact-table tbody tr td.tone-absent{background:#fee2e2;color:#991b1b}
.compact-table tbody tr td.tone-on-leave{background:#ede9fe;color:#5b21b6}
.compact-table tbody tr td.tone-vacation-leave{background:#fef3c7;color:#854d0e}
.compact-table tbody tr td.tone-holiday{background:#fef3c7;color:#92400e}
.compact-table tbody tr td.tone-rest-day{background:#e0f2fe;color:#075985}
.compact-table tbody tr td.tone-reliever{background:#d1fae5;color:#065f46}
.compact-table tbody tr td.tone-sick-leave{background:#ffe4e6;color:#9f1239}
.compact-table tbody tr td.tone-shift-ds{background:#e0ad16;color:#172033}
.compact-table tbody tr td.tone-shift-ns{background:#356aa8;color:#fff}
.compact-table tbody tr td.tone-shift-ss{background:#2f7a52;color:#fff}
.compact-table .empty-row{height:70px;color:#64748b;font-size:11px}
.signature-blocks{display:grid;grid-template-columns:repeat(3,1fr);gap:70px;margin-top:30px}
.signature-blocks div{display:grid;min-height:84px;font-size:9px}.signature-blocks strong{text-transform:uppercase}.signature-blocks span{align-self:end;border-bottom:1px solid #111}.signature-blocks small{margin-top:5px;text-align:center;text-transform:uppercase;font-size:7px}
.document-reference{margin:18px 0 0;color:#64748b;text-align:right;font-size:7px}
@media screen{
  .compact-dtr-print-root .print-header{padding-inline:clamp(48px,8vw,150px)}
  .document-meta{gap:clamp(16px,4vw,80px)}
  .signature-blocks{gap:clamp(16px,4vw,70px)}
  .compact-table{font-size:clamp(8px,.63vw,12px)}
  .compact-table th,.compact-table td{padding-inline:1px}
  .compact-table thead th{font-size:clamp(7px,.52vw,10px)}
  .compact-table thead th.metric-column{font-size:clamp(7.5px,.5vw,9px)}
  .compact-table .metric-value{font-size:clamp(8px,.55vw,10px)}
  .compact-table .employee-cell small{font-size:clamp(7px,.52vw,10px)}
  .compact-table .attendance-cell small{font-size:clamp(7px,.48vw,9px)}
  .compact-table .number-column{width:1.5%}
  .compact-table .name-column{width:8.5%}
  .compact-table .position-column{width:4.5%}
  .compact-table .type-column{width:3.5%}
  .compact-table .shift-column{width:3.5%}
  .compact-table .date-column{width:2.15%}
  .compact-table .metric-column{width:2.35%}
  .compact-table .signature-column{width:3%;font-size:clamp(6px,.42vw,8px);white-space:nowrap}
}
@media(max-width:700px){.compact-dtr-layer{padding:0}.compact-dtr-window{height:100vh;border-radius:0}.compact-dtr-toolbar{align-items:flex-start;padding:13px}.compact-dtr-toolbar h2{font-size:20px}.compact-dtr-actions{flex-direction:column}.compact-dtr-actions button{min-height:36px;padding:7px 10px}.compact-dtr-scroll{padding:10px}}
@media print{
  @page{size:A4 landscape;margin:6mm}
  html,body{width:auto!important;height:auto!important;background:#fff!important}
  body *{visibility:hidden!important}
  .compact-dtr-print-root,.compact-dtr-print-root *{visibility:visible!important}
  .compact-dtr-layer{position:static!important;display:block!important;padding:0!important;background:#fff!important}
  .compact-dtr-window{display:block!important;width:auto!important;height:auto!important;overflow:visible!important;background:#fff!important;box-shadow:none!important}
  .no-print{display:none!important}
  .compact-dtr-scroll{overflow:visible!important;padding:0!important}
  .compact-dtr-print-root{position:absolute;inset:0;width:100%!important;min-width:0!important;margin:0!important;padding:0!important;box-shadow:none!important}
  .compact-dtr-print-root .print-header{min-height:48px;padding:0 60px}.compact-dtr-print-root .agency-brand{gap:8px}.compact-dtr-print-root .agency-logo{width:34px;height:34px}.compact-dtr-print-root .company-heading{max-width:430px}.compact-dtr-print-root .company-heading h1{font-size:16px}.compact-dtr-print-root .company-heading p{font-size:7px}.compact-dtr-print-root .document-status{top:3px;font-size:8px}
  .document-meta{gap:35px;font-size:7px}.document-meta .site-meta>span{padding-top:4px}.document-meta .site-identity-line{gap:5px;min-height:24px;padding-bottom:2px}.document-meta .site-logo{width:40px;height:18px}.document-title{margin:6px 0;font-size:8px}
  .compact-dtr-print-root .compact-legend{gap:3px 7px;margin-bottom:5px;font-size:5px}.compact-dtr-print-root .compact-legend i{width:6px;height:6px}
  .compact-table{font-size:5.2px}.compact-table th,.compact-table td{height:23px;padding:1px}.compact-table thead th{height:31px;font-size:4.7px}.compact-table .number-column{width:18px}.compact-table .name-column{width:92px}.compact-table .position-column{width:48px}.compact-table .type-column{width:35px}.compact-table .shift-column{width:28px}.compact-table .date-column{width:22px}.compact-table .metric-column{width:27px}.compact-table .signature-column{width:65px}.compact-table .employee-cell small{font-size:4.5px}.compact-table .attendance-cell small{font-size:4px}
  .signature-blocks{gap:45px;margin-top:18px}.signature-blocks div{min-height:50px;font-size:6px}.signature-blocks small,.document-reference{font-size:5px}
}
</style>
