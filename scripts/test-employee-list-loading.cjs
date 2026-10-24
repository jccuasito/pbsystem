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
const employeeUtils = evaluate(fs.readFileSync('app/utils/employee.ts', 'utf8'))
const messages = evaluate(fs.readFileSync('components/alertmessage/messages.ts', 'utf8'))
const source = parse(fs.readFileSync('app/pages/employees/index.vue', 'utf8')).descriptor.scriptSetup.content
function workspace(fetch) {
  const scope = vue.effectScope()
  let refreshOptions
  const state = scope.run(() => evaluate(source + '\nmodule.exports={load,loading,items,filters,search,filteredItems,error,modalOpen,transferring,transferSiteRates,filteredTransferSiteRates};', {
    require: name => name === 'vue' ? { ...vue, onMounted() {}, onBeforeUnmount() {} } : name.includes('useRealtimeRefresh') ? { useRealtimeRefresh: (_, options) => { refreshOptions = options } } : name.includes('utils/employee') ? employeeUtils : name.includes('alertmessage/messages') ? messages : {},
    defineEmits: () => () => {}, $fetch: fetch,
  }))
  return { state, refreshOptions, close: () => scope.stop() }
}
const result = { items: [
  { EmployeeID: 1, FirstName: 'Ana', LastName: 'Test', AgencyID: 1, PositionID: 10 },
  { EmployeeID: 2, FirstName: 'Ben', LastName: 'Test', AgencyID: 2, PositionID: 10 },
  { EmployeeID: 3, FirstName: 'Cara', LastName: 'Test', AgencyID: 2, PositionID: 20 },
], agencies: [], positions: [], agencyPositions: [] }

test('Agency transfer offers only rates belonging to another agency', () => {
  const harness = workspace(async () => result)
  try {
    harness.state.transferring.value = { EmployeeID: 1, AgencyID: 1 }
    harness.state.transferSiteRates.value = [{ SiteRateID: 1, AgencyID: 1 }, { SiteRateID: 2, AgencyID: 2 }]
    assert.equal(harness.state.filteredTransferSiteRates.value.length, 1)
    assert.equal(harness.state.filteredTransferSiteRates.value[0].SiteRateID, 2)
  } finally { harness.close() }
})

test('initial load shares one pending request and retains rows during later refresh', async () => {
  const pending = [], requests = []
  const harness = workspace((url, options) => { requests.push({ url, options }); return new Promise(resolve => pending.push(resolve)) })
  try {
    const initial = harness.state.load(), refresh = harness.state.load(true)
    assert.equal(requests.length, 1)
    assert.equal(harness.state.loading.value, true)
    assert.equal(harness.refreshOptions.shouldRefresh(), false)
    pending.shift()(result); await Promise.all([initial, refresh])
    assert.equal(harness.state.loading.value, false)
    const reload = harness.state.load()
    assert.equal(harness.state.loading.value, false)
    assert.equal(harness.state.items.value.length, 3)
    pending.shift()(result); await reload
    assert.equal(requests[0].options.timeout, 15000)
    assert.equal(requests[0].options.retry, 0)
    harness.state.modalOpen.value = true
    assert.equal(harness.refreshOptions.shouldRefresh(), false)
  } finally { harness.close() }
})

test('agency, position, and search filter loaded employees immediately without extra requests', async () => {
  let requests = 0
  const harness = workspace(async () => { requests++; return result })
  try {
    await harness.state.load()
    harness.state.filters.value.agencyId = '2'; await vue.nextTick()
    assert.equal(harness.state.filteredItems.value.length, 2)
    harness.state.filters.value.positionId = '20'
    assert.equal(harness.state.filteredItems.value[0].EmployeeID, 3)
    harness.state.search.value = 'missing'
    assert.equal(harness.state.filteredItems.value.length, 0)
    harness.state.search.value = 'Cara'
    assert.equal(harness.state.filteredItems.value.length, 1)
    harness.state.filters.value.agencyId = ''; await vue.nextTick()
    assert.equal(harness.state.filters.value.positionId, '')
    harness.state.search.value = ''
    assert.equal(harness.state.filteredItems.value.length, 3)
    assert.equal(requests, 1)
  } finally { harness.close() }
})

test('failed request clears loading and allows the next request to recover', async () => {
  let requests = 0
  const harness = workspace(async () => { if (++requests === 1) throw new Error('timeout'); return result })
  try {
    await harness.state.load()
    assert.equal(harness.state.loading.value, false)
    assert.match(harness.state.error.value, /Unable to load/)
    await harness.state.load(true)
    assert.equal(harness.state.items.value.length, 3)
    assert.equal(harness.state.error.value, '')
  } finally { harness.close() }
})
