const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse } = require('@vue/compiler-sfc')
const vue = require('vue')
function evaluate(source, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, require: () => ({}), ...globals })
  return module.exports
}
const identities = evaluate(fs.readFileSync('app/utils/employee.ts', 'utf8'))
const messages = evaluate(fs.readFileSync('components/alertmessage/messages.ts', 'utf8'))
const deployment = evaluate(fs.readFileSync('shared/utils/deployment.ts', 'utf8'))

test('deployment shows agency shifts without site links, resets dependent selections, and refreshes on opening', async () => {
  let loads = 0
  const scope = vue.effectScope()
  const source = parse(fs.readFileSync('app/pages/employees/deployment-history/index.vue', 'utf8')).descriptor.scriptSetup.content
  const state = scope.run(() => evaluate(source + '\nmodule.exports={openNewDeployment,form,employees,availableClientRates,availableShifts,employeeOptions,onEmployeeChanged,onClientRateChanged,onSiteChanged,canSave};', {
    require: name => name === 'vue' ? { ...vue, onMounted() {} } : name.includes('useRealtimeRefresh') ? { useRealtimeRefresh() {} } : name.includes('utils/employee') ? identities : name.includes('alertmessage/messages') ? messages : name.includes('utils/deployment') ? deployment : {},
    $fetch: async () => { loads++; return {
      employees: [{ EmployeeID: 7, AgencyID: 3, AgencyPositionID: 3, PositionName: 'Supervisor', EmployeeName: 'Ian De Jesus' }],
      clientRates: [{ ClientRateID: 1, AgencyID: 3, AgencyPositionID: 3, ClientID: 1 }, { ClientRateID: 2, AgencyID: 3, AgencyPositionID: 4, ClientID: 1 }, { ClientRateID: 3, AgencyID: 1, AgencyPositionID: 1, ClientID: 1 }], sites: [{ SiteID: 1, ClientID: 1 }],
      shiftCodes: [], agencyShiftCodes: [{ ShiftCodeID: 7, AgencyID: 3, ShiftCode: 'DS0900-1800' }, { ShiftCodeID: 1, AgencyID: 1 }],
    } },
  }))
  try {
    await state.openNewDeployment()
    Object.assign(state.form.value, { EmployeeID: '7', ClientRateID: '1', SiteID: '1', ShiftCodeID: '7', StartDate: '2026-09-19' })
    assert.equal(state.availableShifts.value.length, 1)
    assert.equal(state.availableShifts.value[0].ShiftCodeID, 7)
    assert.equal(state.canSave.value, true)
    assert.equal(state.availableClientRates.value.length, 1)
    assert.equal(state.availableClientRates.value[0].ClientRateID, 1)
    state.form.value.ClientRateID = '2'; assert.ok(!state.canSave.value)
    state.form.value.ClientRateID = '1'
    // A refreshed employee position immediately invalidates the old rate.
    state.employees.value[0].AgencyPositionID = 4
    assert.equal(state.availableClientRates.value[0].ClientRateID, 2)
    assert.ok(!state.canSave.value)
    state.employees.value[0].AgencyPositionID = 99
    assert.equal(state.availableClientRates.value.length, 0)
    state.employees.value[0].AgencyPositionID = 3
    state.form.value.ShiftCodeID = '1'; assert.equal(state.canSave.value, false)
    state.onSiteChanged(); assert.equal(state.form.value.ShiftCodeID, '')
    state.onClientRateChanged(); assert.equal(state.form.value.SiteID, '')
    state.onEmployeeChanged(); assert.equal(state.form.value.ClientRateID, '')
    await state.openNewDeployment(); assert.equal(loads, 2)
    assert.match(state.employeeOptions.value[0].label, /EMP-0007/)
  } finally { scope.stop() }
})

test('searchable dropdown finds name/number beyond initial 100 and never submits unselected text', () => {
  const scope = vue.effectScope(), events = []
  const props = vue.reactive({ modelValue: 2, disabled: false, options: Array.from({ length: 150 }, (_, i) => ({ value: i+1, label: `Employee ${i+1}`, search: i === 149 ? 'DJA-999 John Doe' : '' })) })
  const source = parse(fs.readFileSync('components/SearchableSelect.vue', 'utf8')).descriptor.scriptSetup.content
  const state = scope.run(() => evaluate(source + '\nmodule.exports={expand,changeQuery,choose,visible,open,selected};', {
    require: () => ({ ...vue, useId: () => 'test-select' }), defineProps: () => props, withDefaults: value => value,
    defineEmits: () => (event, value) => { events.push([event, value]); if (event === 'update:modelValue') props.modelValue = value },
  }))
  try {
    state.expand(); assert.equal(state.visible.value.length, 100)
    state.changeQuery({ target: { value: 'john dja-999' } })
    assert.equal(props.modelValue, '')
    assert.equal(state.visible.value.length, 1)
    state.choose(state.visible.value[0]); assert.equal(props.modelValue, 150)
    assert.equal(state.open.value, false)
    assert.equal(state.selected.value.label, 'Employee 150')
    assert.ok(events.some(([type,value]) => type === 'change' && value === 150))
  } finally { scope.stop() }
})

