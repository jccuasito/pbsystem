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
const request = (batch = 5, overrides = {}) => ({ id: batch, body: { EmployeeID: 2, DeploymentType: 'Reliever', IsPermanentSite: false, ...overrides } })

function backend({ enrolled = false, insertConflict = false, initialEnrollment = { type: 'Reliever', permanent: 1, deployment: 30 } } = {}) {
  const enrollments = new Map(enrolled ? [['5:2', { ...initialEnrollment }]] : [])
  const calls = []
  const connection = {
    async beginTransaction() { calls.push('begin') },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    release() { calls.push('release') },
    async execute(sql, args) {
      calls.push({ sql, args })
      if (sql.includes('FROM attendance_dtr WHERE')) return [[{ BatchID: args[0], AgencyID: 1, ClientID: 1, SiteID: 1, PeriodStart: '2026-08-16', PeriodEnd: '2026-08-31', Status: 'Draft' }]]
      if (sql.startsWith('SELECT DeploymentID, AttendanceType, IsPermanentSite FROM attendance_dtr_employee')) {
        const saved = enrollments.get(args.join(':'))
        return [saved ? [{ DeploymentID: saved.deployment, AttendanceType: saved.type, IsPermanentSite: saved.permanent }] : []]
      }
      if (sql.startsWith('SELECT EmployeeID FROM attendance_dtr_employee')) return [enrollments.has(args.join(':')) ? [{ EmployeeID: args[1] }] : []]
      if (sql.includes('SELECT sr.SiteRateID')) return [[{ SiteRateID: 1 }]]
      if (sql.includes('FROM employee_deployment') && sql.includes('SiteRateID = ? AND SiteID = ? AND IsPermanentSite = 1')) return [[{ DeploymentID: 30 }]]
      if (sql.startsWith('SELECT DeploymentID FROM employee_deployment') && sql.includes('IsPermanentSite = 1')) return [[]]
      if (sql.startsWith('SELECT StartDate FROM employee_deployment')) return [[]]
      if (sql.startsWith('SELECT DeploymentID FROM employee_deployment')) return [[{ DeploymentID: 30 }]]
      if (sql.startsWith('SELECT DeploymentID, StartDate, Remarks FROM employee_deployment')) return [[{ DeploymentID: 30, StartDate: '2026-08-16', Remarks: 'Created from DTR attendance assignment' }]]
      if (sql.startsWith('UPDATE attendance_dtr_employee SET DeploymentID')) { const saved = enrollments.get(args.slice(1).join(':')); saved.deployment = args[0]; saved.permanent = 1; return [{ affectedRows: 1 }] }
      if (sql.startsWith('UPDATE attendance_dtr_employee SET IsPermanentSite')) { enrollments.get(args.join(':')).permanent = 0; return [{ affectedRows: 1 }] }
      if (sql.startsWith('UPDATE attendance_dtr_employee SET AttendanceType')) { enrollments.get(args.slice(1).join(':')).type = args[0]; return [{ affectedRows: 1 }] }
      if (sql.startsWith('UPDATE attendance SET AttendanceType')) return [{ affectedRows: 0 }]
      if (sql.startsWith('UPDATE employee_deployment')) return [{ affectedRows: 1 }]
      if (sql.includes('FROM employee_deployment') && sql.includes('WHERE ed.IsPermanentSite = 1')) return [[]]
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
      name.includes('dbconnect') ? { getConnection: async () => connection } : name === './auth' ? { requireSession: () => ({ sub: 1 }) } : name.includes('employeeStatusCrud') ? { attachPendingEmployeeStatuses: async () => {} } : name.endsWith('/messages') ? alerts : {},
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
  await assert.rejects(h.api.addDtrEmployee(request(5, { IsPermanentSite: false, DeploymentType: 'Reliever' })), conflict)
  assert.deepEqual(h.enrollments.get('5:2'), { type: 'Reliever', permanent: 0, deployment: 30 })
  assert.equal((await h.api.addDtrEmployee(request(10))).success, true)
  assert.equal(h.enrollments.size, 2)
})

test('Regular is saved as Fixed, Reliever as Cutoff-only, and opposing flags are rejected', async () => {
  const h = backend()
  for (const conflicting of [{ DeploymentType: 'Regular', IsPermanentSite: false }, { DeploymentType: 'Reliever', IsPermanentSite: true }]) {
    await assert.rejects(h.api.addDtrEmployee(request(5, conflicting)), error => error.statusCode === 400)
  }
  assert.equal(h.calls.length, 0)
  assert.equal((await h.api.addDtrEmployee(request(5, { DeploymentType: 'Regular', IsPermanentSite: true }))).success, true)
  assert.deepEqual(h.enrollments.get('5:2'), { type: 'Regular', permanent: 1, deployment: 30 })
  assert.ok(h.calls.some(call => call.sql?.includes("ed.DeploymentType = 'Regular'")))
})

test('type changes keep the Fixed/Cutoff-only snapshot paired and reject opposing flags', async () => {
  const h = backend({ enrolled: true, initialEnrollment: { type: 'Regular', permanent: 1, deployment: 30 } })
  await assert.rejects(h.api.updateDtrEmployeeType(request(5, { DeploymentType: 'Reliever', IsPermanentSite: true })), error => error.statusCode === 400)
  assert.deepEqual(h.enrollments.get('5:2'), { type: 'Regular', permanent: 1, deployment: 30 })
  assert.equal((await h.api.updateDtrEmployeeType(request(5, { DeploymentType: 'Reliever', IsPermanentSite: false }))).success, true)
  assert.deepEqual(h.enrollments.get('5:2'), { type: 'Reliever', permanent: 0, deployment: 30 })
  assert.equal((await h.api.updateDtrEmployeeType(request(5, { DeploymentType: 'Regular', IsPermanentSite: true }))).success, true)
  assert.deepEqual(h.enrollments.get('5:2'), { type: 'Regular', permanent: 1, deployment: 30 })
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
  const state = scope.run(() => evaluate(descriptor.scriptSetup.content + '\nmodule.exports={rows,employeeAlert,saving,pickerFixed,isPickerFixed,setPickerFixed,addEmployee,employeeAlreadyAdded,updatePermanentSite,typeSaving,detailsError,editableRoster,batchStatus};', {
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

test('each picker switch controls only its employee and saved rows keep their assignment', async () => {
  const posted = []
  const h = frontend(async (url, options) => {
    if (options?.method === 'POST') posted.push(options.body)
    return { records: [] }
  })
  try {
    const ana = { EmployeeID: 2, EmployeeName: 'Ana', IsPermanentSite: 0 }
    const ben = { EmployeeID: 3, EmployeeName: 'Ben', IsPermanentSite: 0 }
    h.state.setPickerFixed(ana, { target: { checked: true } })
    assert.equal(h.state.isPickerFixed(ana), true)
    assert.equal(h.state.isPickerFixed(ben), false)
    await h.state.addEmployee(ana)
    h.state.setPickerFixed(ben, { target: { checked: true } })
    h.state.setPickerFixed(ben, { target: { checked: false } })
    assert.equal(h.state.isPickerFixed(ana), true)
    assert.equal(h.state.isPickerFixed(ben), false)
    await h.state.addEmployee(ben)
    h.state.setPickerFixed(ana, { target: { checked: false } })
    assert.equal(h.state.isPickerFixed(ana), true)
    const saved = { EmployeeID: 4, EmployeeName: 'Cara', IsAdded: 1, IsPermanentSite: 1 }
    h.state.rows.value = [{ EmployeeID: 4, IsPermanentSite: 0 }]
    assert.equal(h.state.isPickerFixed(saved), false)
    h.state.setPickerFixed(saved, { target: { checked: true } })
    assert.equal(h.state.isPickerFixed(saved), false)
    assert.deepEqual(posted.map(body => [body.DeploymentType, body.IsPermanentSite]), [['Regular', true], ['Reliever', false]])
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

test('Employee site details switch saves Regular/Fixed and Reliever/Cutoff-only as paired values', async () => {
  const requests = []
  let fixed = true
  const h = frontend(async (url, options) => {
    if (options?.method === 'PUT') { requests.push(options.body); fixed = options.body.IsPermanentSite }
    return { batch: { Status: 'Draft' }, records: [{ EmployeeID: 2, EmployeeName: 'Ana', DeploymentType: fixed ? 'Regular' : 'Reliever', IsPermanentSite: fixed ? 1 : 0 }], shifts: [{ ShiftCodeID: 1 }] }
  })
  try {
    h.state.rows.value = [{ EmployeeID: 2, EmployeeName: 'Ana', DeploymentType: 'Regular', IsPermanentSite: 1 }]
    await h.state.updatePermanentSite(h.state.rows.value[0], { target: { checked: false } })
    assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), { EmployeeID: 2, DeploymentType: 'Reliever', IsPermanentSite: false })
    assert.equal(h.state.rows.value[0].DeploymentType, 'Reliever')
    assert.equal(h.state.rows.value[0].IsPermanentSite, 0)
    await h.state.updatePermanentSite(h.state.rows.value[0], { target: { checked: true } })
    assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), { EmployeeID: 2, DeploymentType: 'Regular', IsPermanentSite: true })
    assert.equal(h.state.rows.value[0].IsPermanentSite, 1)
    assert.equal(h.state.typeSaving.value, null)
  } finally { h.close() }
})

test('Employee site details restores the switch on save failure and stays read-only after computation', async () => {
  let puts = 0
  const h = frontend(async (url, options) => {
    if (options?.method === 'PUT') { puts++; throw { data: { statusMessage: 'Cannot change this DTR.' } } }
    return { batch: { Status: 'Draft' }, records: [{ EmployeeID: 2, EmployeeName: 'Ana', DeploymentType: 'Regular', IsPermanentSite: 1 }], shifts: [{ ShiftCodeID: 1 }] }
  })
  try {
    h.state.rows.value = [{ EmployeeID: 2, EmployeeName: 'Ana', DeploymentType: 'Regular', IsPermanentSite: 1 }]
    const input = { checked: false }
    await h.state.updatePermanentSite(h.state.rows.value[0], { target: input })
    assert.equal(puts, 1)
    assert.equal(input.checked, true)
    assert.equal(h.state.rows.value[0].DeploymentType, 'Regular')
    assert.equal(h.state.detailsError.value, 'Cannot change this DTR.')
    assert.equal(h.state.typeSaving.value, null)
    h.state.batchStatus.value = 'Computed to Payroll'
    assert.equal(h.state.editableRoster.value, false)
    const lockedInput = { checked: false }
    await h.state.updatePermanentSite(h.state.rows.value[0], { target: lockedInput })
    assert.equal(puts, 1)
    assert.equal(lockedInput.checked, true)
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
