const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const vue = require('vue')
const sfc = require('@vue/compiler-sfc')

function evaluate(source, dependencies = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code,
    { module, require: name => dependencies[name] || {}, ...globals })
  return module.exports
}
const fields = evaluate(fs.readFileSync('shared/utils/rateFields.ts', 'utf8'))
const rateVersions = evaluate(fs.readFileSync('server/utils/rateVersions.ts', 'utf8'), { '../../shared/utils/rateFields': fields })
const additional = ['OTExtRate', 'RestDayOTRate', 'LateDeduction', 'UndertimeDeduction']
const amounts = { RegularRate: 700, OTRate: 110, OTExtRate: 115.25, RestDayRate: 120, RestDayOTRate: 156.75, LateDeduction: 87.5, UndertimeDeduction: 88.25 }
const visibleAdditional = additional
const visibleAmounts = amounts

test('rate forms expose late/undertime amounts with hourly labels', () => {
  for (const key of additional) {
    assert.ok(fields.rateMoneyFields.some(field => field.key === key))
  }
  for (const key of visibleAdditional) assert.equal(fields.emptyRateAmounts()[key], 0)
  for (const key of ['LateDeduction', 'UndertimeDeduction']) {
    assert.equal(fields.emptyRateAmounts()[key], 0)
    assert.equal(fields.rateFormFields.some(field => field.key === key), true)
  }
  assert.match(fields.rateMoneyFields.find(field => field.key === 'LateDeduction').label, /hour/)
  assert.match(fields.rateMoneyFields.find(field => field.key === 'UndertimeDeduction').label, /hour/)
  assert.notEqual(fields.rateMoneyFields.find(field => field.key === 'RestDayRate').label, fields.rateMoneyFields.find(field => field.key === 'RestDayOTRate').label)
})

