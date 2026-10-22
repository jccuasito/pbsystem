const test = require('node:test')
const assert = require('node:assert/strict')
const { btrRegularAllocation, combinedLateUndertimeLines, componentAmountCents, fixedDeductionBatchByEmployee, payrollDeductionHours, payrollTimeDeductions, previewInstallment, previewRecurringDeduction, selectCutoffAllowances } = require('../shared/utils/payrollPreview.ts')

test('automatic break is paid through net DTR hours without a second monetary deduction', () => {
  // Nine hours on site less a 60-minute break already leaves eight paid hours.
  const day = { RegularHours: 8, BreakHours: 1, LateHours: 0.25, UndertimeHours: 0.5 }
  const rate = { RegularRate: 80, BreakDeduction: 80, LateDeduction: 80, UndertimeDeduction: 80 }
  const deductions = policy => payrollTimeDeductions.reduce((sum, [hours, field]) =>
    sum + componentAmountCents(payrollDeductionHours(hours, day, policy), rate[field]), 0)
  assert.equal(componentAmountCents(day.RegularHours, rate.RegularRate) - deductions({ AutoBreakEnabled: 1 }), 58000)
  assert.equal(deductions({ AutoBreakEnabled: '1' }), 6000)
  // A manual-break site still charges its configured break amount.
  assert.equal(deductions({ AutoBreakEnabled: 0 }), 14000)
  assert.equal(deductions({}), 14000)
  assert.equal(day.BreakHours, 1)
  assert.equal(day.RegularHours, 8)
})

test('review display combines late and undertime without changing either deduction', () => {
  const lines = combinedLateUndertimeLines([
    { code: 'LateHours', label: 'Late', direction: 'Deduction', hours: 0.1, amount: 0.14 },
    { code: 'UndertimeHours', label: 'Undertime', direction: 'Deduction', hours: 1, amount: 86.88 },
    { code: 'BreakHours', label: 'Break', direction: 'Deduction', hours: 0.5, amount: 43.44 },
  ])
  assert.deepEqual(lines.map(line => [line.label, line.hours, line.amount]), [
    ['Late / Undertime', 1.1, 87.02], ['Break', 0.5, 43.44],
  ])
})

test('daily components use their configured amount and keep cent precision', () => {
  const days = [
    { date: '2026-09-24', hours: 8, rate: 70 },
    { date: '2026-09-25', hours: 8, rate: 75 },
  ]
  assert.equal(days.reduce((sum, day) => sum + componentAmountCents(day.hours, day.rate), 0), 116000)
  assert.equal(componentAmountCents(1.25, 72.5), 9063)
})

test('BTR coverage reduces only available REST regular hours and reports excess', () => {
  const firstRestDay = btrRegularAllocation(8, 1)
  const secondRestDay = btrRegularAllocation(8, 1)
  assert.equal(firstRestDay.remainingHours + secondRestDay.remainingHours, 14)
  assert.equal(firstRestDay.uncoveredHours, 0)
  assert.deepEqual(btrRegularAllocation(0, 1), { remainingHours: 0, uncoveredHours: 1 })
  assert.deepEqual(btrRegularAllocation(0.75, 1), { remainingHours: 0, uncoveredHours: 0.25 })
})

test('loan and deduction plans follow only the fixed-site DTR', () => {
  const selected = fixedDeductionBatchByEmployee([
    { EmployeeID: 1, BatchID: 10, IsPermanentSite: 1, AttendanceType: 'Regular' },
    { EmployeeID: 1, BatchID: 11, IsPermanentSite: 0, AttendanceType: 'Reliever' },
    { EmployeeID: 2, BatchID: 11, IsPermanentSite: 0, AttendanceType: 'Reliever' },
  ], [
    { EmployeeID: 1, BatchID: 10 },
    { EmployeeID: 1, BatchID: 11 }, { EmployeeID: 1, BatchID: 11 },
  ])
  assert.equal(selected.get(1), 10)
  assert.equal(selected.has(2), false)
})

test('flat allowance is assigned once to the fixed site using the latest worked rate', () => {
  const assignments = selectCutoffAllowances([
    { employeeId: 1, batchId: 20, fixedSite: false, workDate: '2026-09-30', sequence: 1, amountCents: 90000 },
    { employeeId: 1, batchId: 10, fixedSite: true, workDate: '2026-09-20', sequence: 2, amountCents: 60000 },
    { employeeId: 1, batchId: 10, fixedSite: true, workDate: '2026-09-25', sequence: 3, amountCents: 70000 },
    { employeeId: 2, batchId: 30, fixedSite: false, workDate: '2026-09-20', sequence: 4, amountCents: 20000 },
    { employeeId: 2, batchId: 31, fixedSite: false, workDate: '2026-09-25', sequence: 5, amountCents: 30000 },
  ])
  assert.deepEqual([assignments.get(1)?.batchId, assignments.get(1)?.amountCents], [10, 70000])
  assert.deepEqual([assignments.get(2)?.batchId, assignments.get(2)?.amountCents], [31, 30000])
})

test('installment is due only for its cutoff, effective dates, and remaining balance', () => {
  const account = {
    Status: 'Active', RepaymentStartDate: '2026-09-16', EndDate: '2026-12-31',
    RepaymentCutoff: 'Second', RemainingBalance: 300, InstallmentAmount: 500,
    IsPaused: 0, PauseStartDate: null, ResumeDate: null,
  }
  assert.equal(previewInstallment(account, '2026-09-01', '2026-09-15'), 0)
  assert.equal(previewInstallment(account, '2026-09-16', '2026-09-30'), 30000)
  assert.equal(previewInstallment({ ...account, IsPaused: 1 }, '2026-09-16', '2026-09-30'), 0)
  assert.equal(previewInstallment({ ...account, IsPaused: 1, PauseStartDate: '2026-10-01' }, '2026-09-16', '2026-09-30'), 30000)
  assert.equal(previewInstallment({ ...account, IsPaused: 1, PauseStartDate: '2026-09-16', ResumeDate: '2026-10-01' }, '2026-09-16', '2026-09-30'), 0)
  assert.equal(previewInstallment({ ...account, IsPaused: 1, PauseStartDate: '2026-09-16', ResumeDate: '2026-09-16' }, '2026-09-16', '2026-09-30'), 30000)
  assert.equal(previewInstallment({ ...account, Status: 'Paid' }, '2026-09-16', '2026-09-30'), 0)
  assert.equal(previewInstallment({ ...account, EndDate: '2026-09-30' }, '2026-10-16', '2026-10-31'), 30000)
})

test('monthly distribution runs every second cutoff and honors pause/resume dates', () => {
  const plan = { Status: 'Active', EffectiveStartDate: '2026-09-01', EffectiveEndDate: null,
    DeductOn: 'Second', AmountPerCutoff: 125.5, IsPaused: 0, PauseStartDate: null, ResumeDate: null }
  assert.equal(previewRecurringDeduction(plan, '2026-09-01', '2026-09-15'), 0)
  assert.equal(previewRecurringDeduction(plan, '2026-09-16', '2026-09-30'), 12550)
  assert.equal(previewRecurringDeduction(plan, '2026-10-16', '2026-10-31'), 12550)
  assert.equal(previewRecurringDeduction({ ...plan, IsPaused: 1, PauseStartDate: '2026-10-16' }, '2026-10-16', '2026-10-31'), 0)
  assert.equal(previewRecurringDeduction({ ...plan, IsPaused: 1, PauseStartDate: '2026-10-16', ResumeDate: '2026-11-16' }, '2026-11-16', '2026-11-30'), 12550)
})
