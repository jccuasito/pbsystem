const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc')

function evaluate(source, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, require: () => ({}), ...globals })
  return module.exports
}

test('employee status leave sheet and DTR workspace compile with synchronized statuses', () => {
  for (const filename of ['app/pages/employees/status/index.vue', 'app/components/DtrAttendanceWorkspace.vue']) {
    const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    for (const style of descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: filename, scoped: style.scoped }).errors, [])
  }
  const page = fs.readFileSync('app/pages/employees/status/index.vue', 'utf8')
  assert.match(page, /class="status-grid"/)
  assert.match(page, /class="employee-table"/)
  assert.match(page, /Employee status sheet/)
  assert.doesNotMatch(page, /\+ Add cutoff/)
  assert.match(page, /Click to add/)
  assert.match(page, /openStatusCell/)
  assert.doesNotMatch(page, /Transfer to site|Site transfer/)
  const dtr = fs.readFileSync('app/components/DtrAttendanceWorkspace.vue', 'utf8')
  for (const status of ['Absent', 'Late', 'Half-Day', 'On-Leave', 'Vacation Leave', 'Holiday', 'Rest Day', 'Reliever', 'Sick Leave']) assert.match(dtr, new RegExp(status))
  const statusCrud = fs.readFileSync('server/utils/employeeStatusCrud.ts', 'utf8')
  assert.match(statusCrud, /\['On-Leave', 'Vacation Leave', 'Sick Leave'\]/)
  assert.match(dtr, /dateWithinDeployment/)
  const dtrCrud = fs.readFileSync('server/utils/dtrCrud.ts', 'utf8')
  assert.match(dtrCrud, /attachPendingEmployeeStatuses\(connection, batch, createdBy\)/)
  assert.match(dtrCrud, /employeeStatusLeaveStatuses\.has\(normalizeAttendanceStatus\(current\.AttendanceStatus\)\)/)
  assert.match(dtrCrud, /SELECT COUNT\(\*\) FROM attendance_dtr_employee roster WHERE roster\.BatchID = d\.BatchID/)
  const statusRules = evaluate(fs.readFileSync('shared/utils/dtrAttendanceStatus.ts', 'utf8'))
  assert.equal(statusRules.automaticDtrAttendanceStatus({ AttendanceStatus: 'Late' }, 8), 'Late')
  assert.equal(statusRules.automaticDtrAttendanceStatus({ AttendanceStatus: 'Half-Day' }, 8), 'Half-Day')
  assert.equal(statusRules.automaticDtrAttendanceStatus({ AttendanceStatus: 'Vacation Leave' }, 8), 'Vacation Leave')
})

