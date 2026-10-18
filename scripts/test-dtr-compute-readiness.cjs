const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')

const source = fs.readFileSync('server/utils/dtrCrud.ts', 'utf8')

function backend(roster) {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push('begin') },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    release() { calls.push('release') },
    async execute(sql, args) {
      calls.push({ sql, args })
      if (sql.startsWith('SELECT BatchID, AgencyID, SiteID, PeriodStart, PeriodEnd, Status FROM attendance_dtr')) {
        return [[{ BatchID: 79, AgencyID: 1, SiteID: 1, PeriodStart: '2026-09-16', PeriodEnd: '2026-09-30', Status: 'Computed to Payroll' }]]
      }
      if (sql.includes('COUNT(DISTINCT at.AttendanceID) AS AttendanceCount')) return [roster]
      if (sql.startsWith('UPDATE attendance_dtr SET Status')) return [{ affectedRows: 1 }]
      throw new Error('Unexpected query: ' + sql)
    },
  }
  const moduleState = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    module: moduleState,
    require: name => name === 'h3'
      ? { createError: details => Object.assign(new Error(details.statusMessage), details), getRouterParam: () => '79', readBody: async () => ({ target: 'billing' }) }
      : name.includes('dbconnect') ? { getConnection: async () => connection }
        : name === './auth' ? { requireSession: () => ({ sub: 1 }) }
          : name === './dtrWorkflowAudit' ? { recordDtrWorkflowEvent: async () => { calls.push('audit') } }
            : {},
  })
  return { compute: () => moduleState.exports.computeDtr({}), calls }
}

const employee = (overrides = {}) => ({ EmployeeID: 4, EmployeeNumber: 'EMP-0004', EmployeeName: 'Test Employee', AttendanceCount: 1, UncodedWorkCount: 0, ...overrides })

test('compute rejects an empty DTR roster without writing status or audit history', async () => {
  const { compute, calls } = backend([])
  await assert.rejects(compute(), error => error.statusCode === 409 && /Add at least one employee/.test(error.message))
  assert.deepEqual(calls.slice(-2), ['rollback', 'release'])
  assert.equal(calls.some(call => call.sql?.startsWith('UPDATE attendance_dtr') || call === 'audit'), false)
})

test('compute rejects when one enrolled employee has no saved cutoff attendance', async () => {
  const { compute, calls } = backend([employee(), employee({ EmployeeID: 5, EmployeeNumber: 'EMP-0005', AttendanceCount: 0 })])
  await assert.rejects(compute(), error => error.statusCode === 409 && /EMP-0005/.test(error.message) && /no saved attendance/.test(error.message))
  assert.equal(calls.some(call => call.sql?.startsWith('UPDATE attendance_dtr') || call === 'audit'), false)
})

test('compute identifies the exact dates missing a shift, even when the employee has attendance', async () => {
  const { compute, calls } = backend([employee({ AttendanceCount: 15, UncodedWorkCount: 1, UncodedWorkDates: '2026-09-30' })])
  await assert.rejects(compute(), error => error.statusCode === 409 && /without a shift code/.test(error.message) && /EMP-0004: 2026-09-30/.test(error.message))
  const sql = calls.find(call => call.sql?.includes('UncodedWorkCount')).sql
  assert.match(sql, /LEFT JOIN attendance_duty duty ON duty.AttendanceID = at.AttendanceID/)
  assert.match(sql, /'Absent', 'Rest Day', 'On-Leave', 'Vacation Leave', 'Reliever', 'Sick Leave'/)
  assert.equal(calls.some(call => call.sql?.startsWith('UPDATE attendance_dtr') || call === 'audit'), false)
})

test('a site with only one ready employee can compute and record an audit event', async () => {
  const { compute, calls } = backend([employee()])
  const result = await compute()
  assert.equal(result.status, 'Computed to Both')
  assert.ok(calls.some(call => call.sql?.startsWith('UPDATE attendance_dtr')))
  assert.ok(calls.includes('audit'))
  assert.ok(calls.includes('commit'))
})

function saveBackend({ status = 'Present', shiftCodeId = null, importedDuties = false } = {}) {
  const calls = []
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() { calls.push('rollback') }, release() {},
    async execute(sql) {
      calls.push(sql)
      if (sql.includes('FROM attendance_dtr WHERE')) return [[{ BatchID: 79, AgencyID: 2, SiteID: 2, PeriodStart: '2026-09-16', PeriodEnd: '2026-09-30', Status: 'Draft' }]]
      if (sql.includes('FROM site s')) return [[]]
      if (sql.startsWith('SELECT DeploymentID, AttendanceType')) return [[{ DeploymentID: 30, AttendanceType: 'Regular' }]]
      if (sql.startsWith('SELECT EmployeeID FROM employee')) return [[{ EmployeeID: 13 }]]
      if (sql.startsWith('SELECT ShiftCodeID, ShiftType')) return [[{ ShiftCodeID: 3, ShiftType: 'DS', TimeIn: '07:00:00', TimeOut: '19:00:00' }]]
      if (sql.includes('FROM holiday WHERE') || sql.startsWith('SELECT HolidayID FROM site_special_holiday')) return [[]]
      if (sql.startsWith('SELECT AttendanceID, BatchID, AttendanceStatus')) return [[{ AttendanceID: 1823, BatchID: 79, AttendanceStatus: 'Present', HasImportedDuty: Number(importedDuties) }]]
      if (sql.includes('FROM attendance at LEFT JOIN attendance_dtr')) throw new Error('Reached overlap validation')
      throw new Error('Unexpected query: ' + sql)
    },
  }
  const moduleState = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    module: moduleState,
    require: name => name === 'h3'
      ? { createError: details => Object.assign(new Error(details.statusMessage), details), getRouterParam: () => '79', readBody: async () => ({ EmployeeID: 13, AttendanceDate: '2026-09-30', AttendanceStatus: status, ShiftCodeID: shiftCodeId, TimeIn: '2026-09-30 07:00', TimeOut: '2026-09-30 19:00', RegularHours: 8, OTHours: 4 }) }
      : name.includes('dbconnect') ? { getConnection: async () => connection }
        : name === './auth' ? { requireSession: () => ({ sub: 1 }) }
          : name.includes('attendanceStatuses') ? { attendanceStatuses: ['Present', 'Absent', 'Reliever'] } : {},
  })
  return { save: () => moduleState.exports.createDtrAttendance({}), calls }
}

test('saving ordinary worked attendance requires a shift immediately', async () => {
  const { save, calls } = saveBackend()
  await assert.rejects(save(), error => error.statusCode === 400 && /Select a shift code for 2026-09-30/.test(error.message))
  assert.equal(calls.some(sql => /^(INSERT|UPDATE|DELETE) /.test(sql)), false)
})

test('coded work, consolidated imported duties and no-work statuses retain their save paths', async () => {
  for (const options of [{ shiftCodeId: 3 }, { importedDuties: true }, { status: 'Absent' }, { status: 'Reliever' }]) {
    const { save } = saveBackend(options)
    await assert.rejects(save(), error => error.message === 'Reached overlap validation')
  }
})
