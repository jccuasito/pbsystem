const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), { transformSync } = require('esbuild'), h3 = require('h3')
function load(file, overrides = {}) {
  const module = { exports: {} }
  const code = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code
  vm.runInThisContext(`(function(module,exports,require,defineEventHandler,defineNitroPlugin){${code}\n})`)(module, module.exports, name => Object.hasOwn(overrides, name) ? overrides[name] : require(name), h3.defineEventHandler, plugin => plugin)
  return module.exports
}
const { managePool } = load('server/connection/managedPool.ts')
const capacity = load('server/utils/requestCapacity.ts')
const flush = () => new Promise(resolve => setImmediate(resolve))

test('50 simultaneous dashboard readers share one read, then settled data and failures are not cached', async () => {
  let calls = 0, finish
  const read = () => { calls++; return new Promise(resolve => { finish = resolve }) }
  const clients = Array.from({ length: 50 }, () => capacity.coalesceRead('test', read))
  await flush(); assert.equal(calls, 1); finish({ value: 42 })
  assert.ok((await Promise.all(clients)).every(row => row.value === 42))
  assert.equal(await capacity.coalesceRead('test', async () => 'fresh'), 'fresh')
  await assert.rejects(capacity.coalesceRead('failed', async () => { throw Error('temporary') }))
  assert.equal(await capacity.coalesceRead('failed', async () => 'recovered'), 'recovered')
})

test('database acquisition timeout releases a late connection and leaves no active lease', async () => {
  let deliver, releases = 0
  const managed = managePool({ getConnection: () => new Promise(resolve => { deliver = resolve }) }, 10)
  await assert.rejects(managed.pool.getConnection(), error => error.statusCode === 503)
  deliver({ release: () => releases++ }); await flush()
  assert.equal(releases, 1); assert.equal(managed.metrics().active, 0); assert.equal(managed.metrics().acquiring, 0)
  assert.equal(managed.metrics().timeouts, 1)
})

test('pool uses bound values, releases successful/failed queries and never retries a mutation', async () => {
  let calls = 0, releases = 0, fail
  const connection = () => ({
    execute: async (sql, values) => { calls++; if (fail) throw fail; return [[{ sql, values }], []] },
    release: () => releases++, destroy() {}, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {},
  })
  const managed = managePool({ getConnection: async () => connection() }, 100)
  const payload = "' OR 1=1 --", result = await managed.pool.execute('SELECT ? AS value', [payload])
  assert.equal(result[0][0].sql, 'SELECT ? AS value'); assert.deepEqual(result[0][0].values, [payload])
  fail = Object.assign(Error('lost'), { code: 'ECONNRESET' })
  await assert.rejects(managed.pool.execute('UPDATE employee SET Status=?', ['Active']), error => error.statusCode === 503)
  assert.equal(calls, 2); assert.equal(releases, 2); assert.equal(managed.metrics().active, 0)
  fail = Object.assign(Error('duplicate'), { code: 'ER_DUP_ENTRY' })
  await assert.rejects(managed.pool.execute('INSERT ...', []), error => error === fail)
  const saturated = managePool({ getConnection: async () => { throw Error('Queue limit reached.') } }, 100)
  await assert.rejects(saturated.pool.getConnection(), error => error.statusCode === 503)
})

test('capacity rejects overload before work, reserves reads during heavy writes, and releases once after completion', () => {
  const event = (method = 'GET') => ({ method, path: '/api/test', context: {}, node: { req: { method }, res: { setHeader() {} } } })
  const heavy = [], reads = []
  try {
    for (let n = 0; n < capacity.requestCapacity().limits.heavy; n++) { const e = event('POST'); capacity.admitApiRequest(e, '/api/payroll/processing/save'); heavy.push(e) }
    assert.throws(() => capacity.admitApiRequest(event('POST'), '/api/attendance/dtr/1/records'), error => error.statusCode === 503)
    for (let n = heavy.length; n < capacity.requestCapacity().limits.requests; n++) { const e = event(); capacity.admitApiRequest(e, '/api/employees'); reads.push(e) }
    assert.throws(() => capacity.admitApiRequest(event(), '/api/employees'), error => error.statusCode === 503)
  } finally { for (const e of [...heavy, ...reads]) { capacity.completeApiRequest(e); capacity.completeApiRequest(e) } }
  assert.equal(capacity.requestCapacity().active, 0); assert.equal(capacity.requestCapacity().heavy, 0)
})

test('custom error-rendered requests free capacity; recoverable captured errors do not free active work', () => {
  const hooks = {}, event = { method: 'GET', path: '/api/test', context: {} }
  load('server/plugins/request-capacity.ts', { '../utils/requestCapacity': capacity }).default({ hooks: { hook: (name, fn) => { hooks[name] = fn } } })
  capacity.admitApiRequest(event, event.path)
  hooks.error(Error('recoverable'), { event })
  assert.equal(capacity.requestCapacity().active, 1)
  hooks.error(Error('handler finished with 401'), { event, tags: ['request'] })
  hooks.afterResponse(event)
  assert.equal(capacity.requestCapacity().active, 0)
})

test('dashboard stats authorize each caller while 50 callers share four SQL statements', async () => {
  let checks = 0, queries = 0
  const handler = load('server/api/dashboard/stats.get.ts', {
    '../../utils/requestCapacity': capacity,
    '../../connection/dbconnect': { execute: async () => { queries++; await flush(); return [[{}], []] } },
    '../../utils/auth': { requireSession: e => { checks++; if (e.anonymous) throw h3.createError({ statusCode: 401 }); return { sub: 1 } } },
  }).default
  await assert.rejects(handler({ anonymous: true }), error => error.statusCode === 401)
  const rows = await Promise.all(Array.from({ length: 50 }, () => handler({})))
  assert.equal(checks, 51); assert.equal(queries, 4); assert.equal(rows[0].stats.length, 6)
})

test('background refresh pauses hidden/offline tabs, backs off errors and clears timers when unmounted', async () => {
  const mounted = [], unmounted = [], timers = new Map(), listeners = new Map(); let timerId = 0, calls = 0, fail = false
  const window = { setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id }, clearTimeout: id => timers.delete(id), addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
  const document = { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} }, navigator = { onLine: true }
  const module = { exports: {} }, source = transformSync(fs.readFileSync('app/composables/useRealtimeRefresh.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code
  vm.runInNewContext(source, { module, window, document, navigator, Math: { random: () => 0.5, min: Math.min }, require: () => ({ onMounted: fn => mounted.push(fn), onActivated() {}, onDeactivated() {}, onBeforeUnmount: fn => unmounted.push(fn) }) })
  module.exports.useRealtimeRefresh(async () => { calls++; if (fail) throw Error('offline') }, { immediate: true })
  mounted[0](); await flush(); assert.equal(calls, 0)
  document.visibilityState = 'visible'; await listeners.get('focus')(); assert.equal(calls, 1)
  navigator.onLine = false; await listeners.get('focus')(); assert.equal(calls, 1)
  navigator.onLine = true; fail = true; await listeners.get('online')(); assert.equal(calls, 2)
  assert.ok([...timers.values()][0].delay >= 20000)
  unmounted[0](); assert.equal(timers.size, 0); assert.equal(listeners.size, 0)
})
