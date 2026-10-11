const test = require('node:test')
const assert = require('node:assert/strict')
const jiti = require('jiti')(__filename)
const { payslipGroups } = jiti('../server/utils/payslipCrud.ts')

test('one cutoff combines reliever site payrolls and totals like-kind adjustments', () => {
  const payrolls = [
    { PayrollID: 1, PeriodStart: '2026-09-16', PeriodEnd: '2026-09-30',
      Status: 'Approved', SiteName: 'Site A', GrossPay: 800, TotalDeduction: 100, NetPay: 700 },
    { PayrollID: 2, PeriodStart: '2026-09-16', PeriodEnd: '2026-09-30',
      Status: 'Approved', SiteName: 'Site B', GrossPay: 900, TotalDeduction: 50, NetPay: 850 },
  ]
  const details = [
    { PayrollID: 1, Description: 'Regular', Quantity: 8, Amount: 800 },
    { PayrollID: 2, Description: 'Regular', Quantity: 4, Amount: 400 },
    { PayrollID: 2, Description: 'Adjustment #9: Regular hours - 2026-09-01', Quantity: 2, Amount: 200 },
    { PayrollID: 2, Description: 'Adjustment #9: Regular hours - 2026-09-02', Quantity: 3, Amount: 300 },
    { PayrollID: 2, Description: 'Loan: Calamity Loan', Quantity: 1, Amount: -50 },
  ]
  const deductions = [{ PayrollID: 1, DeductionName: 'Premium', ClassificationName: 'Pag-ibig', Amount: 100 }]
  const transactions = [{ PayrollID: 2, EntryType: 'Loan', ItemName: 'Calamity Loan',
    ClassificationName: 'Social Security System', Amount: 50 }]
  const [cutoff] = payslipGroups(payrolls, details, deductions, transactions)
  assert.equal(cutoff.sources.length, 2)
  assert.equal(cutoff.gross, 1700)
  assert.equal(cutoff.deductions, 150)
  assert.equal(cutoff.net, 1550)
  assert.deepEqual(cutoff.lines.filter(line => line.section === 'adjustment'), [
    { section: 'adjustment', label: 'Adjustment · Regular hours', hours: 5, amount: 500 },
  ])
  assert.deepEqual(cutoff.lines.filter(line => line.section === 'government').map(line => line.label),
    ['Pag-ibig · Premium', 'SSS · Calamity Loan'])
  assert.equal(cutoff.lines.filter(line => line.label === 'Calamity Loan').length, 0)
})

test('posted late and undertime share one payslip line with actual amounts', () => {
  const [cutoff] = payslipGroups([
    { PayrollID: 3, PeriodStart: '2026-10-01', PeriodEnd: '2026-10-15', Status: 'Approved',
      GrossPay: 1000, TotalDeduction: 87.02, NetPay: 912.98 },
  ], [
    { PayrollID: 3, Description: 'Regular', Quantity: 8, Amount: 1000 },
    { PayrollID: 3, Description: 'Late', Quantity: 0.1, Amount: -0.14 },
    { PayrollID: 3, Description: 'Undertime', Quantity: 1, Amount: -86.88 },
  ], [], [])
  assert.deepEqual(cutoff.lines.filter(line => line.section === 'other'), [
    { section: 'other', label: 'Late / Undertime', hours: 1.1, amount: 87.02 },
  ])
  assert.equal(cutoff.deductions, 87.02)
  assert.equal(cutoff.net, 912.98)
})
