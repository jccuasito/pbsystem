const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const sfc = require('@vue/compiler-sfc')

function evaluate(source, dependencies = {}) {
  const module = { exports: {} }
  vm.runInNewContext(
    transformSync(source, { loader: 'ts', format: 'cjs' }).code,
    { module, require: name => dependencies[name] || {} },
  )
  return module.exports
}

test('employee loan and deduction page compiles with one employee-centered issuance flow', () => {
  const filename = 'app/pages/deductions-loans/employees/index.vue'
  const source = fs.readFileSync(filename, 'utf8')
  const { descriptor, errors } = sfc.parse(source, { filename })
  assert.deepEqual(errors, [])
  const compiled = sfc.compileScript(descriptor, { id: 'employee-loan-deduction-test' })
  assert.deepEqual(sfc.compileTemplate({
    source: descriptor.template.content,
    filename,
    id: 'employee-loan-deduction-test',
    compilerOptions: { bindingMetadata: compiled.bindings },
  }).errors, [])
  for (const style of descriptor.styles) {
    assert.deepEqual(sfc.compileStyle({ source: style.content, filename, id: 'employee-loan-deduction-test', scoped: style.scoped }).errors, [])
  }
  assert.match(descriptor.template.content, /Employee Loans &amp; Deductions/)
  assert.match(descriptor.template.content, /Issuance date/)
  assert.match(descriptor.template.content, /Issuance code/)
  assert.match(descriptor.template.content, /Original value \/ amount received/)
  assert.match(descriptor.template.content, /Repayment starts/)
  assert.match(descriptor.template.content, /Number of periods/)
  assert.match(descriptor.template.content, /Both cutoffs \(every payroll cutoff\)/)
  assert.match(descriptor.template.content, /ModernDateField/)
  assert.match(descriptor.template.content, /Installment per cutoff/)
  assert.match(descriptor.template.content, /View repayment plan/)
  assert.match(descriptor.template.content, /Review repayment plan/)
  assert.match(descriptor.template.content, /Cutoff start/)
  assert.match(descriptor.template.content, /Projected balance/)
  assert.match(descriptor.template.content, /FIFO applies only to repeated issuances of the same catalog entry/)
  assert.match(descriptor.template.content, /Pause this plan/)
  assert.match(descriptor.template.content, /Void issuance/)
  assert.match(descriptor.template.content, /Archive/)
  assert.match(descriptor.template.content, /No active loans or deductions/)
})

