const test = require('node:test')
const assert = require('node:assert/strict')
const { componentAmountCents, fixedDeductionBatchByEmployee, previewInstallment, previewRecurringDeduction } = require('../shared/utils/payrollPreview.ts')

test('daily components use their configured amount and keep cent precision', () => {
  const days = [
    { date: '2026-09-24', hours: 8, rate: 70 },
    { date: '2026-09-25', hours: 8, rate: 75 },
  ]
  assert.equal(days.reduce((sum, day) => sum + componentAmountCents(day.hours, day.rate), 0), 116000)
  assert.equal(componentAmountCents(1.25, 72.5), 9063)
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
