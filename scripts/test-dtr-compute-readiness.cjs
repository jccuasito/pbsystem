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

test('compute rejects worked entries without a shift or imported duty', async () => {
  const { compute, calls } = backend([employee({ UncodedWorkCount: 1 })])
  await assert.rejects(compute(), error => error.statusCode === 409 && /without a shift code/.test(error.message))
  const sql = calls.find(call => call.sql?.includes('UncodedWorkCount')).sql
  assert.match(sql, /LEFT JOIN attendance_duty duty ON duty.AttendanceID = at.AttendanceID/)
  assert.match(sql, /'Absent', 'Rest Day', 'On-Leave', 'Vacation Leave', 'Reliever', 'Sick Leave'/)
  assert.equal(calls.some(call => call.sql?.startsWith('UPDATE attendance_dtr') || call === 'audit'), false)
})

test('a ready roster can compute the second target and record an audit event', async () => {
  const { compute, calls } = backend([employee()])
  const result = await compute()
  assert.equal(result.status, 'Computed to Both')
  assert.ok(calls.some(call => call.sql?.startsWith('UPDATE attendance_dtr')))
  assert.ok(calls.includes('audit'))
  assert.ok(calls.includes('commit'))
})