test('MySQL issuance CRUD creates loan and deduction history without payroll posting', { skip: process.env.EMPLOYEE_FINANCIAL_TEST_DATABASE !== '1' }, async () => {
  const env = { ...require('node:util').parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
  const connection = await require('mysql2/promise').createConnection({
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD,
    database: env.DB_NAME || 'pbsystem',
    dateStrings: true,
  })
  await connection.beginTransaction()
  try {
    const pool = {
      execute: (...args) => connection.execute(...args),
      getConnection: async () => ({
        execute: (...args) => connection.execute(...args),
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
      }),
    }
    const api = evaluate(fs.readFileSync('server/utils/employeeLoanDeductionCrud.ts', 'utf8'), {
      '../connection/dbconnect': pool,
      './auth': { requireSession: () => ({ sub: 1 }) },
      h3: {
        createError: options => Object.assign(new Error(options.statusMessage), options),
        getQuery: event => event.query || {},
        readBody: async event => event.body,
      },
    })
    const [[employee]] = await connection.execute("SELECT EmployeeID FROM employee WHERE Status = 'Active' ORDER BY EmployeeID LIMIT 1")
    assert.ok(employee, 'An active employee is required for the issuance test.')
    const [[baseline]] = await connection.execute(
      `SELECT
         COALESCE((SELECT SUM(LoanAmount) FROM employee_loan WHERE EmployeeID = ? AND Status <> 'Cancelled'), 0) +
         COALESCE((SELECT SUM(Amount) FROM employee_deduction WHERE EmployeeID = ? AND Status <> 'Inactive'), 0) AS TotalIssued,
         (SELECT COUNT(*) FROM employee_loan WHERE EmployeeID = ? AND Status = 'Active') AS ActiveLoanCount,
         (SELECT COUNT(*) FROM employee_deduction WHERE EmployeeID = ? AND Status = 'Active') AS ActiveDeductionCount`,
      [employee.EmployeeID, employee.EmployeeID, employee.EmployeeID, employee.EmployeeID],
    )
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const [loanClass] = await connection.execute("INSERT INTO deduction_loan_classification (ClassificationName, AppliesTo, Status) VALUES (?, 'Loan', 'Active')", [`TEST LOAN ${suffix}`])
    const [deductionClass] = await connection.execute("INSERT INTO deduction_loan_classification (ClassificationName, AppliesTo, Status) VALUES (?, 'Deduction', 'Active')", [`TEST DEDUCTION ${suffix}`])
    const [loanType] = await connection.execute("INSERT INTO loan_type (LoanName, ClassificationID, Status) VALUES (?, ?, 'Active')", [`TEST LOAN ITEM ${suffix}`, loanClass.insertId])
    const [deductionType] = await connection.execute("INSERT INTO deduction_type (DeductionName, ClassificationID, Status) VALUES (?, ?, 'Active')", [`TEST DEDUCTION ITEM ${suffix}`, deductionClass.insertId])
    const [otherDeductionType] = await connection.execute("INSERT INTO deduction_type (DeductionName, ClassificationID, Status) VALUES (?, ?, 'Active')", [`TEST OTHER DEDUCTION ${suffix}`, deductionClass.insertId])

    const loanCode = `TEST-L-${suffix}`
    const deductionCode = `TEST-D-${suffix}`
    const bothCode = `TEST-B-${suffix}`
    const otherDeductionCode = `TEST-OD-${suffix}`
    const loan = await api.createEmployeeLoanDeduction({ body: { EmployeeID: employee.EmployeeID, EntryType: 'Loan', CatalogItemID: loanType.insertId, IssuanceCode: loanCode, IssuanceDate: '2026-09-01', OriginalAmount: 5000, RepaymentStartDate: '2026-09-01', RepaymentPeriods: 3, RepaymentCutoff: 'Second' } })
    const deduction = await api.createEmployeeLoanDeduction({ body: { EmployeeID: employee.EmployeeID, EntryType: 'Deduction', CatalogItemID: deductionType.insertId, IssuanceCode: deductionCode, IssuanceDate: '2026-09-01', OriginalAmount: 2000, RepaymentStartDate: '2026-09-01', RepaymentPeriods: 4, RepaymentCutoff: 'First', Remarks: 'Test manual issuance' } })
    const both = await api.createEmployeeLoanDeduction({ body: { EmployeeID: employee.EmployeeID, EntryType: 'Loan', CatalogItemID: loanType.insertId, IssuanceCode: bothCode, IssuanceDate: '2026-09-02', OriginalAmount: 1200, RepaymentStartDate: '2026-09-02', RepaymentPeriods: 4, RepaymentCutoff: 'Both' } })
    const otherDeduction = await api.createEmployeeLoanDeduction({ body: { EmployeeID: employee.EmployeeID, EntryType: 'Deduction', CatalogItemID: otherDeductionType.insertId, IssuanceCode: otherDeductionCode, IssuanceDate: '2026-09-02', OriginalAmount: 300, RepaymentStartDate: '2026-09-02', RepaymentPeriods: 1, RepaymentCutoff: 'First' } })
    assert.ok(Number(loan.id) > 0)
    assert.ok(Number(deduction.id) > 0)
    assert.ok(Number(both.id) > 0)
    assert.ok(Number(otherDeduction.id) > 0)
    await assert.rejects(
      api.createEmployeeLoanDeduction({ body: { EmployeeID: employee.EmployeeID, EntryType: 'Deduction', CatalogItemID: deductionType.insertId, IssuanceCode: loanCode, IssuanceDate: '2026-09-03', OriginalAmount: 100, RepaymentStartDate: '2026-09-03', RepaymentPeriods: 1, RepaymentCutoff: 'First' } }),
      error => error.statusCode === 409,
    )

    const detail = await api.listEmployeeLoanDeductions({ query: { employeeId: String(employee.EmployeeID) } })
    const savedLoan = detail.records.find(item => item.EntryType === 'Loan' && item.IssuanceCode === loanCode.toUpperCase())
    const savedDeduction = detail.records.find(item => item.EntryType === 'Deduction' && item.IssuanceCode === deductionCode.toUpperCase())
    const savedBoth = detail.records.find(item => item.EntryType === 'Loan' && item.IssuanceCode === bothCode.toUpperCase())
    const savedOtherDeduction = detail.records.find(item => item.EntryType === 'Deduction' && item.IssuanceCode === otherDeductionCode.toUpperCase())
    assert.equal(Number(savedLoan.OriginalAmount), 5000)
    assert.equal(Number(savedLoan.OutstandingAmount), 5000)
    assert.equal(savedLoan.RepaymentEndDate, '2026-11-30')
    assert.equal(savedLoan.RepaymentCutoff, 'Second')
    assert.equal(Number(savedLoan.InstallmentAmount), 1666.67)
    assert.equal(Number(savedLoan.FinalInstallmentAmount), 1666.66)
    assert.equal(Number(savedLoan.FifoPosition), 1)
    assert.equal(savedDeduction.IssuanceDate, '2026-09-01')
    assert.equal(savedDeduction.Remarks, 'Test manual issuance')
    assert.equal(savedDeduction.RepaymentEndDate, '2026-12-15')
    assert.equal(savedDeduction.RepaymentCutoff, 'First')
    assert.equal(Number(savedDeduction.RepaymentPeriods), 4)
    assert.equal(Number(savedDeduction.InstallmentAmount), 500)
    assert.equal(Number(savedDeduction.OutstandingAmount), 2000)
    assert.equal(Number(savedDeduction.FifoPosition), 1)
    assert.deepEqual(
      JSON.parse(JSON.stringify(savedDeduction.RepaymentSchedule)),
      [
        { Period: 1, CutoffStartDate: '2026-09-01', CutoffEndDate: '2026-09-15', ScheduledAmount: 500, RecordedPaidAmount: 0, ProjectedBalance: 1500, RemainingPeriods: 3, Status: 'Scheduled' },
        { Period: 2, CutoffStartDate: '2026-10-01', CutoffEndDate: '2026-10-15', ScheduledAmount: 500, RecordedPaidAmount: 0, ProjectedBalance: 1000, RemainingPeriods: 2, Status: 'Scheduled' },
        { Period: 3, CutoffStartDate: '2026-11-01', CutoffEndDate: '2026-11-15', ScheduledAmount: 500, RecordedPaidAmount: 0, ProjectedBalance: 500, RemainingPeriods: 1, Status: 'Scheduled' },
        { Period: 4, CutoffStartDate: '2026-12-01', CutoffEndDate: '2026-12-15', ScheduledAmount: 500, RecordedPaidAmount: 0, ProjectedBalance: 0, RemainingPeriods: 0, Status: 'Scheduled' },
      ],
    )
    assert.equal(savedBoth.RepaymentCutoff, 'Both')
    assert.equal(savedBoth.RepaymentEndDate, '2026-10-31')
    assert.equal(Number(savedBoth.FifoPositionFirst), 1)
    assert.equal(Number(savedBoth.FifoPositionSecond), 2)
    assert.equal(Number(savedOtherDeduction.FifoPositionFirst), 1)
    assert.deepEqual(
      JSON.parse(JSON.stringify(savedBoth.RepaymentSchedule)),
      [
        { Period: 1, CutoffStartDate: '2026-09-01', CutoffEndDate: '2026-09-15', ScheduledAmount: 300, RecordedPaidAmount: 0, ProjectedBalance: 900, RemainingPeriods: 3, Status: 'Scheduled' },
        { Period: 2, CutoffStartDate: '2026-09-16', CutoffEndDate: '2026-09-30', ScheduledAmount: 300, RecordedPaidAmount: 0, ProjectedBalance: 600, RemainingPeriods: 2, Status: 'Scheduled' },
        { Period: 3, CutoffStartDate: '2026-10-01', CutoffEndDate: '2026-10-15', ScheduledAmount: 300, RecordedPaidAmount: 0, ProjectedBalance: 300, RemainingPeriods: 1, Status: 'Scheduled' },
        { Period: 4, CutoffStartDate: '2026-10-16', CutoffEndDate: '2026-10-31', ScheduledAmount: 300, RecordedPaidAmount: 0, ProjectedBalance: 0, RemainingPeriods: 0, Status: 'Scheduled' },
      ],
    )

    await api.updateEmployeeLoanDeduction({ body: { EntryType: 'Deduction', RecordID: deduction.id, PlanAction: 'pause', PauseStartDate: '2026-09-16', ResumeDate: '2026-10-01', PauseReason: 'Skip one cutoff' } })
    let [pausedRows] = await connection.execute('SELECT IsPaused, PauseStartDate, ResumeDate, PauseReason FROM employee_deduction WHERE EmployeeDeductionID = ?', [deduction.id])
    assert.equal(Number(pausedRows[0].IsPaused), 1)
    assert.equal(pausedRows[0].ResumeDate, '2026-10-01')
    await api.updateEmployeeLoanDeduction({ body: { EntryType: 'Deduction', RecordID: deduction.id, PlanAction: 'resume' } })
    ;[pausedRows] = await connection.execute('SELECT IsPaused, ResumeDate FROM employee_deduction WHERE EmployeeDeductionID = ?', [deduction.id])
    assert.equal(Number(pausedRows[0].IsPaused), 0)
    assert.equal(pausedRows[0].ResumeDate, null)

    await api.updateEmployeeLoanDeduction({ body: { EntryType: 'Deduction', RecordID: deduction.id, Status: 'Inactive' } })
    const [voidedRows] = await connection.execute('SELECT Status, RemainingBalance FROM employee_deduction WHERE EmployeeDeductionID = ?', [deduction.id])
    assert.equal(voidedRows[0].Status, 'Inactive')
    assert.equal(Number(voidedRows[0].RemainingBalance), 0)

    await api.updateEmployeeLoanDeduction({ body: { EntryType: 'Loan', RecordID: loan.id, Status: 'Paid' } })
    const [updatedRows] = await connection.execute('SELECT Status, RemainingBalance FROM employee_loan WHERE LoanID = ?', [loan.id])
    assert.equal(updatedRows[0].Status, 'Paid')
    assert.equal(Number(updatedRows[0].RemainingBalance), 0)
    const employeeList = await api.listEmployeeLoanDeductions({ query: { search: String(employee.EmployeeID), pageSize: '100' } })
    const employeeSummary = employeeList.items.find(item => Number(item.EmployeeID) === Number(employee.EmployeeID))
    assert.ok(employeeSummary)
    assert.equal(Number(employeeSummary.TotalIssued), Number(baseline.TotalIssued) + 6500)
    assert.equal(Number(employeeSummary.ActiveLoanCount), Number(baseline.ActiveLoanCount) + 1)
    assert.equal(Number(employeeSummary.ActiveDeductionCount), Number(baseline.ActiveDeductionCount) + 1)
    const [payrollRows] = await connection.execute('SELECT COUNT(*) AS count FROM payroll_deduction WHERE ReferenceType = ? AND ReferenceID IN (?, ?, ?, ?)', ['Employee issuance test', loan.id, deduction.id, both.id, otherDeduction.id])
    assert.equal(Number(payrollRows[0].count), 0)
  } finally {
    await connection.rollback()
    await connection.end()
  }
})
