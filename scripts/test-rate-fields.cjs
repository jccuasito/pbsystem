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

test('payroll and billing forms submit, reopen, and reset every additional rate', async () => {
  for (const resource of ['payroll-rate', 'billing-rate']) {
    const { state, calls } = component('components/RateCrud.vue', 'reset,form,save', { resource, title: resource === 'payroll-rate' ? 'Payroll Rates' : 'Billing Rates' })
    state.reset(); assert.equal(state.form.value.OTExtRate, 0)
    state.form.value = { ...state.form.value, ...visibleAmounts, AgencyPositionID: 1 }
    await state.save()
    const posted = calls.find(call => call.options).options
    assert.equal(posted.method, 'POST')
    for (const key of visibleAdditional) assert.equal(posted.body[key], amounts[key])
    assert.equal(posted.body.LateDeduction, amounts.LateDeduction); assert.equal(posted.body.UndertimeDeduction, amounts.UndertimeDeduction)
    state.reset({ PayrollRateID: 11, BillingRateID: 12, AgencyPositionID: 1, ...amounts })
    for (const key of visibleAdditional) assert.equal(state.form.value[key], amounts[key])
    assert.equal(state.form.value.LateDeduction, amounts.LateDeduction); assert.equal(state.form.value.UndertimeDeduction, amounts.UndertimeDeduction)
    state.form.value.RestDayOTRate = 199.5; await state.save()
    const updated = calls.filter(call => call.options).at(-1).options
    assert.equal(updated.method, 'PUT'); assert.equal(updated.body.RestDayOTRate, 199.5)
    assert.equal(updated.body.LateDeduction, amounts.LateDeduction); assert.equal(updated.body.UndertimeDeduction, amounts.UndertimeDeduction)
    state.reset(); for (const key of visibleAdditional) assert.equal(state.form.value[key], 0)
  }
})

test('site inline creation sends complete payroll/billing amounts and linked previews expose them', async () => {
  const { state, calls } = component('components/SiteRateCrud.vue', 'reset,form,save,inlinePayroll,inlineBilling,inlinePayrollAmounts,inlineBillingAmounts,payrollRates,billingRates,selectedPayroll,selectedBilling')
  state.reset(); state.form.value = { SiteID: 1, AgencyPositionID: 1, PayrollRateID: '', BillingRateID: '', Status: 'Active' }
  state.inlinePayroll.value = true; state.inlineBilling.value = true
  state.inlinePayrollAmounts.value = { ...fields.emptyRateAmounts(), ...visibleAmounts }
  state.inlineBillingAmounts.value = { ...fields.emptyRateAmounts(), ...visibleAmounts, OTExtRate: 200 }
  await state.save()
  const body = calls.find(call => call.options).options.body
  for (const key of visibleAdditional) assert.equal(body.inlinePayrollRate[key], amounts[key])
  for (const rate of [body.inlinePayrollRate, body.inlineBillingRate]) {
    assert.equal(rate.LateDeduction, amounts.LateDeduction); assert.equal(rate.UndertimeDeduction, amounts.UndertimeDeduction)
  }
  assert.equal(body.inlineBillingRate.OTExtRate, 200)
  state.payrollRates.value = [{ PayrollRateID: 1, ...amounts }]; state.billingRates.value = [{ BillingRateID: 2, ...amounts }]
  state.form.value.PayrollRateID = 1; state.form.value.BillingRateID = 2
  assert.equal(state.selectedPayroll.value.LateDeduction, 87.5); assert.equal(state.selectedBilling.value.RestDayOTRate, 156.75)
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
    const [[position]] = await connection.execute("SELECT AgencyPositionID FROM agency_position WHERE Status='Active' LIMIT 1")
    const [[client]] = await connection.execute("SELECT ClientID FROM client WHERE Status='Active' LIMIT 1")
    const [[region]] = await connection.execute("SELECT RegionID FROM region WHERE Status='Active' LIMIT 1")
    assert.ok(position && client && region, 'An active agency position, client, and site region are needed')
    const [siteResult] = await connection.execute("INSERT INTO site (ClientID, RegionID, SiteName, Status) VALUES (?, ?, ?, 'Active')", [client.ClientID, region.RegionID, `RATE TEST ${Date.now()}`])
    const wrapped = { execute: (...args) => connection.execute(...args),
      beginTransaction: () => connection.query('SAVEPOINT rate_test'), commit: () => connection.query('RELEASE SAVEPOINT rate_test'),
      rollback: () => connection.query('ROLLBACK TO SAVEPOINT rate_test'), release() {} }
    const api = evaluate(fs.readFileSync('server/utils/rateCrud.ts', 'utf8'), {
      '../../shared/utils/rateFields': fields,
      '../connection/dbconnect': { ...wrapped, getConnection: async () => wrapped },
      './auth': { requireSession: () => ({ sub: 1 }) },
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
      for (const bad of [-1, true, 'not-a-number', 100000000, 0.001]) {
        await assert.rejects(api.createRateResource({ resource, body: { ...body, LateDeduction: bad } }), /LateDeduction/)
      }
      const zero = await api.createRateResource({ resource, body: { AgencyPositionID: position.AgencyPositionID } })
      const defaults = (await api.listRateResource({ resource })).items.find(row => row[idKey] === zero.id)
      for (const key of additional) assert.equal(Number(defaults[key]), 0)
    }
    const clientBody = { SiteID: siteResult.insertId, AgencyPositionID: position.AgencyPositionID, inlinePayrollRate: amounts, inlineBillingRate: { ...amounts, RestDayOTRate: 222 } }
    const linked = await api.createRateResource({ resource: 'site-rate', body: clientBody })
    const listing = await api.listRateResource({ resource: 'site-rate' })
    const link = listing.items.find(row => row.SiteRateID === linked.id)
    const payroll = listing.payrollRates.find(row => row.PayrollRateID === link.PayrollRateID)
    const billing = listing.billingRates.find(row => row.BillingRateID === link.BillingRateID)
    for (const key of additional) assert.equal(Number(payroll[key]), amounts[key])
    assert.equal(Number(billing.RestDayOTRate), 222)
    await assert.rejects(api.createRateResource({ resource: 'site-rate', body: { SiteID: siteResult.insertId, AgencyPositionID: position.AgencyPositionID, PayrollRateID: link.PayrollRateID, BillingRateID: link.BillingRateID } }), error => error.statusCode === 409)
    const [[before]] = await connection.execute('SELECT COUNT(*) AS Count FROM payroll_rate')
    await assert.rejects(api.createRateResource({ resource: 'site-rate', body: { ...clientBody, inlineBillingRate: { ...amounts, OTExtRate: -1 } } }), /OTExtRate/)
    const [[after]] = await connection.execute('SELECT COUNT(*) AS Count FROM payroll_rate')
    assert.equal(after.Count, before.Count, 'Failed inline billing rolls back the paired payroll insert')
  } finally { await connection.rollback(); await connection.end() }
})
