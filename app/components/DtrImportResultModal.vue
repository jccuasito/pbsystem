<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { dtrImportFlagLabels, dtrImportOutcomeLabels, dtrImportNeedsReview, dtrImportReviewCounts, type DtrImportReviewRow } from '~~/shared/utils/dtrImportReview'

type ImportResult = {
  imported?: number; updated?: number; skipped?: number; blank?: number; cleared?: number
  preservedEmployeeStatusDays?: number; issues?: { row: number; reason: string }[]
  reviewRows?: DtrImportReviewRow[]
}
const props = withDefaults(defineProps<{ result: ImportResult | null; fileName: string; sheetName?: string; visible?: boolean }>(), { visible: true })
const emit = defineEmits<{ close: []; done: []; review: [row: DtrImportReviewRow] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId(), descriptionId = useId()
const search = ref(''), filter = ref('review'), visible = ref(50), downloading = ref(false), downloadError = ref('')
const details = computed(() => props.result?.reviewRows || [])
const counts = computed(() => dtrImportReviewCounts(details.value))
const hasNotes = computed(() => Number(props.result?.skipped || 0) > 0 || Number(props.result?.blank || 0) > 0 || counts.value.review > 0 || Boolean(props.result?.issues?.length))
const visibleShiftCount = ref(5)
const expanded = ref(false), selectedShift = ref<string | null>(null)
function isShiftIssue(reason: string) { return /shift code.*(?:does not exist|inactive|blank|missing)/i.test(reason) }
function shiftKey(code: string) { return code.trim().toUpperCase() }
const shiftGroups = computed(() => {
  const groups = new Map<string, { code: string; rows: number[]; canOpen: boolean }>()
  function add(code: string, row: number, canOpen: boolean) {
    const key = shiftKey(code), group = groups.get(key) || { code: key, rows: [], canOpen: false }
    if (!group.rows.includes(row)) group.rows.push(row)
    group.canOpen ||= canOpen; groups.set(key, group)
  }
  for (const row of details.value) if (row.outcome === 'skipped' && isShiftIssue(row.reason)) add(row.shiftCode, row.row, true)
  const reported = new Set(details.value.map(row => row.row))
  for (const issue of props.result?.issues || []) if (!reported.has(issue.row) && isShiftIssue(issue.reason)) {
    const code = /"([^"]+)"/.exec(issue.reason)?.[1] || /shift code\s+(.+?)\s+is\s+(?:missing|inactive)/i.exec(issue.reason)?.[1] || ''
    add(code, issue.row, false)
  }
  return [...groups.values()].sort((a,b) => b.rows.length - a.rows.length || a.code.localeCompare(b.code))
})
const shiftIssueCount = computed(() => shiftGroups.value.reduce((sum, group) => sum + group.rows.length, 0))
const overviewChecks = computed(() => [
  { key: 'late', label: 'Late', count: counts.value.late },
  { key: 'undertime', label: 'Undertime', count: counts.value.undertime },
  { key: 'punches', label: 'Missing punches', count: counts.value.incomplete + counts.value.noPunches },
  { key: 'review', label: 'All rows needing review', count: counts.value.review },
].filter(item => item.count > 0))
function openDetails(key = 'review', code: string | null = null) {
  expanded.value = true; filter.value = key; selectedShift.value = code; search.value = ''; visible.value = 50
  if (dialog.value) dialog.value.scrollTop = 0
  nextTick(() => dialog.value?.querySelector<HTMLButtonElement>('.summary-back')?.focus({ preventScroll: true }))
}
function showSummary() { expanded.value = false; if (dialog.value) dialog.value.scrollTop = 0; nextTick(() => dialog.value?.querySelector<HTMLButtonElement>('.result-close')?.focus({ preventScroll: true })) }
function selectFilter(key: string) { filter.value = key; selectedShift.value = null }
function rowList(rows: number[]) { return rows.slice(0, 4).join(', ') + (rows.length > 4 ? ` +${rows.length - 4} more` : '') }
const metrics = computed(() => [
  { label: 'Added', count: props.result?.imported || 0 }, { label: 'Updated', count: props.result?.updated || 0 },
  { label: 'Skipped / preserved', count: props.result?.skipped || 0 }, { label: 'Blank source rows', count: props.result?.blank || 0 },
])
const filters = computed(() => [
  { key: 'shift', label: 'Shift codes', count: shiftIssueCount.value },
  { key: 'review', label: 'Needs review', count: counts.value.review }, { key: 'all', label: 'All rows', count: counts.value.rows },
  { key: 'late', label: 'Late', count: counts.value.late }, { key: 'undertime', label: 'Undertime', count: counts.value.undertime },
  { key: 'punches', label: 'Missing punches', count: counts.value.incomplete + counts.value.noPunches },
  { key: 'incomplete', label: 'Missing one punch', count: counts.value.incomplete }, { key: 'no-punches', label: 'No punches', count: counts.value.noPunches },
  { key: 'skipped', label: 'Skipped', count: counts.value.skipped }, { key: 'preserved', label: 'HR status kept', count: counts.value.preserved },
  { key: 'conflicts', label: 'Duplicate / overlap', count: counts.value.conflicts }, { key: 'non-work', label: 'Non-work status', count: counts.value.nonWork },
])
const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  return details.value.filter(row => {
    const matches = filter.value === 'all' || (filter.value === 'review' ? dtrImportNeedsReview(row) :
      filter.value === 'shift' ? isShiftIssue(row.reason) && row.outcome === 'skipped' && (selectedShift.value === null || shiftKey(row.shiftCode) === selectedShift.value) :
      filter.value === 'punches' ? row.flags.some(flag => ['missing-in', 'missing-out', 'no-punches'].includes(flag)) :
      filter.value === 'incomplete' ? row.flags.includes('missing-in') || row.flags.includes('missing-out') :
      filter.value === 'conflicts' ? row.flags.includes('duplicate') || row.flags.includes('overlap') : row.flags.some(flag => flag === filter.value))
    return matches && (!term || [row.employeeName, row.employeeNumber, row.sourceEmployee, row.employeeId ? `EMP-${String(row.employeeId).padStart(4,'0')}` : '', row.attendanceDate, row.row, row.shiftCode, row.reason].join(' ').toLowerCase().includes(term))
  }).sort((a,b) => Number(isShiftIssue(b.reason) && b.outcome === 'skipped') - Number(isShiftIssue(a.reason) && a.outcome === 'skipped'))
})
const shown = computed(() => filtered.value.slice(0, visible.value))
function time(value: string | null) { return value ? value.replace('T',' ').slice(0,16) : 'Not recorded' }
function employeeCode(row: DtrImportReviewRow) { return row.employeeId ? `EMP-${String(row.employeeId).padStart(4,'0')}${row.employeeNumber ? ' / ' + row.employeeNumber : ''}` : row.sourceEmployee || 'Unmatched employee' }
async function downloadReport() {
  if (downloading.value) return
  downloading.value = true; downloadError.value = ''
  try {
    const XLSX = await import('xlsx')
    const data = details.value.map(row => ({
      'Excel row': row.row, Employee: row.employeeName || row.sourceEmployee, 'Employee ID / No': employeeCode(row),
      Date: row.attendanceDate, 'Shift code': row.shiftCode, 'Source status': row.sourceStatus,
      'Actual time-in': row.timeIn || '', 'Actual time-out': row.timeOut || '',
      'Scheduled time-in': row.expectedTimeIn || '', 'Scheduled time-out': row.expectedTimeOut || '',
      'Late minutes': row.lateMinutes, 'Undertime minutes': row.undertimeMinutes,
      Result: dtrImportOutcomeLabels[row.outcome], Flags: row.flags.map(flag => dtrImportFlagLabels[flag]).join('; '),
      Notes: row.reason, 'Previous attendance cleared': row.cleared ? 'Yes' : 'No',
    }))
    const book = XLSX.utils.book_new(), sheet = XLSX.utils.json_to_sheet(data)
    sheet['!cols'] = [12,32,28,14,22,18,22,22,22,22,14,18,18,36,75,24].map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['DTR import review report'], ['Source file', props.fileName], ['Worksheet', props.sheetName || 'First worksheet'],
      ['Scope', 'Rows in this upload only. Missing punches do not confirm absence.'],
      ['Review', 'Duplicate / overlap flags are advisory; imported values were not automatically removed or merged.'],
      ['Source rows', counts.value.rows], ['Matched employees', counts.value.employees], ['Rows needing review', counts.value.review],
    ]), 'Summary')
    XLSX.utils.book_append_sheet(book, sheet, 'Row details')
    XLSX.writeFile(book, props.fileName.replace(/\.[^.]+$/, '') + '_import-review.xlsx', { compression: true })
  } catch { downloadError.value = 'Unable to download the review report. Please try again.' }
  finally { downloading.value = false }
}
watch([search, filter], () => { visible.value = 50 })
watch(() => props.result, () => { search.value = ''; filter.value = 'review'; visible.value = 50; downloadError.value = ''; expanded.value = false; selectedShift.value = null; visibleShiftCount.value = 5 })
watch([() => props.result, dialog, () => props.visible], ([result, element, visible]) => {
  if (!element) return
  if (result && visible && !element.open) element.showModal()
  if ((!result || !visible) && element.open) element.close()
}, { flush: 'post' })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="dtr-import-result" :class="{ 'is-expanded': expanded }" :aria-labelledby="titleId" :aria-describedby="descriptionId" @cancel.prevent="emit('close')">
      <template v-if="result">
        <header>
          <span class="result-label" :class="{ 'with-notes': hasNotes }">DTR Excel import</span>
          <button type="button" class="result-close" aria-label="Close import results" autofocus @click="emit('close')">&times;</button>
          <h2 :id="titleId">{{ hasNotes ? 'Import completed with notes' : 'Import completed' }}</h2>
          <p :id="descriptionId">{{ fileName }}<span v-if="sheetName"> &middot; Worksheet: {{ sheetName }}</span></p>
        </header>
        <div class="result-content">
          <button v-if="expanded" type="button" class="summary-back" @click="showSummary">&larr; Back to summary</button>
          <section v-if="!expanded && shiftGroups.length" class="shift-priority" aria-label="Shift codes to fix first">
            <div class="shift-priority-heading"><span>Fix first</span><h3>Missing or inactive shift codes</h3></div>
            <p>{{shiftIssueCount}} row{{shiftIssueCount === 1 ? '' : 's'}} not imported. Check these codes under the DTR agency.</p>
            <ul><li v-for="group in shiftGroups.slice(0,visibleShiftCount)" :key="group.code">
              <div><strong>{{group.code || 'Blank shift code'}}</strong><small>{{group.rows.length}} affected row{{group.rows.length === 1 ? '' : 's'}} &middot; Excel {{group.rows.length === 1 ? 'row' : 'rows'}} {{rowList(group.rows)}}</small></div>
              <button v-if="group.canOpen" type="button" :aria-label="'Review shift code '+(group.code || 'blank')" @click="openDetails('shift',group.code)">Review rows</button>
            </li></ul>
            <button v-if="shiftGroups.length > visibleShiftCount" type="button" class="all-shift-issues" @click="visibleShiftCount += 5">Show {{Math.min(5,shiftGroups.length-visibleShiftCount)}} more shift codes</button>
            <small>Choose the correct shift in the DTR, or set up the missing code and re-import the affected rows.</small>
          </section>
          <dl class="result-metrics"><div v-for="metric in metrics" :key="metric.label"><dt>{{ metric.label }}</dt><dd>{{ metric.count }}</dd></div></dl>
          <div v-if="expanded" class="result-info">
            <p><strong>Blank punches do not confirm absence.</strong> Check whether the employee missed a scan, had no duty, was on leave, or was absent before correcting the DTR.</p>
            <p v-if="result.blank">{{ result.blank }} source row{{ result.blank === 1 ? '' : 's' }} had missing punches. No duty was imported from those rows; valid earlier duties for the same date may still be kept.</p>
            <p v-if="result.cleared">{{ result.cleared }} previous attendance row{{ result.cleared === 1 ? '' : 's' }} cleared by blank source rows.</p>
            <p v-if="result.preservedEmployeeStatusDays">{{ result.preservedEmployeeStatusDays }} HR-approved status day{{ result.preservedEmployeeStatusDays === 1 ? '' : 's' }} preserved.</p>
          </div>
          <section v-if="!expanded && details.length" class="import-overview" aria-label="Import summary">
            <h3>Attendance checks</h3>
            <div v-if="overviewChecks.length" class="overview-checks"><button v-for="item in overviewChecks" :key="item.key" type="button" @click="openDetails(item.key)"><span>{{item.label}}</span><strong>{{item.count}}</strong><span aria-hidden="true">&rsaquo;</span></button></div>
            <p v-else>No attendance issues found in this upload.</p>
            <p v-if="Number(result.blank) > 0" class="overview-note">Missing punches do not confirm absence.</p>
            <button type="button" class="report-download" @click="openDetails(counts.review ? 'review' : 'all')">View row details</button>
          </section>
          <section v-if="expanded && details.length" class="result-review" aria-label="Detailed import review">
            <div class="review-heading"><div><h3>{{filter === 'shift' ? 'Shift codes to review' : 'Attendance review'}}</h3><p>{{ counts.rows }} source rows &middot; {{ counts.employees }} matched employees. Counts below are rows, not employees.</p></div><button type="button" class="report-download" :disabled="downloading" @click="downloadReport">{{ downloading ? 'Preparing report...' : 'Download report' }}</button></div>
            <p v-if="downloadError" class="report-error" role="alert">{{ downloadError }}</p>
            <div class="review-filters" aria-label="Filter import rows"><button v-for="item in filters" :key="item.key" type="button" :aria-pressed="filter === item.key" @click="selectFilter(item.key)">{{ item.label }} <span>{{ item.count }}</span></button></div>
            <label class="review-filter-select">Show rows<select v-model="filter" aria-label="Show import rows" @change="selectedShift=null"><option v-for="item in filters" :key="item.key" :value="item.key">{{ item.label }} ({{ item.count }})</option></select></label>
            <p v-if="filter === 'shift' && selectedShift !== null" class="selected-shift-scope">Shift: <strong>{{selectedShift || 'Blank shift code'}}</strong> <button type="button" @click="selectedShift=null">Show all shift issues</button></p>
            <label class="review-search">Search import rows<input v-model="search" type="search" placeholder="Employee, ID, date, Excel row, or shift code" /></label>
            <p class="review-scope">This report covers rows in this upload. Dates missing entirely from the file are not classified. Late/undertime minutes follow the imported DTR calculation.</p>
            <p v-if="counts.conflicts" class="review-warning">Possible duplicate or overlapping punches need manual review. The import did not automatically remove or merge these duties.</p>
            <div class="review-table-wrap">
              <table class="review-table">
                <thead><tr><th>Employee</th><th>Date / Excel row</th><th>Review details</th><th>Result</th></tr></thead>
                <tbody>
                  <tr v-for="(row,index) in shown" :key="`${row.row}-${index}`">
                    <td data-label="Employee"><strong>{{ row.employeeName || row.sourceEmployee || 'Unmatched employee' }}</strong><small>{{ employeeCode(row) }}</small></td>
                    <td data-label="Source"><strong>{{ row.attendanceDate || 'Date not provided' }}</strong><small>Excel row {{ row.row }}</small><small>Shift: {{ row.shiftCode || 'Not provided' }}</small><small v-if="row.sourceStatus">Source status: {{ row.sourceStatus }}</small></td>
                    <td data-label="Review details">
                      <div class="review-flags"><span v-for="flag in row.flags" :key="flag" :class="['review-flag', 'review-flag--'+flag]">{{ dtrImportFlagLabels[flag] }}<template v-if="flag === 'late'"> &middot; {{ row.lateMinutes }} min</template><template v-else-if="flag === 'undertime'"> &middot; {{ row.undertimeMinutes }} min</template></span><span v-if="!row.flags.length" class="review-clean">No flags</span></div>
                      <details class="row-extra"><summary>Punches and notes</summary><dl class="review-punches"><div><dt>In</dt><dd>{{ time(row.timeIn) }}<small v-if="row.expectedTimeIn">Scheduled: {{ time(row.expectedTimeIn) }}</small></dd></div><div><dt>Out</dt><dd>{{ time(row.timeOut) }}<small v-if="row.expectedTimeOut">Scheduled: {{ time(row.expectedTimeOut) }}</small></dd></div></dl>
                      <p class="review-reason">{{ row.reason }}</p></details>
                    </td>
                    <td data-label="Result"><span :class="['review-outcome','review-outcome--'+row.outcome]">{{ dtrImportOutcomeLabels[row.outcome] }}</span><button v-if="row.canReview" type="button" class="review-day" @click="emit('review',row)">Review in DTR</button></td>
                  </tr>
                  <tr v-if="!shown.length"><td colspan="4" class="review-empty">{{ filter === 'review' && !search ? 'No rows need review. Select All rows to see the imported records.' : 'No rows match this filter.' }}</td></tr>
                </tbody>
              </table>
            </div>
            <div class="review-progress"><span>Showing {{ shown.length }} of {{ filtered.length }} matching rows</span><button v-if="shown.length < filtered.length" type="button" @click="visible += 50">Show 50 more</button></div>
          </section>
          <section v-if="!details.length && hasNotes && (result.issues?.some(issue => !isShiftIssue(issue.reason)) || !shiftGroups.length)" class="result-notes" aria-label="Import notes">
            <h3>Rows to review</h3><p>Skipped rows were not imported. Check these notes before re-importing.</p>
            <ul v-if="result.issues?.length"><li v-for="(issue,index) in result.issues" :key="`${issue.row}-${index}`"><strong>Excel row {{ issue.row }}</strong><span>{{ issue.reason }}</span></li></ul>
            <p v-else>Check employee matching, dates, and shift codes in the source file.</p>
            <p v-if="Number(result.skipped || 0) > (result.issues?.length || 0) && result.issues?.length">Showing {{ result.issues.length }} of {{ result.skipped }} skipped rows.</p>
          </section>
        </div>
        <footer><p>Report available until Done review or a new import.</p><div><button type="button" class="close-report" @click="emit('close')">Close report</button><button type="button" @click="emit('done')">Done review</button></div></footer>
      </template>
    </dialog>
  </Teleport>
