// A review calculation only. These are configured component amounts, not statutory multipliers.
export const payrollHourComponents = [
  ['RegularHours', 'RegularRate', 'Regular'],
  ['OTHours', 'OTRate', 'OT'],
  ['OTExtHours', 'OTExtRate', 'OT extension'],
  ['NightDiffHours', 'NightDiffRate', 'Night diff'],
  ['RestDayHours', 'RestDayRate', 'WDO / Rest day'],
  ['RestDayOTHours', 'RestDayOTRate', 'WDO / Rest day OT'],
  ['LegalHolidayHours', 'LegalHolidayRate', 'Legal holiday'],
  ['LegalHolidayOTHours', 'LegalHolidayOTRate', 'Legal holiday OT'],
  ['RestDayLegalHolidayHours', 'LegalHolidayRate', 'Rest day legal holiday'],
  ['RestDayLegalHolidayOTHours', 'LegalHolidayOTRate', 'Rest day legal holiday OT'],
  ['SpecialHolidayHours', 'SpecialHolidayRate', 'Special holiday'],
  ['SpecialHolidayOTHours', 'SpecialHolidayOTRate', 'Special holiday OT'],
  ['RestDaySpecialHolidayHours', 'SpecialHolidayRate', 'Rest day special holiday'],
  ['RestDaySpecialHolidayOTHours', 'SpecialHolidayOTRate', 'Rest day special holiday OT'],
] as const

export const payrollTimeDeductions = [
  ['LateHours', 'LateDeduction', 'Late'],
  ['UndertimeHours', 'UndertimeDeduction', 'Undertime'],
  ['BreakHours', 'BreakDeduction', 'Break'],
] as const

export function moneyCents(value: unknown) {
  return Math.round(Number(value || 0) * 100)
}

export function componentAmountCents(hours: unknown, rate: unknown) {
  return Math.round(Number(hours || 0) * Number(rate || 0) * 100)
}

export function fixedDeductionBatchByEmployee(roster: any[], attendance: any[]) {
  const counts = new Map<string, number>()
  for (const row of attendance) {
    const key = `${row.EmployeeID}:${row.BatchID}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const selected = new Map<number, number>()
  for (const person of roster) {
    if (!Number(person.IsPermanentSite) || person.AttendanceType === 'Reliever') continue
    const employeeId = Number(person.EmployeeID)
    const batchId = Number(person.BatchID)
    const prior = selected.get(employeeId)
    if (!prior || (counts.get(`${employeeId}:${batchId}`) || 0) > (counts.get(`${employeeId}:${prior}`) || 0)) {
      selected.set(employeeId, batchId)
    }
  }
  return selected
}

export function previewInstallment(account: any, periodStart: string, periodEnd: string) {
  const cutoff = Number(periodStart.slice(8, 10)) <= 15 ? 'First' : 'Second'
  const date = String(account.RepaymentStartDate || '')
  if (account.Status !== 'Active' || !date || date > periodEnd ||
      (account.RepaymentCutoff !== cutoff && account.RepaymentCutoff !== 'Both') ||
      (account.EndDate && String(account.EndDate) < periodStart) ||
      // A scheduled pause applies only once its start date has arrived. A
      // resume on or before the cutoff start makes the whole cutoff payable.
      (Number(account.IsPaused) && String(account.PauseStartDate || '') <= periodEnd &&
        (!account.ResumeDate || String(account.ResumeDate) > periodStart))) return 0
  const balance = moneyCents(account.RemainingBalance)
  return Math.max(0, Math.min(balance, moneyCents(account.InstallmentAmount)))
}
