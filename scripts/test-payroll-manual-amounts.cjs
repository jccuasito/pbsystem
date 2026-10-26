const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc')
const vue = require('vue')

function evaluate(source, globals) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, ...globals })
  return module.exports
}
const load = (file, requireMock) => evaluate(fs.readFileSync(file, 'utf8'), { require: requireMock })

test('adjustment form and payroll review components compile', () => {
  for (const filename of ['app/components/PayrollAdjustmentsPanel.vue', 'app/components/PayrollProcessingDetailModal.vue', 'app/pages/payroll/processing/index.vue']) {
    const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    for (const style of descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: filename, scoped: style.scoped }).errors, [])
  }
})

test('manual amount form needs only employee, name and amount and sends no stale attendance links', async () => {
  const scope = vue.effectScope(), posted = []
  const source = parse(fs.readFileSync('app/components/PayrollAdjustmentsPanel.vue', 'utf8')).descriptor.scriptSetup.content
  const props = { targetDtr: { BatchID: 2 }, employees: [], initialEmployeeId: null, modal: false }
  const state = scope.run(() => evaluate(source + '\nmodule.exports={form,entryMode,amountName,amountValue,saveRequirement,canSave,save,lineDates,adjustmentLabel};', {
    require: () => ({ ...vue, onMounted() {} }), defineProps: () => props, withDefaults: value => value,
    defineEmits: () => () => {}, defineExpose() {},
    $fetch: async (url, options) => { if (options?.method === 'POST') posted.push(options.body); return { items: [] } },
  }))
  try {
    state.entryMode.value = 'amount'
    state.form.value.EmployeeID = '1'
    state.form.value.SourceBatchID = '99'
    state.form.value.SourceDates = ['2026-09-01']
    assert.equal(state.canSave.value, false)
    state.amountName.value = 'Salary correction - approved difference'
    for (const value of ['', 0, -1, 1.234, Infinity]) {
      state.amountValue.value = value
      assert.equal(state.canSave.value, false)
    }
    state.amountValue.value = '700.25'
    assert.equal(state.canSave.value, true)
    await state.save(true)
    assert.equal(posted.length, 1)
    assert.equal(posted[0].ManualAmount, 700.25)
    assert.equal(posted[0].AdjustmentName, state.amountName.value)
    assert.equal(posted[0].SourceBatchID, null)
    assert.equal(posted[0].SourceDates.length, 0)
    assert.equal(posted[0].ManualDays.length, 0)
    assert.equal(posted[0].Reason, '')
    assert.equal(state.lineDates({ Lines: [{ SourceDate: null }] }), 'Amount only')
    assert.equal(state.adjustmentLabel({ AdjustmentType: 'Manual Amount', Lines: [{ Description: state.amountName.value }] }), state.amountName.value)
    state.entryMode.value = 'saved'
    await vue.nextTick()
    assert.equal(state.canSave.value, false, 'Attendance modes still require an original cutoff and dates')
  } finally { scope.stop() }
})