</template>

<style scoped>
.dtr-import-result{box-sizing:border-box;width:min(700px,calc(100vw - 32px));max-height:calc(100dvh - 32px);margin:auto;padding:0;overflow:auto;border:1px solid var(--theme-line,#dce5f1);border-radius:16px;background:var(--theme-surface,#fff);color:var(--theme-ink,#142f58);box-shadow:0 24px 70px #101b3440;font-family:Inter,system-ui,sans-serif}
.dtr-import-result::backdrop{background:#0e1e3b80}header{position:relative;padding:24px 28px 20px;border-bottom:1px solid var(--theme-line,#e3eaf4)}.result-label{color:#16804b;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.result-label.with-notes{color:#996000}h2{margin:10px 28px 8px 0;font-size:23px;line-height:1.35}header p{margin:0;color:var(--theme-muted,#64748b);font-size:13px;overflow-wrap:anywhere}.result-close{position:absolute;top:15px;right:16px;width:34px;height:34px;border:0;border-radius:8px;background:transparent;color:var(--theme-muted,#53657d);font-size:25px;cursor:pointer}.result-close:hover{background:var(--theme-soft,#edf3fa)}
.review-filter-select{display:none}
.result-content{padding:22px 28px}.result-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0}.result-metrics div{padding:13px;border:1px solid var(--theme-line,#dce5f1);border-radius:10px;background:var(--theme-soft,#f7f9fc)}.result-metrics dt{color:var(--theme-muted,#64748b);font-size:12px}.result-metrics dd{margin:6px 0 0;font-size:23px;font-weight:800}.result-info{margin-top:18px;padding:13px 15px;border-radius:10px;background:var(--theme-soft,#edf4ff);color:var(--theme-ink,#315782)}.result-info p{margin:0;font-size:13px;line-height:1.6}.result-info p+p{margin-top:8px}
.result-review{margin-top:24px}.review-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.review-heading h3{margin:0;font-size:17px}.review-heading p,.review-scope,.review-progress{margin:8px 0 0;color:var(--theme-muted,#64748b);font-size:12px;line-height:1.6}.report-download,.review-day,.review-progress button{min-height:40px;padding:9px 12px;border:1px solid var(--theme-line,#ccd8ea);border-radius:8px;background:var(--theme-surface,#fff);color:var(--theme-accent,#245abd);font:inherit;font-size:12px;font-weight:700;cursor:pointer}.report-download{flex-shrink:0}.review-filters{display:flex;flex-wrap:wrap;gap:7px;margin:18px 0 14px}.review-filters button{display:flex;align-items:center;gap:7px;min-height:38px;padding:7px 10px;border:1px solid var(--theme-line,#ccd8ea);border-radius:8px;background:var(--theme-surface,#fff);color:var(--theme-muted,#53657d);font:inherit;font-size:12px;cursor:pointer}.review-filters button[aria-pressed=true]{border-color:var(--theme-accent,#2867d8);background:var(--theme-soft,#edf3ff);color:var(--theme-accent,#245abd);font-weight:700}.review-filters span{padding:2px 5px;border-radius:5px;background:var(--theme-soft,#eef2f7);font-size:11px;font-weight:700}.review-search{display:grid;gap:6px;font-size:12px;font-weight:700}.review-search input{box-sizing:border-box;width:100%;min-height:42px;padding:9px 12px;border:1px solid var(--theme-line,#ccd8ea);border-radius:9px;background:var(--theme-surface,#fff);color:var(--theme-ink,#142f58);font:inherit;font-weight:400}.review-warning,.shift-reminder{margin:14px 0;padding:12px 14px;border:1px solid #f0d59b;border-radius:9px;background:#fffbf2;color:#7c5c35;font-size:12px;line-height:1.6}.review-table-wrap{margin-top:16px;overflow-x:auto;border:1px solid var(--theme-line,#dce5f1);border-radius:10px}.review-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px}.review-table th{padding:12px;text-align:left;background:var(--theme-soft,#f7f9fc);color:var(--theme-muted,#64748b);font-size:11px}.review-table th:nth-child(1){width:22%}.review-table th:nth-child(2){width:20%}.review-table th:nth-child(3){width:40%}.review-table th:nth-child(4){width:18%}.review-table td{padding:14px 12px;border-top:1px solid var(--theme-line,#e3eaf4);vertical-align:top;overflow-wrap:anywhere;line-height:1.5}.review-table td>strong{display:block}.review-table small{display:block;margin-top:4px;color:var(--theme-muted,#64748b);font-size:11px}.review-flags{display:flex;flex-wrap:wrap;gap:5px}.review-flag{padding:3px 7px;border-radius:5px;background:#fff2d6;color:#80500c;font-size:11px;font-weight:700}.review-flag--skipped,.review-flag--duplicate,.review-flag--overlap{background:#fee2e2;color:#991b1b}.review-flag--preserved,.review-flag--non-work{background:var(--theme-soft,#eef3ff);color:var(--theme-accent,#315782)}.review-clean{color:var(--theme-muted,#64748b);font-size:11px}.review-punches{display:grid;gap:6px;margin:10px 0 0}.review-punches>div{display:grid;grid-template-columns:28px 1fr;gap:5px}.review-punches dt{color:var(--theme-muted,#64748b)}.review-punches dd{margin:0}.review-punches small{margin-top:1px}.review-reason{margin:10px 0 0;color:var(--theme-muted,#64748b);font-size:11px}.review-outcome{display:inline-block;padding:3px 7px;border-radius:5px;background:var(--theme-soft,#eef3ff);font-size:11px;font-weight:700}.review-outcome--blank,.review-outcome--skipped{background:#fff2d6;color:#80500c}.review-day{display:block;margin-top:10px}.review-progress{display:flex;align-items:center;justify-content:space-between;gap:10px}.review-empty{text-align:center;color:var(--theme-muted,#64748b)}.result-notes{margin-top:18px;padding:16px;border:1px solid #f0d59b;border-radius:10px;background:#fffbf2;color:#7c5c35;font-size:13px;line-height:1.6}.result-notes h3{margin:0}.result-notes ul{list-style:none;padding:0}.result-notes li{display:grid;gap:5px;padding:10px 0}.result-notes li+li{border-top:1px solid #efdfbd}.report-error{color:#b42318;font-size:13px}
footer{position:sticky;bottom:0;display:flex;justify-content:flex-end;padding:16px 28px;border-top:1px solid var(--theme-line,#e3eaf4);background:var(--theme-surface,#fff)}footer button{min-height:44px;padding:10px 20px;border:1px solid #2867d8;border-radius:9px;background:#2867d8;color:#fff;font:inherit;font-size:14px;font-weight:700;cursor:pointer}.dtr-import-result button:focus-visible{outline:3px solid #92b7ff;outline-offset:2px}.dtr-import-result button:disabled{opacity:.55;cursor:wait}
@media(max-width:640px){header{padding:22px 18px 18px}h2{font-size:20px}.result-content{padding:18px}.result-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.review-heading{align-items:stretch;flex-direction:column}.review-filters button{min-height:44px}.review-search input{font-size:16px}.review-table,.review-table tbody,.review-table tr,.review-table td{display:block;width:auto}.review-table thead{display:none}.review-table td{padding:9px 12px;border-top:0}.review-table tr{padding:9px 0}.review-table tr+tr{border-top:1px solid var(--theme-line,#dce5f1)}.review-table td::before{display:block;margin-bottom:5px;content:attr(data-label);color:var(--theme-muted,#64748b);font-size:10px;text-transform:uppercase;letter-spacing:.04em}.review-day{min-height:44px}.review-progress{align-items:stretch;flex-direction:column}footer{padding:14px 18px}footer button{width:100%}}
@media(max-width:640px){.review-filters{display:none}.review-filter-select{display:grid;gap:6px;margin:16px 0 12px;font-size:12px;font-weight:700}.review-filter-select select{width:100%;min-height:44px;padding:8px;border:1px solid var(--theme-line,#ccd8ea);border-radius:8px;background:var(--theme-surface,#fff);color:var(--theme-ink,#142f58);font:inherit;font-size:16px}}
:global(html[data-theme='dark'] .dtr-import-result .result-label){color:#77dfac}
:global(html[data-theme='dark'] .dtr-import-result .result-label.with-notes){color:#ffd18b}
:global(html[data-theme='dark'] .dtr-import-result :is(.result-notes,.review-warning,.shift-reminder)){background:#332a1c;border-color:#806237;color:#f2d1a2}
:global(html[data-theme='dark'] .dtr-import-result .review-flag){background:#332a1c;color:#f2d1a2}
:global(html[data-theme='dark'] .dtr-import-result :is(.review-flag--skipped,.review-flag--duplicate,.review-flag--overlap)){background:#3c222d;color:#fecaca}
</style>

<style scoped>
footer{align-items:center;gap:14px;justify-content:space-between}footer p{margin:0;color:var(--theme-muted,#64748b);font-size:11px;line-height:1.5;max-width:460px}footer>div{display:flex;gap:10px;flex-shrink:0}footer .close-report{border-color:var(--theme-line,#ccd8ea);background:var(--theme-surface,#fff);color:var(--theme-ink,#142f58)}
@media(max-width:640px){footer{align-items:stretch;flex-direction:column}footer>div{display:grid;grid-template-columns:1fr 1fr}footer button{padding:10px 12px}}
</style>

<style scoped>
.dtr-import-result.is-expanded{width:min(1040px,calc(100vw - 32px))}
.shift-priority{margin:0 0 20px;padding:16px;border:1px solid #ebc06f;border-left:4px solid #c77806;border-radius:10px;background:#fffbf2;color:#754a0d}
.shift-priority-heading{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.shift-priority-heading>span{padding:3px 7px;border-radius:5px;background:#f8e5bd;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}
.shift-priority h3{margin:0;font-size:16px}.shift-priority p{margin:9px 0 12px;font-size:12px;line-height:1.5}.shift-priority ul{list-style:none;margin:0 0 10px;padding:0}.shift-priority li{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px 0;border-top:1px solid #edd9b6}.shift-priority li>div{min-width:0}.shift-priority strong{display:block;font-size:17px;overflow-wrap:anywhere}.shift-priority small{display:block;font-size:11px;line-height:1.6}.shift-priority li small{margin-top:4px}.shift-priority button{flex:none;min-height:40px;padding:8px 10px;border:1px solid #d8b16a;border-radius:7px;background:var(--theme-surface,#fff);color:inherit;font:inherit;font-size:12px;font-weight:700;cursor:pointer}.shift-priority .all-shift-issues{margin:0 0 12px}
.result-metrics div{padding:10px 12px}.result-metrics dt{font-size:11px}.result-metrics dd{margin-top:5px;font-size:20px}
.import-overview{margin-top:22px}.import-overview h3{margin:0 0 10px;font-size:15px}.overview-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.overview-checks button{display:flex;align-items:center;gap:10px;min-height:44px;padding:10px 12px;text-align:left;border:1px solid var(--theme-line,#dce5f1);border-radius:8px;background:var(--theme-surface,#fff);color:var(--theme-ink,#142f58);font:inherit;font-size:12px;cursor:pointer}.overview-checks button>span:first-child{flex:1}.overview-checks strong{font-size:14px}.import-overview>p{font-size:12px;color:var(--theme-muted,#64748b)}.import-overview>.report-download{margin-top:14px}.overview-note{line-height:1.5}
.summary-back,.selected-shift-scope button{min-height:36px;padding:6px 0;border:0;background:transparent;color:var(--theme-accent,#245abd);font:inherit;font-size:12px;font-weight:700;cursor:pointer}.summary-back{margin-bottom:14px}.selected-shift-scope{font-size:12px}.selected-shift-scope button{margin-left:12px}.row-extra{margin-top:10px}.row-extra summary{min-height:30px;color:var(--theme-accent,#245abd);font-size:11px;cursor:pointer}.row-extra[open] summary{margin-bottom:5px}
@media(max-width:640px){.overview-checks{grid-template-columns:1fr}.shift-priority{padding:14px}.shift-priority li{align-items:stretch;flex-direction:column;gap:8px}.shift-priority li button{align-self:start;min-height:44px}.shift-priority strong{font-size:16px}}
:global(html[data-theme='dark'] .dtr-import-result .shift-priority){background:#332a1c;border-color:#806237;color:#f2d1a2}
:global(html[data-theme='dark'] .dtr-import-result .shift-priority-heading>span){background:#59431d;color:#ffdf9e}
:global(html[data-theme='dark'] .dtr-import-result .shift-priority li){border-color:#66512f}
</style>
