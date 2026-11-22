const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse } = require('@vue/compiler-sfc')
const vue = require('vue')
function evaluate(source, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, require: () => ({}), AbortController, setTimeout, clearTimeout, ...globals })
  return module.exports
}
const employeeUtils = evaluate(fs.readFileSync('app/utils/employee.ts', 'utf8'))
const messages = evaluate(fs.readFileSync('components/alertmessage/messages.ts', 'utf8'))
const testVue = { ...vue, onMounted() {}, onActivated() {}, onDeactivated() {}, onBeforeUnmount() {} }
const requestErrors = require('../shared/utils/requestError.ts')
const infinite = evaluate(fs.readFileSync('app/composables/useInfiniteCollection.ts','utf8'), { require: name => name === 'vue' ? testVue : requestErrors })
const serverList = evaluate(fs.readFileSync('app/composables/useServerList.ts','utf8'), { require: name => name === 'vue' ? testVue : infinite })
const source = parse(fs.readFileSync('app/pages/employees/index.vue', 'utf8')).descriptor.scriptSetup.content
function workspace(fetch) {
  const scope = vue.effectScope()
  let refreshOptions
  const state = scope.run(() => evaluate(source + '\nmodule.exports={load,loading,items,filters,search,filteredItems,error,modalOpen,transferring,transferSiteRates,filteredTransferSiteRates};', {
    require: name => name === 'vue' ? testVue : name.includes('useServerList') ? serverList : name.includes('useRealtimeRefresh') ? { useRealtimeRefresh: (_, options) => { refreshOptions = options } } : name.includes('utils/employee') ? employeeUtils : name.includes('alertmessage/messages') ? messages : name.includes('requestError') ? require('../shared/utils/requestError.ts') : {},
    defineEmits: () => () => {}, $fetch: fetch,
  }))
  return { state, refreshOptions, close: () => scope.stop() }
}
const result = { items: [
  { EmployeeID: 1, FirstName: 'Ana', LastName: 'Test', AgencyID: 1, PositionID: 10 },
  { EmployeeID: 2, FirstName: 'Ben', LastName: 'Test', AgencyID: 2, PositionID: 10 },
  { EmployeeID: 3, FirstName: 'Cara', LastName: 'Test', AgencyID: 2, PositionID: 20 },
], pagination:{page:1,pages:1,total:3}, agencies: [], positions: [], agencyPositions: [] }

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
    pending.shift()(result); await Promise.all([initial, refresh]); await vue.nextTick()
    assert.equal(harness.state.loading.value, false)
    const reload = harness.state.load()
    assert.equal(harness.state.loading.value, false)
    assert.equal(harness.state.items.value.length, 3)
    pending.shift()(result); await reload; await vue.nextTick()
    assert.equal(requests[0].options.timeout, 15000)
    assert.equal(requests[0].options.retry, 0)
    harness.state.modalOpen.value = true
    assert.equal(harness.refreshOptions.shouldRefresh(), false)
  } finally { harness.close() }
})

test('agency, position, and search request filtered server pages after debounce', async () => {
  let requests = 0
  const harness = workspace(async (url, options) => {
    requests++;const q=options.query
    const items=result.items.filter(e=>(!q.agencyId||String(e.AgencyID)===q.agencyId)&&(!q.positionId||String(e.PositionID)===q.positionId)&&(!q.search||e.FirstName.toLowerCase().includes(q.search.toLowerCase())))
    return {...result,items,pagination:{page:1,pages:1,total:items.length}}
  })
  const settled=async()=>{await vue.nextTick();await new Promise(r=>setTimeout(r,350));await vue.nextTick()}
  try {
    await harness.state.load();await vue.nextTick()
    harness.state.filters.value.agencyId='2';await settled()
    assert.equal(harness.state.filteredItems.value.length,2)
    harness.state.filters.value.positionId='20';await settled()
    assert.equal(harness.state.filteredItems.value[0].EmployeeID,3)
    harness.state.search.value='missing';await settled()
    assert.equal(harness.state.filteredItems.value.length,0)
    harness.state.search.value='Cara';await settled()
    assert.equal(harness.state.filteredItems.value.length,1)
    harness.state.filters.value.agencyId='';await settled()
    assert.equal(harness.state.filters.value.positionId,'')
    harness.state.search.value='';await settled()
    assert.equal(harness.state.filteredItems.value.length,3)
    assert.ok(requests>1)
  } finally { harness.close() }
})

test('failed request clears loading and allows the next request to recover', async () => {
  let requests = 0
  const harness = workspace(async () => { if (++requests === 1) throw {name:'FetchError',message:'[GET] "/api/employees": no response'}; return result })
  try {
    await harness.state.load();await vue.nextTick()
    assert.equal(harness.state.loading.value, false)
    assert.match(harness.state.error.value, /Cannot connect to the server/)
    await harness.state.load(true);await vue.nextTick()
    assert.equal(harness.state.items.value.length, 3)
    assert.equal(harness.state.error.value, '')
  } finally { harness.close() }
})
