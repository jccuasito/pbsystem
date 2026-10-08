const test = require('node:test')
const assert = require('node:assert/strict')
const { componentAmountCents, previewInstallment } = require('../shared/utils/payrollPreview.ts')

test('daily components use their configured amount and keep cent precision', () => {
  const days = [
    { date: '2026-09-24', hours: 8, rate: 70 },
    { date: '2026-09-25', hours: 8, rate: 75 },
  ]
  assert.equal(days.reduce((sum, day) => sum + componentAmountCents(day.hours, day.rate), 0), 116000)
  assert.equal(componentAmountCents(1.25, 72.5), 9063)
})

test('installment is due only for its cutoff, effective dates, and remaining balance', () => {
  const account = {
    Status: 'Active', RepaymentStartDate: '2026-09-16', EndDate: '2026-12-31',
    RepaymentCutoff: 'Second', RemainingBalance: 300, InstallmentAmount: 500,
    IsPaused: 0, ResumeDate: null,
  }
  assert.equal(previewInstallment(account, '2026-09-01', '2026-09-15'), 0)
  assert.equal(previewInstallment(account, '2026-09-16', '2026-09-30'), 30000)
  assert.equal(previewInstallment({ ...account, IsPaused: 1 }, '2026-09-16', '2026-09-30'), 0)
  assert.equal(previewInstallment({ ...account, Status: 'Paid' }, '2026-09-16', '2026-09-30'), 0)
})