function component(filename, exposed, props = {}) {
  const { descriptor, errors } = sfc.parse(fs.readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  const compiled = sfc.compileScript(descriptor, { id: 'rate-test' })
  assert.deepEqual(sfc.compileTemplate({ source: descriptor.template.content, filename, id: 'rate-test', compilerOptions: { bindingMetadata: compiled.bindings } }).errors, [])
  for (const style of descriptor.styles) assert.deepEqual(sfc.compileStyle({ source: style.content, filename, id: 'rate-test', scoped: true }).errors, [])
  const calls = []
  const state = evaluate(descriptor.scriptSetup.content+'\nmodule.exports={'+exposed+'};', {
    vue: { ...vue, onMounted() {} },
    '../shared/utils/rateFields': fields,
    '~~/shared/utils/rateFields': fields,
    '~/composables/useRealtimeRefresh': { useRealtimeRefresh() {} },
  }, { defineProps: () => props, $fetch: async (url, options) => { calls.push({ url, options }); return { items: [], payrollRates: [], billingRates: [] } } })
  return { state, calls }
}

test('payroll and billing add forms submit and reset every additional rate', async () => {
  for (const resource of ['payroll-rate', 'billing-rate']) {
    const { state, calls } = component('components/RateCrud.vue', 'reset,form,save', { resource, title: resource === 'payroll-rate' ? 'Payroll Rates' : 'Billing Rates' })
    state.reset(); assert.equal(state.form.value.OTExtRate, 0)
    state.form.value = { ...state.form.value, ...visibleAmounts, AgencyPositionID: 1 }
    await state.save()
    const posted = calls.find(call => call.options).options
    assert.equal(posted.method, 'POST')
    for (const key of visibleAdditional) assert.equal(posted.body[key], amounts[key])
    assert.equal(posted.body.LateDeduction, amounts.LateDeduction); assert.equal(posted.body.UndertimeDeduction, amounts.UndertimeDeduction)
    state.reset()
    for (const key of visibleAdditional) assert.equal(state.form.value[key], 0)
    assert.equal(state.form.value.AgencyPositionID, '')
  }
})

test('rate form searches positions within the selected agency', () => {
  const { state } = component('components/RateCrud.vue', 'reset,form,selectedAgencyId,agencyPositions,agencyOptions,formPositionOptions,changeFormAgency', { resource: 'payroll-rate', title: 'Payroll Rates' })
  state.agencyPositions.value = [
    { AgencyID: 2, AgencyName: 'Agency B', AgencyPositionID: 3, PositionName: 'Guard' },
    { AgencyID: 1, AgencyName: 'Agency A', AgencyPositionID: 1, PositionName: 'Guard' },
    { AgencyID: 1, AgencyName: 'Agency A', AgencyPositionID: 2, PositionName: 'Supervisor' },
  ]
  state.reset()
  assert.deepEqual(Array.from(state.agencyOptions.value, option => option.label), ['Agency A', 'Agency B'])
  state.selectedAgencyId.value = '1'
  assert.deepEqual(Array.from(state.formPositionOptions.value, option => option.value), [1, 2])
  state.form.value.AgencyPositionID = 1
  state.selectedAgencyId.value = '2'
  state.changeFormAgency()
  assert.equal(state.form.value.AgencyPositionID, '')
  assert.deepEqual(Array.from(state.formPositionOptions.value, option => option.value), [3])
  state.reset()
  assert.equal(state.selectedAgencyId.value, '')
  assert.equal(state.form.value.AgencyPositionID, '')
})

test('rate update keeps the linked rate ID and submits a dated monetary snapshot', async () => {
  const { state, calls } = component('components/RateCrud.vue', 'openUpdate,saveUpdate,updateForm,updating', { resource: 'payroll-rate', title: 'Payroll Rates' })
  const item = { PayrollRateID: 17, AgencyName: 'Agency A', PositionName: 'Guard', LinkedSites: 3,
    RegularRate: 70, OTRate: 20, Versions: [{ EffectiveDate: '2026-09-01', RegularRate: 75, OTRate: 25 }] }
  state.openUpdate(item)
  assert.equal(state.updateForm.value.RegularRate, 75)
  assert.equal(state.updateForm.value.OTRate, 25)
  state.updateForm.value.EffectiveDate = '2026-10-15'
  state.updateForm.value.RegularRate = 80
  await state.saveUpdate()
  const request = calls.find(call => call.url === '/api/rates/versions')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.body.resource, 'payroll-rate')
  assert.equal(request.options.body.id, 17)
  assert.equal(request.options.body.EffectiveDate, '2026-10-15')
  assert.equal(request.options.body.RegularRate, 80)
  assert.equal(state.updating.value, null)
})

test('Edit current rate preloads the effective version and saves separately from a dated update', async () => {
  const { state, calls } = component('components/RateCrud.vue', 'openCurrentEdit,editForm,saveCurrentEdit,editingCurrent', { resource: 'billing-rate', title: 'Billing Rates' })
  state.openCurrentEdit({ BillingRateID: 12, RegularRate: 95, CurrentRate: { RegularRate: 110, OTRate: 65 } })
  assert.equal(state.editForm.value.RegularRate, 110)
  assert.equal(state.editForm.value.OTRate, 65)
  state.editForm.value.RegularRate = 115
  await state.saveCurrentEdit()
  const request = calls.find(call => call.options)
  assert.equal(request.url, '/api/rates/billing-rate')
  assert.equal(request.options.method, 'PUT')
  assert.equal(request.options.body.mode, 'current')
  assert.equal(request.options.body.id, 12)
  assert.equal(request.options.body.RegularRate, 115)
  assert.equal(state.editingCurrent.value, null)
})