test('manual amounts validate, approve, post once, appear on payslips, and reopen safely after cancellation', {
  skip: process.env.PAYROLL_AMOUNT_TEST_DATABASE !== '1',
}, async () => {
  const mysql = require('mysql2/promise')
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true })
  try {
    // Every table is shadowed for this connection. No user record is inserted,
    // changed or deleted; closing the connection discards all test tables.
    const [tables] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'")
    for (const row of tables) {
      assert.match(row.TABLE_NAME, /^[a-zA-Z0-9_]+$/)
      const [[definition]] = await db.query('SHOW CREATE TABLE `' + row.TABLE_NAME + '`')
      const sql = definition['Create Table'].replace(/^CREATE TABLE/, 'CREATE TEMPORARY TABLE').split('\n').filter(line => !/^\s*CONSTRAINT/.test(line)).join('\n').replace(/,\s*\n\)/g, '\n)')
      await db.query(sql)
    }
    for (const sql of [
      "INSERT INTO `user` (UserID,FirstName,LastName,Gender,Email,UserType,Status) VALUES (1,'Test','Admin','Prefer not to say','amount-test@example.invalid','Admin','Active')",
      "INSERT INTO agency (AgencyID,AgencyName,Status) VALUES (1,'Test agency','Active')",
      "INSERT INTO `position` (PositionID,PositionName,Status) VALUES (1,'Housekeeping','Active')",
      "INSERT INTO agency_position (AgencyPositionID,AgencyID,PositionID,Status) VALUES (1,1,1,'Active')",
      "INSERT INTO client (ClientID,ClientName,Status) VALUES (1,'Test client','Active')",
      "INSERT INTO site (SiteID,ClientID,SiteName,Status) VALUES (1,1,'Test site','Active')",
      "INSERT INTO payroll_rate (PayrollRateID,AgencyPositionID,RegularRate,EffectiveDate,Status) VALUES (1,1,80,'2026-01-01','Active')",
      "INSERT INTO billing_rate (BillingRateID,AgencyPositionID,RegularRate,EffectiveDate,Status) VALUES (1,1,100,'2026-01-01','Active')",
      "INSERT INTO site_rate (SiteRateID,SiteID,PayrollRateID,BillingRateID,Status) VALUES (1,1,1,1,'Active')",
      "INSERT INTO employee (EmployeeID,AgencyPositionID,FirstName,LastName,Status) VALUES (1,1,'Amount','Employee','Active'),(2,1,'Not','Enrolled','Active')",
      "INSERT INTO employee_deployment (DeploymentID,EmployeeID,SiteRateID,SiteID,DeploymentType,IsPermanentSite,StartDate) VALUES (1,1,1,1,'Regular',1,'2026-01-01')",
      "INSERT INTO attendance_dtr (BatchID,AgencyID,ClientID,SiteID,PeriodStart,PeriodEnd,Status,CreatedBy) VALUES (1,1,1,1,'2026-09-01','2026-09-15','Computed to Payroll',1),(2,1,1,1,'2026-09-16','2026-09-30','Computed to Payroll',1)",
      "INSERT INTO attendance_dtr_employee (BatchID,EmployeeID,DeploymentID,AttendanceType,IsPermanentSite,CreatedBy) VALUES (1,1,1,'Regular',1,1),(2,1,1,'Regular',1,1)",
      "INSERT INTO attendance (AttendanceID,EmployeeID,DeploymentID,BatchID,AttendanceDate,AttendanceStatus,RegularHours,CreatedBy) VALUES (1,1,1,1,'2026-09-10','Present',8,1),(2,1,1,2,'2026-09-20','Present',8,1)",
    ]) await db.query(sql)
    const connection = { execute: (sql, args) => db.execute(sql, args), beginTransaction: () => db.beginTransaction(), commit: () => db.commit(), rollback: () => db.rollback(), release() {} }
    const pool = { execute: connection.execute, getConnection: async () => connection }
    const h3 = { readBody: async e => e.body, getQuery: e => e.query || {}, getRouterParam: (e, key) => e.params[key], createError: details => Object.assign(new Error(details.statusMessage), details) }
    const versions = load('server/utils/rateVersions.ts', name => name.includes('rateFields') ? require('../shared/utils/rateFields.ts') : {})
    const common = name => name === 'h3' ? h3 : name.includes('dbconnect') ? pool : name.endsWith('/auth') ? { requireSession: e => e.session || { sub: 1, userType: 'Admin' } }
      : name.includes('rateVersions') ? versions : name.includes('payrollPreview') ? require('../shared/utils/payrollPreview.ts')
      : name.includes('dtrDeploymentDates') ? require('../server/utils/dtrDeploymentDates.ts')
      : name.includes('dtrWorkflowAudit') ? { recordDtrWorkflowEvent: async () => {} } : {}
    const api = load('server/utils/payrollAdjustmentCrud.ts', common)
    const payroll = load('server/utils/payrollProcessingCrud.ts', common)
    const payslips = load('server/utils/payslipCrud.ts', common)
    const event = (body, extra = {}) => ({ body, params: { id: '2' }, ...extra })
    const body = { EmployeeID: 1, TargetBatchID: 2, ManualAmount: 700.25, AdjustmentName: 'Salary correction - approved difference', Submit: true }
    for (const changes of [{ ManualAmount: 0 }, { ManualAmount: -1 }, { ManualAmount: 1.234 }, { ManualAmount: 'Infinity' }, { ManualAmount: true }, { ManualAmount: 10000000000 }, { AdjustmentName: '' }, { AdjustmentName: 'x'.repeat(101) }, { SourceBatchID: 1 }, { SourceDates: ['2026-09-10'] }]) {
      await assert.rejects(() => api.createPayrollAdjustment(event({ ...body, ...changes })), error => error.statusCode === 400)
    }
    await assert.rejects(() => api.createPayrollAdjustment(event(body, { session: { sub: 1, userType: 'Viewer' } })), /Viewer/)
    await assert.rejects(() => api.createPayrollAdjustment(event({ ...body, EmployeeID: 2 })), /Add the employee/)
    const attendanceBefore = (await db.query('SELECT * FROM attendance ORDER BY AttendanceID'))[0]
    const created = await api.createPayrollAdjustment(event(body))
    assert.equal(created.status, 'For Approval'); assert.equal(created.totalAmount, 700.25)
    const listing = await api.listPayrollAdjustments({ query: { targetBatchId: '2', search: 'approved difference' } })
    assert.equal(listing.items.length, 1)
    const line = listing.items[0].Lines[0]
    assert.equal(listing.items[0].SourceBatchID, null)
    assert.equal(line.SourceDate, null); assert.equal(line.SourceAttendanceID, null)
    assert.equal(line.Description, body.AdjustmentName); assert.equal(line.EntrySource, 'Manual Amount')
    assert.equal(Number(line.Quantity), 1); assert.equal(Number(line.Amount), 700.25)
    assert.equal((await db.query('SELECT COUNT(*) count FROM payroll_adjustment_manual_day'))[0][0].count, 0)
    // Account metadata must resolve the exact site/agency pair, even when another
    // agency is the only retained link for a site.
    await db.query("INSERT INTO agency (AgencyID,AgencyName,Status) VALUES (2,'Other test agency','Active')")
    await db.query("INSERT INTO site_account (SiteAccountID,SiteAccountName,Status) VALUES (1,'Test account','Active'),(2,'Other account','Active')")
    await db.query("INSERT INTO site_agency (SiteID,AgencyID,SiteAccountID,Status) VALUES (1,2,2,'Inactive')")
    const preview = async () => (await payroll.payrollProcessingData('2026-09-16', '2026-09-30', connection)).sites[0]
    assert.equal((await preview()).SiteAccountID, null, 'A different agency link cannot supply the account')
    await db.query("UPDATE site_agency SET AgencyID=1,SiteAccountID=1,Status='Active' WHERE SiteID=1")
    const accountPreview = await preview()
    assert.equal(accountPreview.SiteAccountID, 1)
    assert.equal(accountPreview.SiteAccountName, 'Test account')
    await db.query('UPDATE site_agency SET SiteAccountID=NULL WHERE SiteID=1 AND AgencyID=1')
    assert.equal((await preview()).SiteAccountID, null, 'Unassigned sites cannot borrow another agency account')
    await db.query('UPDATE site_agency SET SiteAccountID=1 WHERE SiteID=1 AND AgencyID=1')
    assert.equal((await preview()).gross, 640, 'Unapproved amounts are excluded')
    assert.ok((await preview()).warningCount > 0)
    await assert.rejects(() => api.updatePayrollAdjustment(event({ AdjustmentID: created.id, Action: 'approve' }, { session: { sub: 1, userType: 'Encoder' } })), /Admin or Supervisor/)
    await api.updatePayrollAdjustment(event({ AdjustmentID: created.id, Action: 'approve' }))
    const reviewed = await preview()
    assert.equal(reviewed.gross, 1340.25); assert.equal(reviewed.netPreview, 1340.25)
    assert.equal(reviewed.employees[0].adjustments[0].hours, 0, 'Flat amounts have no attendance hours')
    assert.equal(reviewed.warningCount, 0)
    await payroll.reviewPayrollProcessing(event({ action: 'finalize' }))
    await db.query("UPDATE site_account SET SiteAccountName='Updated test account' WHERE SiteAccountID=1")
    assert.equal((await preview()).SiteAccountName, 'Updated test account', 'Frozen payroll amounts retain current account grouping metadata')
    await assert.rejects(() => api.createPayrollAdjustment(event(body)), /already finalized/)
    const [[applied]] = await db.query('SELECT Status,TargetPayrollID FROM payroll_adjustment WHERE AdjustmentID=?', [created.id])
    assert.equal(applied.Status, 'Applied'); assert.ok(applied.TargetPayrollID)
    await assert.rejects(() => api.updatePayrollAdjustment(event({ AdjustmentID: created.id, Action: 'cancel' })), /locked/)
    const [[posted]] = await db.query('SELECT * FROM payroll WHERE PayrollID=?', [applied.TargetPayrollID])
    const [details] = await db.query('SELECT * FROM payroll_detail WHERE PayrollID=?', [applied.TargetPayrollID])
    const groups = payslips.payslipGroups([{ ...posted, PeriodStart: '2026-09-16', PeriodEnd: '2026-09-30', AssignmentType: 'Regular' }], details, [], [])
    const named = groups[0].lines.find(line => line.section === 'adjustment')
    assert.ok(named.label.includes(body.AdjustmentName)); assert.equal(named.amount, 700.25); assert.equal(named.hours, 0)
    await assert.rejects(() => payroll.reviewPayrollProcessing(event({ action: 'finalize' })), /already finalized/)
    await payroll.reviewPayrollProcessing(event({ action: 'cancel', reason: 'Correct this test payroll' }))
    assert.equal((await db.query('SELECT Status FROM payroll_adjustment WHERE AdjustmentID=?', [created.id]))[0][0].Status, 'Approved')
    await api.updatePayrollAdjustment(event({ AdjustmentID: created.id, Action: 'cancel' }))
    assert.equal((await preview()).gross, 1340.25, 'Cancelled review retains its historical snapshot')
    await db.query("UPDATE payroll_processing_review SET ReviewStatus='Pending',SnapshotJson=NULL WHERE BatchID=2")
    await db.query("UPDATE attendance_dtr SET Status='Computed to Payroll' WHERE BatchID=2")
    assert.equal((await preview()).gross, 640, 'A fresh review excludes cancelled adjustments')
    const draft = await api.createPayrollAdjustment(event({ ...body, Submit: false }))
    assert.equal(draft.status, 'Draft')
    assert.equal((await api.updatePayrollAdjustment(event({ AdjustmentID: draft.id, Action: 'submit' }))).status, 'For Approval')
    const saved = await api.createPayrollAdjustment(event({ EmployeeID: 1, SourceBatchID: 1, TargetBatchID: 2, SourceDates: ['2026-09-10'], Reason: 'Saved attendance regression', Submit: true }))
    assert.equal(saved.status, 'For Approval'); assert.equal(saved.totalAmount, 640)
    const verified = await api.createPayrollAdjustment(event({ EmployeeID: 1, SourceBatchID: 1, TargetBatchID: 2, ManualDays: [{ SourceDate: '2026-09-11', RegularHours: 8, OTHours: 0, OTExtHours: 0, NightDiffHours: 0 }], Reason: 'Verified attendance regression', Submit: true }))
    assert.equal(verified.status, 'Ready for Payroll'); assert.equal(verified.totalAmount, 640)
    assert.deepEqual((await db.query('SELECT * FROM attendance ORDER BY AttendanceID'))[0], attendanceBefore)
  } finally { await db.end() }
})