test('MySQL deployment links agency shifts atomically, reuses mappings, and rejects invalid selections', { skip: process.env.DEPLOYMENT_TEST_DATABASE !== '1' }, async () => {
  const mysql = require('mysql2/promise')
  const env = { ...require('util').parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
  const c = await mysql.createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306), user: env.DB_USER || 'root', password: env.DB_PASSWORD, database: env.DB_NAME || 'pbsystem', dateStrings: true })
  try {
    // Connection-local temporary tables shadow production names; no real records are changed.
    const tables = {
      employee: 'EmployeeID INT PRIMARY KEY, AgencyPositionID INT, Status VARCHAR(20)',
      agency_position: 'AgencyPositionID INT PRIMARY KEY, AgencyID INT',
      payroll_rate: 'PayrollRateID INT PRIMARY KEY, AgencyPositionID INT, Status VARCHAR(20)',
      client_rate: 'ClientRateID INT PRIMARY KEY, PayrollRateID INT, ClientID INT, Status VARCHAR(20)',
      site: 'SiteID INT PRIMARY KEY, ClientID INT, Status VARCHAR(20)',
      shift_code: 'ShiftCodeID INT PRIMARY KEY, AgencyID INT, Status VARCHAR(20)',
      site_shift: 'SiteShiftID INT AUTO_INCREMENT PRIMARY KEY, SiteID INT, ShiftCodeID INT, NDPolicyOverride VARCHAR(20), Status VARCHAR(20), UNIQUE(SiteID,ShiftCodeID)',
      employee_deployment: 'DeploymentID INT AUTO_INCREMENT PRIMARY KEY, EmployeeID INT, ClientRateID INT, SiteID INT, SiteShiftID INT, DeploymentType VARCHAR(20), StartDate DATE, EndDate DATE, Remarks TEXT, CreatedBy INT, IsPermanentSite TINYINT DEFAULT 1',
    }
    for (const [name, columns] of Object.entries(tables)) await c.query(`CREATE TEMPORARY TABLE ${name} (${columns}) ENGINE=InnoDB`)
    await c.query("INSERT INTO employee VALUES (7,3,'Active'),(8,3,'Active'),(9,3,'Active')")
    await c.query('INSERT INTO agency_position VALUES (3,3),(1,1),(4,3)')
    await c.query("INSERT INTO payroll_rate VALUES (3,3,'Active'),(1,1,'Active'),(4,4,'Active')")
    await c.query("INSERT INTO client_rate VALUES (3,3,10,'Active'),(1,1,10,'Active'),(4,4,10,'Active')")
    await c.query("INSERT INTO site VALUES (10,10,'Active'),(11,11,'Active')")
    await c.query("INSERT INTO shift_code VALUES (7,3,'Active'),(8,3,'Inactive'),(1,1,'Active'),(9,3,'Active')")
    let failInsert = false
    const connection = { execute: async (sql, args) => { if (failInsert && sql.includes('INSERT INTO employee_deployment')) throw new Error('test insert failure'); return c.execute(sql, args) }, beginTransaction: () => c.beginTransaction(), commit: () => c.commit(), rollback: () => c.rollback(), release() {} }
    const api = evaluate(fs.readFileSync('server/utils/employeeCrud.ts', 'utf8'), { require: name => name === 'h3' ? { readBody: async event => event.body, createError: details => Object.assign(new Error(details.statusMessage), details) } : name.includes('dbconnect') ? { getConnection: async () => connection } : name === './auth' ? { requireSession: () => ({ sub: 1 }) } : name.includes('alertmessage/messages') ? messages : {} })
    const body = { EmployeeID: 7, ClientRateID: 3, SiteID: 10, ShiftCodeID: 7, DeploymentType: 'Regular', StartDate: '2026-09-19' }
    // Same agency but wrong position must fail before any deployment or link write.
    await assert.rejects(api.createDeployment({ body: { ...body, ClientRateID: 4 } }), error => error.statusCode === 400 && /position saved in Employee List/.test(error.message))
    assert.equal((await c.query('SELECT COUNT(*) AS count FROM employee_deployment'))[0][0].count, 0)
    assert.equal((await c.query('SELECT COUNT(*) AS count FROM site_shift'))[0][0].count, 0)
    assert.equal((await api.createDeployment({ body })).success, true)
    const [[link]] = await c.query('SELECT * FROM site_shift')
    assert.equal(link.ShiftCodeID, 7)
    assert.equal(link.NDPolicyOverride, 'Inherit')
    await c.query("UPDATE site_shift SET NDPolicyOverride='Disabled'")
    await api.createDeployment({ body: { ...body, EmployeeID: 8 } })
    const [[counts]] = await c.query('SELECT COUNT(*) AS count FROM site_shift'); assert.equal(counts.count, 1)
    const [[preserved]] = await c.query('SELECT NDPolicyOverride FROM site_shift'); assert.equal(preserved.NDPolicyOverride, 'Disabled')
    for (const invalid of [{ ShiftCodeID: 1 }, { ShiftCodeID: 8 }, { SiteID: 11 }, { ClientRateID: 1 }, { ShiftCodeID: '' }, { EndDate: '2026-09-18' }]) {
      await assert.rejects(api.createDeployment({ body: { ...body, EmployeeID: 9, ...invalid } }), error => error.statusCode === 400)
    }
    const [before] = await c.query('SELECT * FROM employee_deployment ORDER BY DeploymentID')
    const [linksBefore] = await c.query('SELECT * FROM site_shift')
    // Exact repeat, later start inside an open assignment, and a different shift
    // all reject without silently ending the original or creating a site link.
    for (const repeat of [{}, { StartDate: '2026-10-01' }, { ShiftCodeID: 9 }, { StartDate: '2026-09-01', EndDate: '2026-09-19' }]) {
      await assert.rejects(api.createDeployment({ body: { ...body, ...repeat } }), error => error.statusCode === 409 && error.data.code === messages.DEPLOYMENT_ALREADY_EXISTS)
    }
    assert.deepEqual((await c.query('SELECT * FROM employee_deployment ORDER BY DeploymentID'))[0], before)
    assert.deepEqual((await c.query('SELECT * FROM site_shift'))[0], linksBefore)
    // A different site is an explicit transfer, not a duplicate New deployment.
    await c.query("INSERT INTO site VALUES (12,10,'Active')")
    await assert.rejects(api.createDeployment({ body: { ...body, SiteID: 12 } }), error => error.statusCode === 409)
    // Historical non-overlapping periods remain valid; inclusive end dates cannot overlap.
    await c.query("UPDATE employee_deployment SET EndDate='2026-09-30' WHERE EmployeeID=7")
    await assert.rejects(api.createDeployment({ body: { ...body, StartDate: '2026-09-30' } }), error => error.statusCode === 409)
    // Legacy clients still submit a site-linked shift; keep the agency validation.
    await api.createDeployment({ body: { ...body, ShiftCodeID: undefined, SiteShiftID: link.SiteShiftID, StartDate: '2026-10-01' } })
    const [[old]] = await c.query('SELECT EndDate FROM employee_deployment WHERE EmployeeID=7 ORDER BY StartDate LIMIT 1'); assert.equal(old.EndDate, '2026-09-30')
    // Cutoff-only DTR records do not prevent a real permanent deployment.
    await c.query("INSERT INTO employee_deployment (EmployeeID,SiteID,StartDate,IsPermanentSite) VALUES (9,10,'2026-09-01',0)")
    failInsert = true
    await assert.rejects(api.createDeployment({ body: { ...body, EmployeeID: 9, ShiftCodeID: 9, StartDate: '2026-11-01' } }), /test insert failure/)
    const [[missing]] = await c.query('SELECT COUNT(*) AS count FROM site_shift WHERE ShiftCodeID=9'); assert.equal(missing.count, 0)
    const [[active]] = await c.query('SELECT EndDate FROM employee_deployment WHERE EmployeeID=7 ORDER BY StartDate DESC LIMIT 1'); assert.equal(active.EndDate, null)
    failInsert = false
    // A position edited after the form loaded is checked against the current DB row.
    await c.query('UPDATE employee SET AgencyPositionID=4 WHERE EmployeeID=9')
    await assert.rejects(api.createDeployment({ body: { ...body, EmployeeID: 9 } }), error => error.statusCode === 400 && /position saved in Employee List/.test(error.message))
    await c.query('UPDATE employee SET AgencyPositionID=3 WHERE EmployeeID=9')
    await api.createDeployment({ body: { ...body, EmployeeID: 9 } })
    const [[technical]] = await c.query('SELECT EndDate FROM employee_deployment WHERE EmployeeID=9 AND IsPermanentSite=0'); assert.equal(technical.EndDate, null)
  } finally { await c.end() }
})
