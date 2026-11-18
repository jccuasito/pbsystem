export type DtrImportFlag = 'late' | 'undertime' | 'missing-in' | 'missing-out' | 'no-punches' | 'non-work' | 'skipped' | 'preserved' | 'duplicate' | 'overlap'
export type DtrImportOutcome = 'added' | 'updated' | 'blank' | 'skipped' | 'preserved'
export type DtrImportReviewRow = {
  row: number
  employeeId: number | null
  employeeNumber: string
  employeeName: string
  sourceEmployee: string
  attendanceDate: string
  shiftCode: string
  sourceStatus: string
  timeIn: string | null
  timeOut: string | null
  expectedTimeIn: string | null
  expectedTimeOut: string | null
  lateMinutes: number
  undertimeMinutes: number
  outcome: DtrImportOutcome
  flags: DtrImportFlag[]
  reason: string
  canReview: boolean
  cleared?: boolean
}

export const dtrImportFlagLabels: Record<DtrImportFlag, string> = {
  late: 'Late', undertime: 'Undertime', 'missing-in': 'Missing time-in', 'missing-out': 'Missing time-out',
  'no-punches': 'No punches recorded', 'non-work': 'Non-work status in source', skipped: 'Skipped',
  preserved: 'HR status preserved', duplicate: 'Possible duplicate punches', overlap: 'Overlapping punches',
}
export const dtrImportOutcomeLabels: Record<DtrImportOutcome, string> = {
  added: 'Added', updated: 'Updated', blank: 'Left blank', skipped: 'Not imported', preserved: 'HR status kept',
}
export function dtrImportNeedsReview(row: DtrImportReviewRow) { return row.flags.length > 0 || !['added', 'updated'].includes(row.outcome) }

// Diagnostics only: never deduplicate, merge, or alter imported attendance/pay.
export function flagDtrImportOverlaps(rows: DtrImportReviewRow[]) {
  const byEmployee = new Map<number, DtrImportReviewRow[]>()
  for (const row of rows) {
    if (!row.employeeId || !row.timeIn || !row.timeOut || !['added', 'updated'].includes(row.outcome) || row.flags.includes('non-work')) continue
    const items = byEmployee.get(row.employeeId) || []
    items.push(row); byEmployee.set(row.employeeId, items)
  }
  for (const items of byEmployee.values()) {
    items.sort((a, b) => a.timeIn!.localeCompare(b.timeIn!))
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length && items[j].timeIn! < items[i].timeOut!; j++) {
      const a = items[i], b = items[j]
      const flag = a.timeIn === b.timeIn && a.timeOut === b.timeOut ? 'duplicate' : 'overlap'
      if (!a.flags.includes(flag)) a.flags.push(flag)
      if (!b.flags.includes(flag)) b.flags.push(flag)
    }
  }
}

export function dtrImportReviewCounts(rows: DtrImportReviewRow[]) {
  const count = (flag: DtrImportFlag) => rows.filter(row => row.flags.includes(flag)).length
  return {
    rows: rows.length, employees: new Set(rows.flatMap(row => row.employeeId ? [row.employeeId] : [])).size,
    review: rows.filter(dtrImportNeedsReview).length,
    late: count('late'), undertime: count('undertime'),
    incomplete: rows.filter(row => row.flags.includes('missing-in') || row.flags.includes('missing-out')).length,
    noPunches: count('no-punches'), nonWork: count('non-work'),
    skipped: rows.filter(row => row.outcome === 'skipped').length, preserved: count('preserved'),
    conflicts: rows.filter(row => row.flags.includes('duplicate') || row.flags.includes('overlap')).length,
  }
}
