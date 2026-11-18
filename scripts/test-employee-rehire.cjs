const { test } = require('node:test')
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
const { transformSync } = require('esbuild')
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc')
function evaluate(file, resolver) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module, require: resolver, Date, Intl, Buffer, process })
  return module.exports
}
test('rehire modal and updated employee list compile', () => {
  for (const filename of ['app/components/EmployeeRehireModal.vue', 'app/pages/employees/index.vue']) {
    const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename }); assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    for (const style of descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: filename, scoped: style.scoped }).errors, [])
  }
})

test('real SQL rehire retains identity and financial history across same/different agency returns', { skip: process.env.EMPLOYEE_REHIRE_TEST_DATABASE !== '1' }, async () => {
  const env = { ...require('node:util').parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST || '127.0.0.1'), 'Local tests only')
  const db = await require('mysql2/promise').createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306), user: env.DB_USER || 'root', password: env.DB_PASSWORD, database: env.DB_NAME || 'pbsystem', dateStrings: true })
  try {
    // Shadow all tables on this connection. No real employee or financial row is changed.
    const [tables] = await db.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'")
    for (const { TABLE_NAME: table } of tables) {
      assert.match(table, /^[a-zA-Z0-9_]+$/)
      const [[definition]] = await db.query('SHOW CREATE TABLE `' + table + '`')
      await db.query(definition['Create Table'].replace(/^CREATE TABLE/, 'CREATE TEMPORARY TABLE').split('\n').filter(line => !/^\s*CONSTRAINT/.test(line)).join('\n').replace(/,\s*\n\)/g, '\n)'))
    }
    for (const sql of [
      "INSERT INTO `user` (UserID,FirstName,LastName,Gender,Email,UserType,Status) VALUES(1,'Test','Admin','Male','rehire-test@example.invalid','Admin','Active')",
      "INSERT INTO agency(AgencyID,AgencyName,Status) VALUES(1,'Old agency','Active'),(2,'New agency','Active'),(3,'Inactive agency','Inactive')",
      "INSERT INTO `position`(PositionID,PositionName,Status) VALUES(1,'Guard','Active'),(2,'Supervisor','Active')",
      "INSERT INTO agency_position(AgencyPositionID,AgencyID,PositionID,Status) VALUES(1,1,1,'Active'),(2,1,2,'Active'),(3,2,1,'Active'),(4,3,1,'Active')",
      "INSERT INTO employee(EmployeeID,AgencyPositionID,EmployeeNumber,FirstName,LastName,DateHired,ResignationDate,Status) VALUES(1,1,'TEST-1','Returning','Employee','2020-01-01','2026-09-30','Inactive'),(2,1,'TEST-2','Legacy','Employee','2020-01-01',NULL,'Inactive'),(3,1,'TEST-3','Conflict','Employee','2020-01-01','2026-09-30','Inactive')",
      "INSERT INTO client(ClientID,ClientName,Status) VALUES(1,'Test client','Active')",
      "INSERT INTO site(SiteID,ClientID,SiteName,Status) VALUES(1,1,'Old site','Active'),(2,1,'Return site','Active')",
      "INSERT INTO payroll_rate(PayrollRateID,AgencyPositionID,RegularRate,EffectiveDate,Status) VALUES(1,1,80,'2020-01-01','Active'),(2,3,100,'2020-01-01','Active')",
      "INSERT INTO site_rate(SiteRateID,SiteID,PayrollRateID,Status) VALUES(1,1,1,'Active'),(2,2,2,'Active')",
      "INSERT INTO employee_deployment(DeploymentID,EmployeeID,SiteRateID,SiteID,DeploymentType,IsPermanentSite,StartDate) VALUES(1,1,1,1,'Regular',1,'2020-01-01'),(3,3,1,1,'Regular',1,'2020-01-01')",
      "INSERT INTO attendance(AttendanceID,EmployeeID,DeploymentID,AttendanceDate,AttendanceStatus,RegularHours,CreatedBy) VALUES(1,1,1,'2026-09-10','Present',8,1)",
      "INSERT INTO payroll(PayrollID,EmployeeID,DeploymentID,PayrollType,StartDate,EndDate,PayrollDate,GrossPay,TotalDeduction,NetPay,Status) VALUES(1,1,1,'Regular','2026-09-01','2026-09-30','2026-09-30',640,0,640,'Approved')",
    ]) await db.query(sql)
    await db.query("INSERT INTO employee_portal_account(AccountID,EmployeeID,Email,ContactNumber,PasswordHash,AgreementVersion,Status) VALUES(1,1,'portal-rehire@example.invalid','00000000000','synthetic-hash','test','Active')")
    await db.query("INSERT INTO employee_portal_session(TokenHash,AccountID,ExpiresAt) VALUES(REPEAT('a',64),1,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY))")
    let failAudit = false
    const connection = {
      execute(sql, args) { if (failAudit && sql.startsWith('INSERT INTO employee_rehire')) throw Error('Synthetic audit failure'); return db.execute(sql, args) },
      beginTransaction: () => db.beginTransaction(), commit: () => db.commit(), rollback: () => db.rollback(), release() {}
    }
    const pool = { execute: connection.execute, getConnection: async () => connection }
    const h3 = { createError: details => Object.assign(new Error(details.statusMessage), details), getRouterParam: (event, key) => event.params[key], getQuery: event => event.query || {}, readBody: async event => event.body }
    const cache = new Map()
    function resolver(name) {
      if (name === 'h3') return h3
      if (name.includes('dbconnect')) return pool
      if (name.endsWith('/auth')) return { requireSession(event) { if (!event.session) throw h3.createError({ statusCode: 401, statusMessage: 'Sign in required.' }); return event.session } }
      if (name.startsWith('.')) {
        const resolved = name.includes('shared/') || name.includes('components/') ? path.resolve('server/utils', name) : path.resolve('server/utils', name)
        const filename = [resolved, resolved + '.ts', resolved + '.mjs'].find(file => fs.existsSync(file))
        if (filename) { if (!cache.has(filename)) cache.set(filename, evaluate(filename, resolver)); return cache.get(filename) }
      }
      return require(name)
    }
    const api = evaluate('server/utils/employeeRehireCrud.ts', resolver)
    const resign = evaluate('server/utils/employeeResignation.ts', resolver)
    const statuses = evaluate('server/utils/employeeStatusCrud.ts', resolver)
    const positions = evaluate('server/utils/employeePositionCrud.ts', resolver)
    const dtr = evaluate('server/utils/dtrCrud.ts', resolver)
    const deploymentDates = evaluate('server/utils/dtrDeploymentDates.ts', resolver)
    const event = (id, body, extra = {}) => ({ params: { id: String(id) }, body, context: { moduleCanEdit: true }, session: { sub: 1, userType: 'Admin' }, ...extra })
    const first = { ExpectedAgencyPositionID: 1, ExpectedResignationDate: '2026-09-30', ExpectedLastRehireDate: null, AgencyPositionID: 2, RehireDate: '2026-10-10', Reason: 'Confirmed return to same agency' }
    for (const [change, status] of [[{ RehireDate: '2026-09-30' },400],[{ RehireDate: '2099-01-01' },400],[{ RehireDate: '2026-02-30' },400],[{ AgencyPositionID: 4 },400],[{ ExpectedAgencyPositionID: 2 },409],[{ ExpectedResignationDate: null },409],[{ Reason: '' },400]]) {
      await assert.rejects(api.rehireEmployee(event(1, { ...first, ...change })), e => e.statusCode === status)
    }
    await assert.rejects(api.rehireEmployee(event(1, first, { session: null })), e => e.statusCode === 401)
    await assert.rejects(api.rehireEmployee(event(1, first, { session: { sub: 1, userType: 'Viewer' } })), e => e.statusCode === 403)
    await assert.rejects(api.rehireEmployee(event(1, first, { context: { moduleCanEdit: false } })), e => e.statusCode === 403)
    assert.equal((await api.employeeEmploymentHistory(event(1, null, { session: { sub: 1, userType: 'Viewer' } }))).permissions.canRehire, false)
    const financialSnapshot = async () => JSON.stringify([(await db.query('SELECT * FROM attendance ORDER BY AttendanceID'))[0],(await db.query('SELECT * FROM payroll ORDER BY PayrollID'))[0]])
    const prior = await financialSnapshot()
    assert.equal((await api.rehireEmployee(event(1, first))).EmployeeID, 1)
    let [[employee]] = await db.query('SELECT * FROM employee WHERE EmployeeID=1')
    assert.equal(employee.EmployeeNumber, 'TEST-1'); assert.equal(employee.DateHired, '2020-01-01'); assert.equal(employee.AgencyPositionID, 2)
    assert.equal((await db.query('SELECT COUNT(*) count FROM employee_portal_session'))[0][0].count, 0)
    assert.equal((await db.query('SELECT Status FROM employee_portal_account WHERE AccountID=1'))[0][0].Status, 'Active')
    assert.equal(employee.Status, 'Active'); assert.equal(employee.LastRehireDate, '2026-10-10'); assert.equal(employee.ResignationDate, null)
    assert.equal((await db.query('SELECT EndDate FROM employee_deployment WHERE DeploymentID=1'))[0][0].EndDate, '2026-09-30')
    assert.equal(await financialSnapshot(), prior)
    await assert.rejects(api.rehireEmployee(event(1, first)), e => e.statusCode === 409)
    // Resigning again cannot erase the current period by dating it before the return.
    await db.beginTransaction()
    await assert.rejects(resign.recordEmployeeResignation(connection, 1, '2026-10-01', 1), e => e.statusCode === 400)
    await db.rollback()
    await db.beginTransaction(); await resign.recordEmployeeResignation(connection, 1, '2026-10-20', 1); await db.commit()
    const second = { ...first, ExpectedAgencyPositionID: 2, ExpectedResignationDate: '2026-10-20', ExpectedLastRehireDate: '2026-10-10', AgencyPositionID: 3, RehireDate: '2026-11-10', Reason: 'Confirmed return under another agency' }
    await api.rehireEmployee(event(1, second))
    const history = await api.employeeEmploymentHistory(event(1, null))
    assert.equal(history.history.length, 2); assert.equal(history.history[0].PreviousStartDate, '2026-10-10')
    assert.equal(history.history[0].ResignationDate, '2026-10-20'); assert.equal(history.history[0].AgencyName, 'New agency')
    assert.equal(history.history[1].PreviousAgencyName, 'Old agency'); assert.equal(history.permissions.canRehire, false)
    assert.equal(await financialSnapshot(), prior)
    await assert.rejects(statuses.updateEmployeeDailyStatus(event(1, { EmployeeID: 1, StartDate: '2026-11-01', AttendanceStatus: 'Present' })), /latest return date/)
    await assert.rejects(positions.changeEmployeePosition(event(1, { AgencyPositionID: 1, ExpectedAgencyPositionID: 3, EffectiveDate: '2026-11-01', Reason: 'Invalid earlier position' })), /latest return date/)
    // A new DTR in the return cutoff starts this employee's new post on November 10.
    await db.query("INSERT INTO attendance_dtr(BatchID,AgencyID,ClientID,SiteID,PeriodStart,PeriodEnd,Status,CreatedBy) VALUES(1,2,1,2,'2026-11-01','2026-11-15','Draft',1),(2,2,1,2,'2026-10-16','2026-10-31','Draft',1)")
    await assert.rejects(dtr.addDtrEmployee(event(2, { EmployeeID: 1, DeploymentType: 'Regular', IsPermanentSite: true })), /before the employee return date/)
    const added = await dtr.addDtrEmployee(event(1, { EmployeeID: 1, DeploymentType: 'Regular', IsPermanentSite: true }))
    assert.equal((await db.execute('SELECT StartDate FROM employee_deployment WHERE DeploymentID=?',[added.deploymentId]))[0][0].StartDate, '2026-11-10')
    const enrollment = { EmployeeID: 1, DeploymentID: added.deploymentId }
    assert.equal(await deploymentDates.dtrDeploymentAtDate(connection, enrollment, 1, '2026-11-05'), null)
    assert.equal((await deploymentDates.dtrDeploymentAtDate(connection, enrollment, 1, '2026-11-10')).DeploymentID, added.deploymentId)
    assert.equal(await financialSnapshot(), prior)
    // Legacy unknown resignation requires an explicit confirmed date; no date is guessed.
    const legacy = { ...first, ExpectedResignationDate: null, AgencyPositionID: 1 }
    await assert.rejects(api.rehireEmployee(event(2, legacy)), /Confirm the previous resignation date/)
    await api.rehireEmployee(event(2, { ...legacy, ResignationDate: '2026-09-30' }))
    assert.equal((await api.employeeEmploymentHistory(event(2, null))).history[0].ResignationDate, '2026-09-30')
    await db.query("INSERT INTO attendance_dtr(BatchID,AgencyID,ClientID,SiteID,PeriodStart,PeriodEnd,Status,CreatedBy) VALUES(3,1,1,1,'2026-10-01','2026-10-15','Draft',1)")
    const reliever = await dtr.addDtrEmployee(event(3, { EmployeeID: 2, DeploymentType: 'Reliever', IsPermanentSite: false }))
    const relieverEnrollment = { EmployeeID: 2, DeploymentID: reliever.deploymentId }
    assert.equal(await deploymentDates.dtrDeploymentAtDate(connection, relieverEnrollment, 2, '2026-10-05'), null)
    assert.equal((await deploymentDates.dtrDeploymentAtDate(connection, relieverEnrollment, 2, '2026-10-10')).DeploymentID, reliever.deploymentId)
    // A failed audit insert rolls back the closed deployment and status together.
    const beforeFailure = JSON.stringify((await db.query('SELECT * FROM employee_deployment WHERE EmployeeID=3'))[0])
    failAudit = true
    await assert.rejects(api.rehireEmployee(event(3, first)), /Synthetic audit failure/)
    failAudit = false
    assert.equal((await db.query('SELECT Status FROM employee WHERE EmployeeID=3'))[0][0].Status, 'Inactive')
    assert.equal(JSON.stringify((await db.query('SELECT * FROM employee_deployment WHERE EmployeeID=3'))[0]), beforeFailure)
    assert.equal((await db.query('SELECT COUNT(*) count FROM employee_rehire WHERE EmployeeID=3'))[0][0].count, 0)
    // Conflicting work after resignation is retained and blocks the return.
    await db.query("INSERT INTO attendance(EmployeeID,DeploymentID,AttendanceDate,AttendanceStatus,RegularHours,CreatedBy) VALUES(3,3,'2026-10-02','Present',8,1)")
    await assert.rejects(api.rehireEmployee(event(3, first)), /Attendance exists after/)
    assert.equal((await db.query('SELECT Status FROM employee WHERE EmployeeID=3'))[0][0].Status, 'Inactive')
    await db.query('DELETE FROM attendance WHERE EmployeeID=3')
    const conflictCases = [
      ["INSERT INTO payroll(EmployeeID,DeploymentID,PayrollType,StartDate,EndDate,PayrollDate,GrossPay,TotalDeduction,NetPay,Status) VALUES(3,3,'Regular','2026-10-01','2026-10-15','2026-10-15',0,0,0,'Approved')", /Payroll already covers/, 'DELETE FROM payroll WHERE EmployeeID=3'],
      ["INSERT INTO employee_deployment(EmployeeID,SiteRateID,SiteID,DeploymentType,StartDate) VALUES(3,1,1,'Regular','2026-10-01')", /later deployment exists/, "DELETE FROM employee_deployment WHERE EmployeeID=3 AND StartDate='2026-10-01'"],
      ["INSERT INTO attendance_dtr_btr(BatchID,AttendanceDate,ReplacedEmployeeID,RelieverEmployeeID,Hours,CreatedBy) VALUES(3,'2026-10-02',3,2,8,1)", /Active BTR coverage/, 'DELETE FROM attendance_dtr_btr WHERE ReplacedEmployeeID=3'],
      ["INSERT INTO attendance_dtr_employee(BatchID,EmployeeID,DeploymentID,AttendanceType,IsPermanentSite,CreatedBy) VALUES(3,3,3,'Regular',1,1)", /DTR roster overlaps/, 'DELETE FROM attendance_dtr_employee WHERE EmployeeID=3'],
      ["INSERT INTO employee_position_change(EmployeeID,OldAgencyPositionID,NewAgencyPositionID,EffectiveDate,Reason,CreatedBy) VALUES(3,1,2,'2026-10-10','Synthetic later change',1)", /Position history conflicts/, 'DELETE FROM employee_position_change WHERE EmployeeID=3'],
    ]
    for (const [insert, message, remove] of conflictCases) {
      await db.query(insert)
      await assert.rejects(api.rehireEmployee(event(3, first)), message)
      await db.query(remove)
      assert.equal((await db.query('SELECT Status FROM employee WHERE EmployeeID=3'))[0][0].Status, 'Inactive')
    }
    // Next-day same-agency return cannot reopen the previous period's adjacent fixed post.
    await api.rehireEmployee(event(3, { ...first, AgencyPositionID: 1, RehireDate: '2026-10-01' }))
    await db.query("INSERT INTO attendance_dtr(BatchID,AgencyID,ClientID,SiteID,PeriodStart,PeriodEnd,Status,CreatedBy) VALUES(4,1,1,1,'2026-10-01','2026-10-15','Draft',1)")
    const adjacent = await dtr.addDtrEmployee(event(4, { EmployeeID: 3, DeploymentType: 'Regular', IsPermanentSite: true }))
    assert.notEqual(adjacent.deploymentId, 3)
    assert.equal((await db.query('SELECT EndDate FROM employee_deployment WHERE DeploymentID=3'))[0][0].EndDate, '2026-09-30')
    assert.equal((await db.execute('SELECT StartDate FROM employee_deployment WHERE DeploymentID=?',[adjacent.deploymentId]))[0][0].StartDate, '2026-10-01')
  } finally { await db.end() }
})
