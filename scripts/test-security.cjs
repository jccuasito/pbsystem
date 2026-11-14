const { test, before, after } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), http = require('node:http')
const { transformSync } = require('esbuild'), h3 = require('h3')
function load(file, overrides = {}, cache = new Map()) {
  const full = path.resolve(file); if (cache.has(full)) return cache.get(full).exports
  const module = { exports: {} }; cache.set(full, module)
  const req = name => {
    if (Object.hasOwn(overrides, name)) return overrides[name]
    if (name.startsWith('.')) { const target = path.resolve(path.dirname(full), name); return load(fs.existsSync(target) ? target : target + '.ts', overrides, cache) }
    return require(name)
  }
  const code = transformSync(fs.readFileSync(full, 'utf8'), { loader: 'ts', format: 'cjs' }).code
  vm.runInThisContext(`(function(module,exports,require,defineEventHandler){${code}\n})`, { filename: full })(module, module.exports, req, h3.defineEventHandler)
  return module.exports
}
const validation = load('server/utils/inputValidation.ts'), security = load('server/utils/requestSecurity.ts')
const denied = status => error => error.statusCode === status

test('validation preserves legitimate names / SQL-looking text and rejects object confusion', () => {
  const name = "Ma. Niño O'Brien", sql = "x' OR 1=1; DROP TABLE employee; --"
  assert.equal(validation.textInput(' ' + name + ' ', 'name', 100), name)
  assert.equal(validation.validateRequestObject({ name, remarks: sql }).remarks, sql)
  for (const value of [null, [], 'text', 0]) assert.throws(() => validation.validateRequestObject(value), denied(400))
  for (const value of [true, [1], {}, "1 OR 1=1", '9007199254740992']) assert.throws(() => validation.validateRequestObject({ EmployeeID: value }), denied(400))
  for (const value of ['{"__proto__":{"admin":true}}', '{"row":{"constructor":{}}}', '{"x":1e999}']) assert.throws(() => validation.validateRequestObject(JSON.parse(value)), denied(400))
  assert.equal({}.admin, undefined)
  assert.throws(() => validation.emailInput({ toString: () => 'x@y.com' }), denied(400))
  assert.throws(() => validation.validateRequestObject({ name: 'a\0b' }), denied(400))
  assert.throws(() => validation.calendarDate('2026-02-30', 'date'), denied(400))
  assert.equal(validation.calendarDate('2028-02-29', 'date'), '2028-02-29')
})

test('images require matching signatures and canonical base64, not just extensions / MIME labels', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP6kAAAAASUVORK5CYII=', 'base64')
  assert.equal(validation.imageData('data:image/png;base64,' + png.toString('base64')).extension, 'png')
  for (const raw of ['data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64'), 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,' + png.toString('base64'), 'data:image/png;base64,%%%%']) assert.throws(() => validation.imageData(raw), denied(400))
})

