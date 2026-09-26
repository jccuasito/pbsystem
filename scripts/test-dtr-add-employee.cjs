const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const vue = require('vue')
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc')

function evaluate(source, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, require: () => ({}), ...globals })
  return module.exports
}
const alerts = evaluate(fs.readFileSync('components/alertmessage/messages.ts', 'utf8'))
const conflict = error => error.statusCode === 409 && error.data.code === alerts.DTR_EMPLOYEE_ALREADY_ADDED
const request = (batch = 5, overrides = {}) => ({ id: batch, body: { EmployeeID: 2, DeploymentType: 'Regular', IsPermanentSite: false, ...overrides } })

function backend({ enrolled = false, insertConflict = false } = {}) {
  const enrollments = new Map(enrolled ? [['5:2', { type: 'Reliever', permanent: 1, deployment: 30 }]] : [])
  const calls = []
  const connection = {
    async beginTransaction() { calls.push('begin') },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    release() { calls.push('release') },
    async execute(sql, args) {
      calls.push({ sql, args })
      if (sql.includes('FROM attendance_dtr WHERE')) return [[{ BatchID: args[0], AgencyID: 1, ClientID: 1, SiteID: 1, PeriodStart: '2026-08-16', PeriodEnd: '2026-08-31', Status: 'Draft' }]]
      if (sql.startsWith('SELECT EmployeeID FROM attendance_dtr_employee')) return [enrollments.has(args.join(':')) ? [{ EmployeeID: args[1] }] : []]
      if (sql.includes('SELECT sr.SiteRateID')) return [[{ SiteRateID: 1 }]]
      if (sql.startsWith('SELECT DeploymentID FROM employee_deployment')) return [[{ DeploymentID: 30 }]]
      if (sql.startsWith('INSERT INTO attendance_dtr_employee')) {
        if (insertConflict || enrollments.has(args.slice(0, 2).join(':'))) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' })
        enrollments.set(args.slice(0, 2).join(':'), { type: args[3], permanent: args[4], deployment: args[2] })
        return [{ affectedRows: 1 }]
      }
      throw new Error('Unexpected query: ' + sql)
    },
  }
  const api = evaluate(fs.readFileSync('server/utils/dtrCrud.ts', 'utf8'), {
    require: name => name === 'h3' ? { createError: details => Object.assign(new Error(details.statusMessage), details), getRouterParam: event => event.id, readBody: async event => event.body } :
      name.includes('dbconnect') ? { getConnection: async () => connection } : name === './auth' ? { requireSession: () => ({ sub: 1 }) } : name.endsWith('/messages') ? alerts : {},
  })
  return { api, calls, enrollments }
}

test('repeat Add rejects before deployment/rate changes and preserves saved type and permanent flag', async () => {
  const h = backend({ enrolled: true })
  await assert.rejects(h.api.addDtrEmployee(request()), conflict)
  assert.deepEqual(h.enrollments.get('5:2'), { type: 'Reliever', permanent: 1, deployment: 30 })
  assert.equal(h.calls.filter(c => c.sql).length, 2)
  assert.ok(h.calls.find(c => c.sql?.includes('FROM attendance_dtr WHERE')).sql.endsWith('FOR UPDATE'))
  assert.deepEqual(h.calls.slice(-2), ['rollback', 'release'])
})

test('new enrollment is added once; retry cannot change it; same employee can join another cutoff', async () => {
  const h = backend()
  assert.equal((await h.api.addDtrEmployee(request())).success, true)
  await assert.rejects(h.api.addDtrEmployee(request(5, { IsPermanentSite: true, DeploymentType: 'Reliever' })), conflict)
  assert.deepEqual(h.enrollments.get('5:2'), { type: 'Regular', permanent: 0, deployment: 30 })
  assert.equal((await h.api.addDtrEmployee(request(10))).success, true)
  assert.equal(h.enrollments.size, 2)
})

test('concurrent enrollment at insert returns the same conflict and rolls back', async () => {
  const h = backend({ insertConflict: true })
  await assert.rejects(h.api.addDtrEmployee(request()), conflict)
  assert.ok(!h.calls.includes('commit'))
  assert.deepEqual(h.calls.slice(-2), ['rollback', 'release'])
})

