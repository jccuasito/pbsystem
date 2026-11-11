export type AnnualSource = {
  id: string; start: string; end: string; reference: string; site: string; kind: string
  basic: number; timeDeductions: number; adjustments: number; excluded: number
  issues: string[]; payrollId?: number; earningId?: number
}
export const annualCents = (value: unknown) => Math.round(Number(value || 0) * 100)
export function annualDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : ''
}
export const annualOverlap = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start <= b.end && b.start <= a.end

// Only stable component codes are classified; labels and net/gross totals are never used.
export function annualBasic(components: any[], adjustments: any[] = []) {
  let basic = 0, time = 0, adjustment = 0, excluded = 0
  const issues: string[] = []
  const earningCodes = new Set(['RegularHours', 'OTHours', 'OTExtHours', 'NightDiffHours', 'RestDayHours', 'RestDayOTHours', 'LegalHolidayHours', 'LegalHolidayOTHours', 'RestDayLegalHolidayHours', 'RestDayLegalHolidayOTHours', 'SpecialHolidayHours', 'SpecialHolidayOTHours', 'RestDaySpecialHolidayHours', 'RestDaySpecialHolidayOTHours'])
  for (const row of components) {
    const amount = annualCents(row.amount)
    if (!Number.isSafeInteger(amount) || amount < 0) { issues.push('Invalid payroll component amount.'); continue }
    if (row.code === 'RegularHours' && row.direction === 'Earning') basic += amount
    else if (['LateHours', 'UndertimeHours', 'BreakHours'].includes(row.code) && row.direction === 'Deduction') time += amount
    else if (earningCodes.has(row.code) && row.direction === 'Earning') excluded += amount
    else issues.push(`Unclassified payroll component: ${String(row.code)}.`)
  }
  for (const row of adjustments) {
    const amount = annualCents(row.amount)
    if (!Number.isSafeInteger(amount) || amount < 0) { issues.push('Invalid adjustment amount.'); continue }
    let included = row.included
    if (included == null) {
      if (row.code === 'RegularHours' || ['LateHours', 'UndertimeHours', 'BreakHours'].includes(row.code)) included = true
      else if (earningCodes.has(row.code)) included = false
    }
    if (included == null) { issues.push(`Review adjustment #${row.lineId}: ${row.description || 'unclassified amount'}.`); continue }
    if (included) adjustment += amount * (row.direction === 'Deduction' ? -1 : 1)
    else excluded += amount * (row.direction === 'Deduction' ? -1 : 1)
  }
  if (components.length && basic - time < 0) issues.push('Unpaid time exceeds the basic earnings in this payroll source.')
  return { basic: basic / 100, timeDeductions: time / 100, adjustments: adjustment / 100, excluded: excluded / 100, issues }
}

export function annualSummary(sources: AnnualSource[], start: string, end: string, releases: any[] = []) {
  const issues = sources.flatMap(row => row.issues.map(issue => `${row.reference}: ${issue}`))
  const months = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, basic: 0, timeDeductions: 0, adjustments: 0, earned: 0 }))
  let cents = 0
  for (const row of sources) {
    if (row.start < start || row.end > end) issues.push(`${row.reference}: source falls outside the reviewed coverage dates.`)
    if (row.start.slice(0, 7) !== row.end.slice(0, 7)) issues.push(`${row.reference}: split this source by calendar month before approval.`)
    const month = months[Number(row.start.slice(5, 7)) - 1]
    const earned = annualCents(row.basic) - annualCents(row.timeDeductions) + annualCents(row.adjustments)
    cents += earned
    if (month) { month.basic += annualCents(row.basic); month.timeDeductions += annualCents(row.timeDeductions); month.adjustments += annualCents(row.adjustments); month.earned += earned }
  }
  const gaps: { start: string; end: string }[] = []
  if (annualDate(start) && annualDate(end) && start <= end) {
    let gap = ''
    for (let at = new Date(`${start}T00:00:00Z`); at.toISOString().slice(0, 10) <= end; at.setUTCDate(at.getUTCDate() + 1)) {
      const date = at.toISOString().slice(0, 10)
      const covered = sources.some(row => row.kind !== 'Basic adjustment' && row.start <= date && row.end >= date)
      if (!covered && !gap) gap = date
      if (covered && gap) { const previous = new Date(at); previous.setUTCDate(previous.getUTCDate() - 1); gaps.push({ start: gap, end: previous.toISOString().slice(0, 10) }); gap = '' }
    }
    if (gap) gaps.push({ start: gap, end })
  } else issues.push('Select valid coverage dates.')
  const earnedCents = Math.round(cents / 12)
  if (cents < 0) issues.push('Annual basic earnings are negative; review the corrections before approval.')
  const paidCents = releases.filter(row => row.Status === 'Active').reduce((sum, row) => sum + annualCents(row.Amount), 0)
  return { basicEarned: cents / 100, entitlement: earnedCents / 100, paid: paidCents / 100, balance: (earnedCents - paidCents) / 100,
    months: months.map(row => ({ ...row, basic: row.basic / 100, timeDeductions: row.timeDeductions / 100, adjustments: row.adjustments / 100, earned: row.earned / 100 })), gaps, issues: [...new Set(issues)] }
}