test('current edit changes only the effective rate row, leaving future versions untouched', async () => {
  for (const current of [null, { PayrollRateVersionID: 8, EffectiveDate: '2026-09-25' }]) {
    const statements = []
    const connection = {
      async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
      async execute(sql, params) {
        statements.push({ sql, params })
        if (sql.startsWith('SELECT PayrollRateID, EffectiveDate, Status FROM payroll_rate')) return [[{ PayrollRateID: 7, EffectiveDate: '2026-01-01', Status: 'Active' }]]
        if (sql.startsWith('SELECT PayrollRateVersionID, EffectiveDate FROM payroll_rate_version')) return [[...(current ? [current] : [])]]
        if (sql.startsWith('UPDATE ')) return [{ affectedRows: 1 }]
        throw new Error(`Unexpected query: ${sql}`)
      },
    }
    const api = evaluate(fs.readFileSync('server/utils/rateCrud.ts', 'utf8'), {
      '../../shared/utils/rateFields': fields,
      '../connection/dbconnect': { getConnection: async () => connection },
      './auth': { requireSession: () => ({ sub: 1 }) },
      './rateVersions': { dateOnly: value => String(value || '').slice(0, 10), todayInPhilippines: () => '2026-10-09' },
      h3: { createError: options => Object.assign(new Error(options.statusMessage), options), getRouterParam: event => event.resource, readBody: async event => event.body },
    })
    const result = await api.updateRateResource({ resource: 'payroll-rate', body: { id: 7, mode: 'current', RegularRate: 115 } })
    assert.equal(result.effectiveDate, current ? '2026-09-25' : '2026-01-01')
    assert.match(statements.at(-1).sql, current ? /^UPDATE payroll_rate_version SET RegularRate = \?/ : /^UPDATE payroll_rate SET RegularRate = \?/)
    assert.equal(statements.at(-1).params.at(-1), current ? 8 : 7)
    assert.deepEqual(Array.from(statements.at(-1).params), [115, current ? 8 : 7])
  }
})

test('Edit preloads the latest saved version and history includes the original rate', () => {
  const { state } = component('components/RateCrud.vue', 'openUpdate,updateForm,minimumUpdateDate,viewingHistory,historyEntries', { resource: 'payroll-rate', title: 'Payroll Rates' })
  const item = { PayrollRateID: 17, EffectiveDate: '2026-01-01', RegularRate: 70, OTRate: 20,
    Versions: [
      { PayrollRateVersionID: 1, EffectiveDate: '2026-09-01', RegularRate: 75, OTRate: 25 },
      { PayrollRateVersionID: 2, EffectiveDate: '2026-10-15', RegularRate: 80, OTRate: 30 },
    ] }
  state.openUpdate(item)
  assert.equal(state.updateForm.value.RegularRate, 80)
  assert.equal(state.updateForm.value.OTRate, 30)
  assert.equal(state.minimumUpdateDate.value, '2026-10-16')
  state.viewingHistory.value = item
  assert.deepEqual(Array.from(state.historyEntries.value, entry => entry.RegularRate), [80, 75, 70])
  assert.equal(state.historyEntries.value.at(-1).isOriginal, true)
})