test('status can be saved before a DTR, attaches later, and never duplicates a date', { skip: process.env.EMPLOYEE_STATUS_TEST_DATABASE !== '1' }, async () => {
  const mysql = require('mysql2/promise')
  const env = { ...require('util').parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
  const c = await mysql.createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306), user: env.DB_USER || 'root', password: env.DB_PASSWORD, database: env.DB_NAME || 'pbsystem', dateStrings: true })
  try {
    const tables = {
      employee: 'EmployeeID INT PRIMARY KEY, EmployeeNumber VARCHAR(30), AgencyPositionID INT, FirstName VARCHAR(50), MiddleName VARCHAR(50), LastName VARCHAR(50), Status VARCHAR(20)',
      agency_position: 'AgencyPositionID INT PRIMARY KEY, AgencyID INT, PositionID INT',
      agency: 'AgencyID INT PRIMARY KEY, AgencyName VARCHAR(100)',
      position: 'PositionID INT PRIMARY KEY, PositionName VARCHAR(100)',
      payroll_rate: 'PayrollRateID INT PRIMARY KEY, AgencyPositionID INT, Status VARCHAR(20)',
      site_rate: 'SiteRateID INT PRIMARY KEY, SiteID INT, PayrollRateID INT, Status VARCHAR(20)',
      client: 'ClientID INT PRIMARY KEY, ClientName VARCHAR(100), Status VARCHAR(20)',
      site: 'SiteID INT PRIMARY KEY, ClientID INT, SiteName VARCHAR(100), Status VARCHAR(20)',
      employee_deployment: 'DeploymentID INT AUTO_INCREMENT PRIMARY KEY, EmployeeID INT, SiteRateID INT, SiteID INT, DeploymentType VARCHAR(20), IsPermanentSite TINYINT, StartDate DATE, EndDate DATE',
      attendance_dtr: 'BatchID INT PRIMARY KEY, AgencyID INT, ClientID INT, SiteID INT, PeriodStart DATE, PeriodEnd DATE, Status VARCHAR(30)',
      attendance_dtr_employee: 'BatchID INT, EmployeeID INT, DeploymentID INT, AttendanceType VARCHAR(20), IsPermanentSite TINYINT, CreatedBy INT, PRIMARY KEY(BatchID,EmployeeID)',
      attendance: `AttendanceID INT AUTO_INCREMENT PRIMARY KEY, EmployeeID INT, DeploymentID INT, BatchID INT NULL, AttendanceDate DATE, ShiftCodeID INT, TimeIn DATETIME, TimeOut DATETIME, AttendanceStatus VARCHAR(30), AttendanceType VARCHAR(20), IsWDO TINYINT DEFAULT 0, IsManualEdit TINYINT DEFAULT 0, Remarks VARCHAR(255), CreatedBy INT, UpdatedBy INT,
        RegularHours DECIMAL(8,2) DEFAULT 0, OTHours DECIMAL(8,2) DEFAULT 0, OTExtHours DECIMAL(8,2) DEFAULT 0, NightDiffHours DECIMAL(8,2) DEFAULT 0, RestDayHours DECIMAL(8,2) DEFAULT 0, RestDayOTHours DECIMAL(8,2) DEFAULT 0, LegalHolidayHours DECIMAL(8,2) DEFAULT 0, LegalHolidayOTHours DECIMAL(8,2) DEFAULT 0, RestDayLegalHolidayHours DECIMAL(8,2) DEFAULT 0, RestDayLegalHolidayOTHours DECIMAL(8,2) DEFAULT 0, SpecialHolidayHours DECIMAL(8,2) DEFAULT 0, SpecialHolidayOTHours DECIMAL(8,2) DEFAULT 0, RestDaySpecialHolidayHours DECIMAL(8,2) DEFAULT 0, RestDaySpecialHolidayOTHours DECIMAL(8,2) DEFAULT 0, LateHours DECIMAL(8,2) DEFAULT 0, UndertimeHours DECIMAL(8,2) DEFAULT 0, BreakHours DECIMAL(8,2) DEFAULT 0, HolidayID INT, UNIQUE(EmployeeID,AttendanceDate)`,
      attendance_duty: 'AttendanceDutyID INT AUTO_INCREMENT PRIMARY KEY, AttendanceID INT',
    }
    for (const [name, columns] of Object.entries(tables)) await c.query(`CREATE TEMPORARY TABLE \`${name}\` (${columns}) ENGINE=InnoDB`)
    await c.query("INSERT INTO employee VALUES (8,'DJA-0001',11,'John','Doe','Example','Active')")
    await c.query('INSERT INTO agency_position VALUES (11,3,4)')
    await c.query("INSERT INTO agency VALUES (3,'DJA Security Services INC.')")
    await c.query("INSERT INTO position VALUES (4,'Security Guard')")
    await c.query("INSERT INTO payroll_rate VALUES (21,11,'Active')")
    await c.query("INSERT INTO site_rate VALUES (31,51,21,'Active')")
    await c.query("INSERT INTO client VALUES (41,'Samsung','Active')")
    await c.query("INSERT INTO site VALUES (51,41,'Samsung S.E.P.C.O','Active')")
    await c.query("INSERT INTO employee_deployment (EmployeeID,SiteRateID,SiteID,DeploymentType,IsPermanentSite,StartDate) VALUES (8,31,51,'Regular',1,'2026-09-01')")
    const connection = { execute: (sql, args) => c.execute(sql, args), beginTransaction: () => c.beginTransaction(), commit: () => c.commit(), rollback: () => c.rollback(), release() {} }
    const pool = { execute: (sql, args) => c.execute(sql, args), getConnection: async () => connection }
    const api = evaluate(fs.readFileSync('server/utils/employeeStatusCrud.ts', 'utf8'), { require: name => name === 'h3' ? { readBody: async event => event.body, createError: details => Object.assign(new Error(details.statusMessage), details) } : name.includes('dbconnect') ? pool : name === './auth' ? { requireSession: () => ({ sub: 14 }) } : {} })

    const range = { EmployeeID: 8, AttendanceStatus: 'Sick Leave', StartDate: '2026-09-24', EndDate: '2026-09-26', Remarks: 'Medical certificate to follow' }
    const first = await api.updateEmployeeDailyStatus({ body: range })
    assert.equal(first.created, 3)
    assert.equal(first.pending, 3)
    const [pending] = await c.query('SELECT BatchID,AttendanceStatus FROM attendance ORDER BY AttendanceDate')
    assert.ok(pending.every(row => row.BatchID === null && row.AttendanceStatus === 'Sick Leave'))

    await c.query("INSERT INTO attendance_dtr VALUES (71,3,41,51,'2026-09-16','2026-09-30','Draft')")
    await c.query("INSERT INTO attendance_dtr_employee VALUES (71,8,1,'Regular',1,14)")
    const attached = await api.attachPendingEmployeeStatuses(connection, { BatchID: 71, AgencyID: 3, ClientID: 41, SiteID: 51, PeriodStart: '2026-09-16', PeriodEnd: '2026-09-30', Status: 'Draft' }, 14)
    assert.equal(attached, 3)
    assert.equal((await c.query('SELECT COUNT(*) count FROM attendance WHERE BatchID=71'))[0][0].count, 3)

    const second = await api.updateEmployeeDailyStatus({ body: { ...range, AttendanceStatus: 'Vacation Leave' } })
    assert.equal(second.created, 0)
    assert.equal(second.updated, 3)
    assert.equal((await c.query('SELECT COUNT(*) count FROM attendance'))[0][0].count, 3)
    assert.ok((await c.query('SELECT AttendanceStatus FROM attendance'))[0].every(row => row.AttendanceStatus === 'Vacation Leave'))
    await assert.rejects(() => api.updateEmployeeDailyStatus({ body: { ...range, AttendanceStatus: 'Present' } }), /Select a valid attendance status/)
    await c.query("UPDATE attendance SET AttendanceStatus='Late' WHERE EmployeeID=8 AND AttendanceDate='2026-09-26'")
    const listed = await api.listEmployeeStatus({})
    assert.equal(listed.employees.length, 1)
    assert.equal(listed.cutoffs.length, 1)
    assert.equal(listed.dtrCutoffs.length, 1)
    assert.equal(listed.history.length, 3)
    assert.equal(listed.history[0].AttendanceStatus, 'Late')
  } finally {
    await c.end()
  }
})
