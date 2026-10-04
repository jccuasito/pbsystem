const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')

function backend(execute) {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push('begin') },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    release() { calls.push('release') },
    async execute(sql, args) { calls.push({ sql, args }); return execute(sql, args) },
  }
  const module = { exports: {} }
  const source = fs.readFileSync('server/utils/dtrCrud.ts', 'utf8') + '\nmodule.exports.promoteForTest = promoteDtrEmployeeToPermanentSite;'
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    module,
    require: name => name === 'h3' ? {
      createError: details => Object.assign(new Error(details.statusMessage), details),
      getRouterParam: event => event.id,
    } : name.includes('dbconnect') ? { getConnection: async () => connection }
      : name === './auth' ? { requireSession: () => ({ sub: 1 }) }
        : name === './employeeStatusCrud.ts' ? { employeeStatusAttendanceStatuses: ['On-Leave', 'Vacation Leave', 'Sick Leave'] } : {},
  })
  return { api: module.exports, calls, connection }
}

test('deleting a draft removes only its unshared DTR-created fixed history', async () => {
  const h = backend((sql, args) => {
    if (sql.includes('SELECT Status, PeriodStart, PeriodEnd FROM attendance_dtr')) return [[{ Status: 'Draft', PeriodStart: '2026-08-16', PeriodEnd: '2026-08-31' }]]
    if (sql.includes('SELECT ed.DeploymentID')) return [[{ DeploymentID: 40 }]]
    if (sql.startsWith('UPDATE attendance SET BatchID = NULL')) return [{ affectedRows: 2 }]
    if (sql.startsWith('DELETE FROM attendance')) return [{ affectedRows: 12 }]
    if (sql.startsWith('DELETE FROM attendance_dtr')) return [{ affectedRows: 1 }]
    if (sql.startsWith('UPDATE employee_deployment ed')) return [{ affectedRows: 1 }]
    throw new Error('Unexpected query: ' + sql)
  })
  const result = await h.api.deleteDtr({ id: '5' })
  assert.equal(result.removedDtrCreatedDeployments, 1)
  assert.deepEqual(h.calls.slice(-2), ['commit', 'release'])
  const candidate = h.calls.find(call => call.sql?.includes('SELECT ed.DeploymentID'))
  assert.match(candidate.sql, /ed\.Remarks IN \('Created from DTR attendance assignment', 'Set as permanent from DTR assignment'\)/)
  assert.match(candidate.sql, /DATE\(ed\.StartDate\) = DATE\(\?\)/)
  const cleanup = h.calls.find(call => call.sql?.startsWith('UPDATE employee_deployment ed'))
  assert.match(cleanup.sql, /NOT EXISTS \(SELECT 1 FROM attendance_dtr_employee/)
  assert.match(cleanup.sql, /NOT EXISTS \(SELECT 1 FROM attendance at/)
  assert.deepEqual(Array.from(cleanup.args), ['2026-08-31', 40])
})

test('a backdated fixed assignment ends before the next original deployment', async () => {
  const h = backend((sql, args) => {
    if (sql.includes('SELECT sr.SiteRateID')) return [[{ SiteRateID: 7 }]]
    if (sql.includes('SELECT DeploymentID FROM employee_deployment') && sql.includes('SiteID <> ?')) return [[]]
    if (sql.includes('SELECT StartDate FROM employee_deployment')) return [[{ StartDate: '2026-09-01' }]]
    if (sql.includes('SELECT DeploymentID FROM employee_deployment')) return [[]]
    if (sql.startsWith('UPDATE employee_deployment')) return [{ affectedRows: 0 }]
    if (sql.startsWith('INSERT INTO employee_deployment')) return [{ insertId: 40 }]
    throw new Error('Unexpected query: ' + sql)
  })
  const id = await h.api.promoteForTest(h.connection, { AgencyID: 1, SiteID: 4, PeriodStart: '2026-08-16', PeriodEnd: '2026-08-31' }, 10, 'Regular', null, 1)
  assert.equal(id, 40)
  const insert = h.calls.find(call => call.sql?.startsWith('INSERT INTO employee_deployment'))
  assert.match(insert.sql, /DATE_SUB\(\?, INTERVAL 1 DAY\)/)
  assert.deepEqual(Array.from(insert.args).slice(-3), ['2026-09-01', '2026-09-01', 1])
})

test('a later original deployment inside the same cutoff blocks a conflicting fixed assignment', async () => {
  const h = backend((sql) => {
    if (sql.includes('SELECT sr.SiteRateID')) return [[{ SiteRateID: 7 }]]
    if (sql.includes('SELECT DeploymentID FROM employee_deployment') && sql.includes('SiteID <> ?')) return [[]]
    if (sql.includes('SELECT StartDate FROM employee_deployment')) return [[{ StartDate: '2026-08-25' }]]
    throw new Error('Unexpected query: ' + sql)
  })
  await assert.rejects(
    h.api.promoteForTest(h.connection, { AgencyID: 1, SiteID: 4, PeriodStart: '2026-08-16', PeriodEnd: '2026-08-31' }, 10, 'Regular', null, 1),
    error => error.statusCode === 409,
  )
  assert.equal(h.calls.some(call => call.sql?.startsWith('INSERT INTO employee_deployment')), false)
})

test('a DTR cannot replace an original fixed deployment at another site', async () => {
  const h = backend((sql) => {
    if (sql.includes('SELECT sr.SiteRateID')) return [[{ SiteRateID: 7 }]]
    if (sql.includes('SELECT DeploymentID FROM employee_deployment') && sql.includes('SiteID <> ?')) return [[{ DeploymentID: 32 }]]
    throw new Error('Unexpected query: ' + sql)
  })
  await assert.rejects(
    h.api.promoteForTest(h.connection, { AgencyID: 1, SiteID: 4, PeriodStart: '2026-09-01', PeriodEnd: '2026-09-15' }, 10, 'Regular', null, 1),
    error => error.statusCode === 409,
  )
  assert.equal(h.calls.some(call => call.sql?.startsWith('UPDATE employee_deployment')), false)
})