const filename = 'app/components/DtrAttendanceWorkspace.vue'
const descriptor = parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor
function frontend(fetch) {
  const scope = vue.effectScope()
  const state = scope.run(() => evaluate(descriptor.scriptSetup.content + '\nmodule.exports={rows,employeeAlert,saving,addEmployee,employeeAlreadyAdded};', {
    ...vue, onMounted() {}, defineProps: () => ({ dtr: { BatchID: 5 } }), defineEmits: () => () => {},
    require: name => name.endsWith('/messages') ? alerts : {}, $fetch: fetch,
  }))
  return { state, close: () => scope.stop() }
}

test('known enrollment from table or candidate flag shows a notice without posting', async () => {
  let requests = 0
  const h = frontend(async () => { requests++; return {} })
  try {
    h.state.rows.value = [{ EmployeeID: 2 }]
    await h.state.addEmployee({ EmployeeID: '2', EmployeeName: 'John' })
    h.state.rows.value = []
    await h.state.addEmployee({ EmployeeID: 3, EmployeeName: 'Jane', IsAdded: '1' })
    assert.equal(requests, 0)
    assert.equal(h.state.employeeAlert.value.title, 'Already added to this DTR')
    assert.match(h.state.employeeAlert.value.message, /Jane/)
  } finally { h.close() }
})

test('stale client receives duplicate alert, marks candidate added, and refreshes enrollment', async () => {
  let posts = 0
  const h = frontend(async (url, options) => {
    if (options?.method === 'POST') { posts++; throw { data: { data: { code: alerts.DTR_EMPLOYEE_ALREADY_ADDED } } } }
    return { records: [{ EmployeeID: 2 }] }
  })
  try {
    const employee = { EmployeeID: 2, EmployeeName: 'John' }
    await h.state.addEmployee(employee)
    await h.state.addEmployee(employee)
    assert.equal(posts, 1)
    assert.equal(employee.IsAdded, 1)
    assert.equal(h.state.rows.value.length, 1)
    assert.equal(h.state.employeeAlert.value.tone, 'info')
  } finally { h.close() }
})

test('rapid double-click sends one request and reports success after save', async () => {
  let finish, posts = 0
  const h = frontend(async (url, options) => {
    if (options?.method === 'POST') { posts++; await new Promise(resolve => { finish = resolve }) }
    return { records: [{ EmployeeID: 2 }] }
  })
  try {
    const employee = { EmployeeID: 2, EmployeeName: 'John' }
    const first = h.state.addEmployee(employee)
    await h.state.addEmployee(employee)
    assert.equal(posts, 1)
    finish(); await first
    assert.equal(employee.IsAdded, 1)
    assert.equal(h.state.employeeAlert.value.tone, 'success')
    assert.equal(h.state.saving.value, false)
  } finally { h.close() }
})

test('failed save keeps candidate available and displays error, not success', async () => {
  const h = frontend(async () => { throw { data: { statusMessage: 'No matching site rate.' } } })
  try {
    const employee = { EmployeeID: 2, EmployeeName: 'John' }
    await h.state.addEmployee(employee)
    assert.equal(h.state.employeeAlreadyAdded(employee), false)
    assert.equal(h.state.employeeAlert.value.message, 'No matching site rate.')
    assert.equal(h.state.employeeAlert.value.tone, 'error')
    assert.equal(h.state.saving.value, false)
  } finally { h.close() }
})

test('workspace and shared alert compile including every style block', () => {
  for (const file of [filename, 'components/alertmessage/SystemAlert.vue']) {
    const result = parse(fs.readFileSync(file, 'utf8'), { filename: file })
    assert.deepEqual(result.errors, [])
    const script = compileScript(result.descriptor, { id: 'alert-test' })
    assert.deepEqual(compileTemplate({ source: result.descriptor.template.content, filename: file, id: 'alert-test', compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    for (const style of result.descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename: file, id: 'alert-test', scoped: style.scoped }).errors, [])
  }
})