test('site inline creation sends complete payroll/billing amounts and linked previews expose them', async () => {
  const { state, calls } = component('components/SiteRateCrud.vue', 'reset,form,save,onAgencyChange,agencyOptions,positionOptions,siteOptions,sites,agencyPositions,inlinePayroll,inlineBilling,inlinePayrollAmounts,inlineBillingAmounts,payrollRates,billingRates,selectedPayroll,selectedBilling')
  state.sites.value = [{ SiteID: 1, AgencyID: 1, RegionID: 10, SiteName: 'Site A' }, { SiteID: 2, AgencyID: 2, RegionID: 10, SiteName: 'Site B' }]
  state.agencyPositions.value = [
    { AgencyID: 2, AgencyName: 'Agency B', AgencyPositionID: 3, PositionName: 'Guard' },
    { AgencyID: 1, AgencyName: 'Agency A', AgencyPositionID: 1, PositionName: 'Guard' },
    { AgencyID: 1, AgencyName: 'Agency A', AgencyPositionID: 2, PositionName: 'Supervisor' },
  ]
  state.reset()
  assert.deepEqual(Array.from(state.agencyOptions.value, option => option.label), ['Agency A', 'Agency B'])
  state.form.value.AgencyID = 1
  assert.deepEqual(Array.from(state.siteOptions.value, option => option.label), ['Site A'])
  assert.deepEqual(Array.from(state.positionOptions.value, option => option.value), ['1', '2'])
  state.form.value.AgencyPositionID = 1
  state.form.value.PayrollRateID = 7
  state.form.value.AgencyID = 2
  state.onAgencyChange()
  assert.equal(state.form.value.SiteID, '')
  assert.deepEqual(Array.from(state.siteOptions.value, option => option.label), ['Site B'])
  assert.equal(state.form.value.AgencyPositionID, '')
  assert.equal(state.form.value.PayrollRateID, '')
  assert.deepEqual(Array.from(state.positionOptions.value, option => option.value), ['3'])
  state.form.value = { SiteID: 1, AgencyID: 1, AgencyPositionID: 1, PayrollRateID: '', BillingRateID: '', Status: 'Active' }
  state.inlinePayroll.value = true; state.inlineBilling.value = true
  state.inlinePayrollAmounts.value = { ...fields.emptyRateAmounts(), ...visibleAmounts }
  state.inlineBillingAmounts.value = { ...fields.emptyRateAmounts(), ...visibleAmounts, OTExtRate: 200 }
  await state.save()
  const body = calls.find(call => call.options).options.body
  assert.equal(body.AgencyID, 1)
  for (const key of visibleAdditional) assert.equal(body.inlinePayrollRate[key], amounts[key])
  for (const rate of [body.inlinePayrollRate, body.inlineBillingRate]) {
    assert.equal(rate.LateDeduction, amounts.LateDeduction); assert.equal(rate.UndertimeDeduction, amounts.UndertimeDeduction)
  }
  assert.equal(body.inlineBillingRate.OTExtRate, 200)
  state.payrollRates.value = [{ PayrollRateID: 1, ...amounts }]; state.billingRates.value = [{ BillingRateID: 2, ...amounts }]
  state.form.value.PayrollRateID = 1; state.form.value.BillingRateID = 2
  assert.equal(state.selectedPayroll.value.LateDeduction, 87.5); assert.equal(state.selectedBilling.value.RestDayOTRate, 156.75)
})

test('site picker shows site names and warns before a duplicate active link is saved', async () => {
  const { state, calls } = component('components/SiteRateCrud.vue', 'reset,form,save,sites,siteOptions,agencyPositions,items,existingSiteLinks,duplicateSiteLink,error')
  state.sites.value = [{ SiteID: 1, AgencyID: 1, RegionID: 10, SiteName: 'Samsung S.E.P.C.O', ClientName: 'Samsung' }]
  state.agencyPositions.value = [
    { AgencyID: 1, AgencyPositionID: 11, AgencyName: 'DJA', PositionName: 'Security Guard' },
    { AgencyID: 1, AgencyPositionID: 12, AgencyName: 'DJA', PositionName: 'Supervisor' },
  ]
  state.items.value = [{ SiteRateID: 91, SiteID: 1, AgencyPositionID: 11, Status: 'Active' }]
  state.form.value = { SiteID: 1, AgencyID: 1, AgencyPositionID: 11, Status: 'Active' }
  assert.equal(state.siteOptions.value[0].label, 'Samsung S.E.P.C.O')
  assert.equal(state.existingSiteLinks.value.length, 1)
  assert.equal(state.duplicateSiteLink.value, true)
  await state.save()
  assert.match(state.error.value, /already has an active/)
  assert.equal(calls.filter(call => call.options).length, 0)
  state.form.value.AgencyPositionID = 12
  assert.equal(state.duplicateSiteLink.value, false)
  state.reset({ SiteRateID: 91, SiteID: 1, AgencyID: 1, AgencyPositionID: 11, Status: 'Active' })
  assert.equal(state.existingSiteLinks.value.length, 0, 'Editing a link does not warn about itself')
})

test('shared money input compiles with the shared field definitions', () => {
  const filename = 'components/RateMoneyFields.vue', { descriptor } = sfc.parse(fs.readFileSync(filename, 'utf8'), { filename })
  const compiled = sfc.compileScript(descriptor, { id: 'rate-input' })
  assert.deepEqual(sfc.compileTemplate({ source: descriptor.template.content, filename, id: 'rate-input', compilerOptions: { bindingMetadata: compiled.bindings } }).errors, [])
  assert.deepEqual(sfc.compileStyle({ source: descriptor.styles[0].content, filename, id: 'rate-input', scoped: true }).errors, [])
})