test('staff session rejects Google-signup proof, missing subject and disallowed signing algorithm', () => {
  const auth = load('server/utils/auth.ts', { './jwt': { verifyToken: value => JSON.parse(value) } })
  const event = claims => ({ node: { req: { headers: { cookie: 'pbs_session=' + encodeURIComponent(JSON.stringify(claims)) } } } })
  for (const claims of [{ signup: true, email: 'test@example.com' }, { sub: -1, email: 'test@example.com', userType: 'Admin' }, { sub: 1, email: 'test@example.com', userType: 'root' }]) assert.throws(() => auth.requireSession(event(claims)), denied(401))
  assert.equal(auth.requireSession(event({ sub: 1, email: 'test@example.com', userType: 'Viewer' })).sub, 1)
  for (const pass of [[], 'a1', 'a'.repeat(72) + '1', 'é'.repeat(36) + '1']) assert.throws(() => auth.assertPassword(pass), denied(400))
  const original = process.env.JWT_SECRET; process.env.JWT_SECRET = 'test-only-security-secret-'.repeat(3)
  try {
    const jwt = load('server/utils/jwt.ts'), lib = require('jsonwebtoken')
    const payload = { sub: 1, email: 'test@example.com', userType: 'Admin' }
    assert.equal(jwt.verifyToken(jwt.signToken(payload)).sub, 1)
    assert.throws(() => jwt.verifyToken(lib.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS384', issuer: 'pbsystem', audience: 'pbsystem-web' })))
  } finally { if (original === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = original }
})

let server, base
before(async () => {
  const access = {
    currentActor: async event => { if (!h3.getHeader(event, 'x-test-staff')) throw h3.createError({ statusCode: 401 }); return { UserID: 1, UserType: 'Admin', Status: 'Active' } },
    requireAdmin: async event => { if (h3.getHeader(event, 'x-test-staff') !== 'admin') throw h3.createError({ statusCode: 403 }) }
  }
  const guard = load('server/middleware/00-security.ts', { '../utils/settingsAccess': access, '../utils/employeePortalAuth': { requireEmployeeSession: async event => { if (!h3.getHeader(event, 'x-test-employee')) throw h3.createError({ statusCode: 401 }) } } }).default
  const app = h3.createApp(); app.use(guard)
  app.use(h3.defineEventHandler(async event => {
    if (event.path === '/bounded') return { bytes: (await security.readBoundedBody(event, 1024)).length }
    return { body: event.method === 'POST' ? await h3.readBody(event) : null, query: h3.getQuery(event) }
  }))
  server = http.createServer(h3.toNodeListener(app)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port
})
after(async () => { await new Promise(resolve => server.close(resolve)) })
const post = (route, body, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

test('all staff modules and employee portal deny anonymous requests, including future routes', async () => {
  for (const module of ['dashboard', 'employees', 'organization', 'attendance', 'payroll', 'billing', 'rates', 'deductions-loans', 'settings', 'new-private-module', 'employee-portal']) assert.equal((await fetch(base + '/api/' + module + '/example')).status, 401)
  assert.equal((await post('/api/employee-portal/auth/profile', {})).status, 401)
  assert.equal((await post('/api/settings/backups/import', {}, { 'x-test-staff': 'viewer' })).status, 403)
  assert.equal((await fetch(base + '/API/Employees')).status, 400)
  assert.equal((await fetch(base + '/api/%65mployees')).status, 400)
  const response = await fetch(base + '/api/auth/departments')
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
})

test('JSON / query validation and CSRF rejection cover staff and employee mutations', async () => {
  for (const route of ['/api/employees', '/api/employee-portal/information']) {
    const headers = { 'x-test-staff': 'admin', 'x-test-employee': 'yes', origin: base }
    assert.equal((await post(route, { name: "O'Brien", EmployeeID: 1 }, headers)).status, 200)
    for (const body of ['null', '[]', '"text"', '{broken', '{"__proto__":{"admin":true}}', '{"EmployeeID":{"x":1}}']) assert.equal((await post(route, body, headers)).status, 400)
    assert.equal((await post(route, {}, { ...headers, origin: 'https://attacker.example' })).status, 403)
    assert.equal((await post(route, {}, { ...headers, 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal((await post(route, 'name=test', { ...headers, 'content-type': 'application/x-www-form-urlencoded' })).status, 415)
  }
  assert.equal((await fetch(base + '/api/auth/departments?id=1&id=2')).status, 400)
  assert.equal((await fetch(base + '/api/auth/departments?search=%00')).status, 400)
  const response = await post('/api/auth/login', { email: 'real@example.com', password: "O'Brien123456" })
  assert.equal((await response.json()).body.password, "O'Brien123456")
})

test('DTR Excel import permits employee codes and incomplete punches without bypassing other request checks', async () => {
  const route = '/api/attendance/dtr/11/records', headers = { 'x-test-staff': 'admin', origin: base }
  const body = { ImportRows: true, Rows: [
    { EmployeeID: 'DJA-0001', AttendanceDate: '2026-09-16', ShiftCode: 'DS0700-1900', TimeIn: '07:00', TimeOut: '19:00' },
    { EmployeeID: 'EMP-0011', AttendanceDate: '2026-09-17', TimeIn: '22:00', TimeOut: '' },
    { EmployeeID: 'DJA-0001', AttendanceDate: '2026-09-18', TimeIn: '', TimeOut: '19:00' },
    { EmployeeID: 'EMP-0011', AttendanceDate: '2026-09-19', TimeIn: '', TimeOut: '' },
  ] }
  const response = await post(route, body, headers)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).body, body)
  assert.equal((await post(route, body)).status, 401)
  assert.equal((await post(route, body, { ...headers, origin: 'https://attacker.example' })).status, 403)
  for (const invalidBody of [
    { ...body, EmployeeID: 'DJA-0001' },
    { ...body, Rows: [{ EmployeeID: { value: 'DJA-0001' } }] },
    { ...body, Rows: [{ EmployeeID: ['DJA-0001'] }] },
    { ...body, Rows: [{ EmployeeID: true }] },
    { ...body, Rows: [{ EmployeeID: 'a'.repeat(191) }] },
    { ...body, Rows: [{ EmployeeID: 'DJA-0001', ShiftCodeID: 'DS0700-1900' }] },
    { ...body, Rows: [{ EmployeeID: 'DJA-0001', nested: { EmployeeID: 'DJA-0001' } }] },
    JSON.parse('{"ImportRows":true,"Rows":[{"EmployeeID":"DJA-0001","__proto__":{"admin":true}}]}'),
  ]) assert.equal((await post(route, invalidBody, headers)).status, 400)
  assert.equal((await post(route, { ...body, ImportRows: false }, headers)).status, 400)
  assert.equal((await post('/api/employees', body, headers)).status, 400)
  assert.equal((await post('/api/attendance/dtr/11/btr', body, headers)).status, 400)
})

test('auth throttles identity across requests without trusting spoofed forwarded addresses', async () => {
  let response
  for (let i = 0; i < 6; i++) response = await post('/api/auth/verify-email', { email: 'bounded@example.com', code: '000000' }, { 'x-forwarded-for': '198.51.100.' + i })
  assert.equal(response.status, 429); assert.ok(Number(response.headers.get('retry-after')) > 0)
})

test('bounded body rejects chunked overflow and declared excess', async () => {
  const request = headers => new Promise((resolve, reject) => {
    const req = http.request(base + '/bounded', { method: 'POST', headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) }); req.on('error', reject)
    req.write(Buffer.alloc(700)); req.end(Buffer.alloc(700))
  })
  assert.equal(await request({ 'transfer-encoding': 'chunked' }), 413)
  assert.equal(await request({ 'content-length': '1400' }), 413)
})

test('SQL injection payload remains a bind value in the DTR search, never SQL syntax', async () => {
  const calls = [], attack = "%' OR 1=1; DROP TABLE attendance; --"
  const stub = { execute: async (sql, args = []) => { calls.push([sql, args]); return [[]] } }
  const dependencies = { h3: { ...h3, getQuery: () => ({ search: attack }) }, '../connection/dbconnect': stub, './auth': { requireSession: () => ({ sub: 1 }) } }
  for (const name of ['./dtrBtrCrud', './employeeStatusCrud.ts', './rateVersions', './payrollAdjustmentCrud', './dtrWorkflowAudit', './dtrDeploymentDates']) dependencies[name] = {}
  const dtr = load('server/utils/dtrCrud.ts', dependencies)
  await dtr.listDtrs({ node: { req: { url: '/api/attendance/dtr?search=' + encodeURIComponent(attack) } } })
  const search = calls.find(([sql]) => sql.includes('GROUP BY d.BatchID'))
  assert.ok(search); assert.ok(!search[0].includes(attack)); assert.deepEqual(search[1], ['%' + attack + '%', '%' + attack + '%', '%' + attack + '%'])
})

test('public staff registration cannot select its own role or activate itself', async () => {
  const calls = [], body = { firstName: "Niño O'Brien", lastName: 'Test', gender: 'Male', email: 'new-staff@example.com', password: 'Valid-testing-password123', departmentId: '', UserType: 'Admin', Status: 'Active' }
  const connection = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, execute: async (sql, args) => { calls.push([sql, args]); return sql.startsWith('SELECT') ? [[]] : [{ insertId: 1 }] } }
  const handler = load('server/api/auth/register.post.ts', {
    h3: { ...h3, readBody: async () => body, getCookie: () => null },
    '../../connection/dbconnect': { getConnection: async () => connection },
    '../../utils/auth': { assertPassword: () => {}, normalizeEmail: validation.emailInput, hashPassword: async () => 'synthetic-hash', randomVerificationCode: () => '123456', hashToken: token => 'hashed-' + token },
    '../../utils/mailer': { sendVerificationEmail: async () => {} }, '../../utils/jwt': {}
  }).default
  const result = await handler({})
  const insert = calls.find(([sql]) => sql.startsWith('INSERT'))
  assert.ok(insert[0].includes("'Viewer', 'Inactive'")); assert.ok(!insert[0].includes(body.firstName)); assert.equal(insert[1][0], body.firstName)
  assert.match(result.message, /administrator must activate/)
})

test('new Google staff account stays inactive with no issued session; existing inactive accounts cannot log in', async () => {
  for (const existing of [[], [{ UserID: 1, Status: 'Inactive' }]]) {
    const calls = [], connection = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, execute: async (sql, args) => { calls.push([sql, args]); return sql.startsWith('SELECT') ? [existing] : [{ insertId: 1 }] } }
    const google = load('server/utils/googleSignIn.ts', { '../connection/dbconnect': { getConnection: async () => connection }, './auth': { normalizeEmail: validation.emailInput, setSession: () => { throw Error('No session may be issued') } }, './jwt': {} })
    await assert.rejects(() => google.googleSignIn({ node: { req: { socket: {}, headers: {} } } }, { email: 'new-google@example.com', emailVerified: true, googleId: '123', firstName: 'Test', lastName: 'User' }), denied(403))
    if (!existing.length) assert.ok(calls.find(([sql]) => sql.startsWith('INSERT'))[0].includes("'Viewer', 'Inactive'"))
    else assert.equal(calls.length, 1)
  }
})

test('private profile images reject guests, restricted staff and traversal before reading files', async () => {
  let actor = null, viewed = false, queried = false
  const images = load('server/utils/profileImageResponse.ts', {
    h3: { ...h3, getRouterParam: event => event.name, setHeader: () => {} },
    './auth': { requireSession: () => { if (!actor) throw h3.createError({ statusCode: 401 }); return { sub: actor.UserID } } },
    './settingsAccess': { currentActor: async () => actor, accessForUser: async () => ({ employees: { canView: false } }) },
    '../connection/dbconnect': { execute: async () => { queried = true; return [[{ EmployeeID: 1 }]] } },
    'node:fs': { promises: { readFile: async () => { viewed = true; return Buffer.from('test-image') } } }
  })
  const event = { name: 'employee-1-abcdef123456.png' }
  await assert.rejects(() => images.profileImageResponse(event, 'employees'), denied(401))
  actor = { UserID: 1, UserType: 'Viewer' }
  await assert.rejects(() => images.profileImageResponse(event, 'employees'), denied(403))
  assert.equal(viewed, false); assert.equal(queried, false)
  actor = { UserID: 1, UserType: 'Admin' }
  await assert.rejects(() => images.profileImageResponse({ name: '../../.env' }, 'avatars'), denied(404))
  assert.equal(viewed, false); assert.equal(queried, false)
  assert.equal((await images.profileImageResponse(event, 'employees')).toString(), 'test-image')
})