test('MySQL rate create/list/update and inline site linking preserve extra amounts (rolled back)', { skip: process.env.RATES_TEST_DATABASE !== '1' }, async () => {
  const env = { ...require('node:util').parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
  const connection = await require('mysql2/promise').createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306), user: env.DB_USER || 'root', password: env.DB_PASSWORD, database: env.DB_NAME || 'pbsystem', dateStrings: true })
  await connection.beginTransaction()
  try {
    const [[position]] = await connection.execute("SELECT ap.AgencyPositionID, ap.AgencyID FROM agency_position ap INNER JOIN agency a ON a.AgencyID = ap.AgencyID INNER JOIN `position` p ON p.PositionID = ap.PositionID WHERE ap.Status='Active' AND a.Status='Active' AND p.Status='Active' LIMIT 1")
    const [[client]] = await connection.execute("SELECT ClientID FROM client WHERE Status='Active' LIMIT 1")
    const [[region]] = await connection.execute("SELECT RegionID FROM region WHERE Status='Active' LIMIT 1")
    assert.ok(position && client && region, 'An active agency position, client, and site region are needed')
    const [siteResult] = await connection.execute("INSERT INTO site (ClientID, RegionID, SiteName, Status) VALUES (?, ?, ?, 'Active')", [client.ClientID, region.RegionID, `RATE TEST ${Date.now()}`])
    await connection.execute("INSERT INTO site_agency (SiteID, AgencyID, Status) VALUES (?, ?, 'Active')", [siteResult.insertId, position.AgencyID])
    const wrapped = { execute: (...args) => connection.execute(...args),
      beginTransaction: () => connection.query('SAVEPOINT rate_test'), commit: () => connection.query('RELEASE SAVEPOINT rate_test'),
      rollback: () => connection.query('ROLLBACK TO SAVEPOINT rate_test'), release() {} }
    const api = evaluate(fs.readFileSync('server/utils/rateCrud.ts', 'utf8'), {
      '../../shared/utils/rateFields': fields,
      '../connection/dbconnect': { ...wrapped, getConnection: async () => wrapped },
      './auth': { requireSession: () => ({ sub: 1 }) },
      './rateVersions': rateVersions,
      h3: { createError: options => Object.assign(new Error(options.statusMessage), options), getRouterParam: event => event.resource, readBody: async event => event.body },
    })
    for (const resource of ['payroll-rate', 'billing-rate']) {
      const idKey = resource === 'payroll-rate' ? 'PayrollRateID' : 'BillingRateID'
      const body = { AgencyPositionID: position.AgencyPositionID, ...amounts }
      const { id } = await api.createRateResource({ resource, body })
      let found = (await api.listRateResource({ resource })).items.find(row => row[idKey] === id)
      for (const key of additional) assert.equal(Number(found[key]), amounts[key])
      await api.updateRateResource({ resource, body: { id, AgencyPositionID: position.AgencyPositionID, OTExtRate: 201.5, UndertimeDeduction: 0 } })
      found = (await api.listRateResource({ resource })).items.find(row => row[idKey] === id)
      assert.equal(Number(found.OTExtRate), 201.5); assert.equal(Number(found.UndertimeDeduction), 0)
      assert.equal(Number(found.LateDeduction), amounts.LateDeduction, 'Omitted fields preserve existing amounts')
      assert.equal(Number(found.RestDayOTRate), amounts.RestDayOTRate)
      await api.updateRateResource({ resource, body: { id, mode: 'current', RegularRate: 210 } })
      const versionTable = resource === 'payroll-rate' ? 'payroll_rate_version' : 'billing_rate_version'
      const versionId = resource === 'payroll-rate' ? 'PayrollRateVersionID' : 'BillingRateVersionID'
      await connection.execute(`INSERT INTO ${versionTable} (${idKey}, EffectiveDate, RegularRate) VALUES (?, ?, ?), (?, ?, ?)`, [id, '2026-10-01', 220, id, '2400-01-01', 240])
      await api.updateRateResource({ resource, body: { id, mode: 'current', RegularRate: 230 } })
      const [[baseRate]] = await connection.execute(`SELECT RegularRate FROM ${resource === 'payroll-rate' ? 'payroll_rate' : 'billing_rate'} WHERE ${idKey} = ?`, [id])
      const [savedVersions] = await connection.execute(`SELECT ${versionId}, EffectiveDate, RegularRate FROM ${versionTable} WHERE ${idKey} = ? ORDER BY EffectiveDate`, [id])
      assert.equal(Number(baseRate.RegularRate), 210)
      assert.equal(Number(savedVersions[0].RegularRate), 230)
      assert.equal(Number(savedVersions[1].RegularRate), 240, 'Editing current leaves a future version unchanged')
      for (const bad of [-1, true, 'not-a-number', 100000000, 0.001]) {
        await assert.rejects(api.createRateResource({ resource, body: { ...body, LateDeduction: bad } }), /LateDeduction/)
      }
      const zero = await api.createRateResource({ resource, body: { AgencyPositionID: position.AgencyPositionID } })
      const defaults = (await api.listRateResource({ resource })).items.find(row => row[idKey] === zero.id)
      for (const key of additional) assert.equal(Number(defaults[key]), 0)
    }
    const clientBody = { SiteID: siteResult.insertId, AgencyID: position.AgencyID, AgencyPositionID: position.AgencyPositionID, inlinePayrollRate: amounts, inlineBillingRate: { ...amounts, RestDayOTRate: 222 } }
    await assert.rejects(api.createRateResource({ resource: 'site-rate', body: { ...clientBody, AgencyID: 2147483647 } }), error => error.statusCode === 400)
    const [[otherAgencyPosition]] = await connection.execute("SELECT ap.AgencyID, ap.AgencyPositionID FROM agency_position ap INNER JOIN agency a ON a.AgencyID = ap.AgencyID INNER JOIN `position` p ON p.PositionID = ap.PositionID WHERE ap.AgencyID <> ? AND ap.Status = 'Active' AND a.Status = 'Active' AND p.Status = 'Active' LIMIT 1", [position.AgencyID])
    if (otherAgencyPosition) {
      await assert.rejects(api.createRateResource({ resource: 'site-rate', body: { ...clientBody, AgencyID: otherAgencyPosition.AgencyID, AgencyPositionID: otherAgencyPosition.AgencyPositionID } }), /assigned to the selected agency/)
    }
    const linked = await api.createRateResource({ resource: 'site-rate', body: clientBody })
    const listing = await api.listRateResource({ resource: 'site-rate' })
    const link = listing.items.find(row => row.SiteRateID === linked.id)
    const payroll = listing.payrollRates.find(row => row.PayrollRateID === link.PayrollRateID)
    const billing = listing.billingRates.find(row => row.BillingRateID === link.BillingRateID)
    for (const key of additional) assert.equal(Number(payroll[key]), amounts[key])
    assert.equal(Number(billing.RestDayOTRate), 222)
    await assert.rejects(api.createRateResource({ resource: 'site-rate', body: { SiteID: siteResult.insertId, AgencyID: position.AgencyID, AgencyPositionID: position.AgencyPositionID, PayrollRateID: link.PayrollRateID, BillingRateID: link.BillingRateID } }), error => error.statusCode === 409)
    const [[before]] = await connection.execute('SELECT COUNT(*) AS Count FROM payroll_rate')
    await assert.rejects(api.createRateResource({ resource: 'site-rate', body: { ...clientBody, inlineBillingRate: { ...amounts, OTExtRate: -1 } } }), /OTExtRate/)
    const [[after]] = await connection.execute('SELECT COUNT(*) AS Count FROM payroll_rate')
    assert.equal(after.Count, before.Count, 'Failed inline billing rolls back the paired payroll insert')
  } finally { await connection.rollback(); await connection.end() }
})
