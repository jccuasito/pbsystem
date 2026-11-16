// Real SQL runs only against connection-local temporary tables. SMTP is always mocked.
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { transformSync } = require('esbuild'), h3 = require('h3')
function load(file, overrides = {}, cache = new Map()) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full).exports
  const module = { exports: {} }; cache.set(full, module)
  const req = name => {
    if (Object.hasOwn(overrides, name)) return overrides[name]
    if (name.includes('dbconnect') && overrides.database) return overrides.database
    if (name.startsWith('.')) { const target = path.resolve(path.dirname(full), name); return load(fs.existsSync(target) ? target : target + '.ts', overrides, cache) }
    return require(name)
  }
  vm.runInThisContext('(function(module,exports,require,defineEventHandler){' + transformSync(fs.readFileSync(full, 'utf8'), { loader: 'ts', format: 'cjs' }).code + '\n})', { filename: full })(module, module.exports, req, h3.defineEventHandler)
  return module.exports
}
const denied = status => error => error.statusCode === status
const syntheticEmail = 'synthetic@example.invalid'
function mailFixture(t) {
  const names = ['GMAIL_USER', 'GMAIL_APP_PASSWORD', 'APP_URL', 'NODE_ENV']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  Object.assign(process.env, { GMAIL_USER: syntheticEmail, GMAIL_APP_PASSWORD: 'synthetic-only', APP_URL: 'https://payroll.example.invalid', NODE_ENV: 'production' })
  t.after(() => { for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name] })
  const state = { sent: [], fail: false }
  const mailer = load('server/utils/mailer.ts', { nodemailer: { createTransport: () => ({ sendMail: async mail => { if (state.fail) throw Error('Synthetic SMTP failure'); state.sent.push(mail) } }) } })
  return { state, mailer }
}

test('verification email contains a real clickable, expiring link and requires a production app URL', async t => {
  const { state, mailer } = mailFixture(t), token = 'a'.repeat(64)
  await mailer.sendVerificationEmail(syntheticEmail, token)
  assert.match(state.sent[0].text, /https:\/\/payroll\.example\.invalid\/verify-email\?token=a{64}/)
  assert.match(state.sent[0].html, /<a href="https:\/\/payroll\.example\.invalid\/verify-email\?token=a{64}">Verify email address<\/a>/)
  assert.match(state.sent[0].text, /15 minutes/)
  delete process.env.APP_URL
  await assert.rejects(() => mailer.sendVerificationEmail(syntheticEmail, token), /APP_URL/)
  assert.equal(state.sent.length, 1)
})

test('Admin deletion rolls back and releases the connection if closing its sessions fails', async () => {
  let rolledBack = false, committed = false, released = false
  const connection = { beginTransaction: async () => {}, commit: async () => { committed = true }, rollback: async () => { rolledBack = true }, release: () => { released = true }, execute: async sql => {
    if (sql.startsWith('SELECT UserType')) return [[{ UserType: 'Admin', Status: 'Active' }]]
    if (sql.startsWith('SELECT UserID')) return [[{ UserID: 2, Status: 'Inactive' }]]
    if (sql.startsWith('UPDATE `user`')) return [{ affectedRows: 1 }]
    if (sql.startsWith('UPDATE user_history')) throw Error('Synthetic history write failure')
    throw Error('Unexpected query')
  } }
  const handler = load('server/api/settings/users/[id].delete.ts', { database: { getConnection: async () => connection }, h3: { ...h3, readBody: async e => e.body, getRouterParam: e => e.id }, '../../../utils/auth': { requireSession: () => ({ sub: 1 }) }, '../../../utils/settingsAccess': { requireAdmin: async () => {} } }).default
  await assert.rejects(() => handler({ id: '2', body: { confirmation: 'DELETE' } }), /Synthetic history write failure/)
  assert.equal(rolledBack, true); assert.equal(committed, false); assert.equal(released, true)
})

test('staff account lifecycle on real MySQL with synthetic temporary tables', { skip: process.env.STAFF_SIGNUP_TEST_DATABASE !== '1' }, async t => {
  const env = { ...require('node:util').parseEnv(fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : ''), ...process.env }
  const c = await require('mysql2/promise').createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306), user: env.DB_USER || 'root', password: env.DB_PASSWORD, database: env.DB_NAME || 'pbsystem' })
  const { state, mailer } = mailFixture(t)
  try {
    await c.query("CREATE TEMPORARY TABLE `user` (UserID INT PRIMARY KEY AUTO_INCREMENT,FirstName VARCHAR(100),LastName VARCHAR(100),Gender VARCHAR(30),Email VARCHAR(150) NOT NULL UNIQUE,Password VARCHAR(255),AuthProvider VARCHAR(20),GoogleID VARCHAR(100) UNIQUE,EmailVerified TINYINT DEFAULT 0,VerificationToken CHAR(64),VerificationTokenExpiry DATETIME,ResetPasswordToken VARCHAR(255),ResetPasswordExpiry DATETIME,DepartmentID INT,UserType VARCHAR(20),Status VARCHAR(20),Image VARCHAR(255),CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB")
    const migration = fs.readFileSync('database/staff-account-deletion.sql', 'utf8')
    await c.query(migration); await c.query(migration)
    await c.query('CREATE TEMPORARY TABLE department (DepartmentID INT PRIMARY KEY,DepartmentName VARCHAR(100),Status VARCHAR(20)) ENGINE=InnoDB')
    await c.query('CREATE TEMPORARY TABLE user_history (HistoryID INT PRIMARY KEY AUTO_INCREMENT,UserID INT,LoginDateTime DATETIME,LogoutDateTime DATETIME,IPAddress VARCHAR(45),Device VARCHAR(100)) ENGINE=InnoDB')
    await c.query('CREATE TEMPORARY TABLE user_module_permission (UserID INT,ModuleKey VARCHAR(40),CanView TINYINT,CanEdit TINYINT,UpdatedBy INT,PRIMARY KEY(UserID,ModuleKey)) ENGINE=InnoDB')
    await c.query('CREATE TEMPORARY TABLE synthetic_business_history (RecordID INT PRIMARY KEY,CreatedBy INT,Amount DECIMAL(12,2)) ENGINE=InnoDB')
    await c.query("INSERT INTO `user` (UserID,FirstName,LastName,Email,UserType,Status,EmailVerified) VALUES (1,'Synthetic','Admin','admin@example.invalid','Admin','Active',1)")
    await c.query("INSERT INTO department VALUES (1,'Synthetic department','Active'),(2,'Retired department','Inactive')")
    const connection = { execute: (...args) => c.execute(...args), beginTransaction: () => c.beginTransaction(), commit: () => c.commit(), rollback: () => c.rollback(), release() {} }
    const db = { execute: (...args) => c.execute(...args), getConnection: async () => connection }
    const mockH3 = { ...h3, readBody: async e => e.body, getQuery: e => e.query || {}, getRouterParam: e => e.id, getCookie: (e, name) => e.cookies?.[name], setCookie: (e, name, value) => { (e.cookies ||= {})[name] = value } }
    const jwt = { signToken: claims => JSON.stringify(claims), verifyToken: token => JSON.parse(token) }
    const deps = { database: db, h3: mockH3, '../../utils/mailer': mailer, './jwt': jwt, '../../utils/jwt': jwt }, cache = new Map()
    const route = file => load('server/api/' + file + '.ts', deps, cache).default
    const register = route('auth/register.post'), verify = route('auth/verify-email.get'), verifyCode = route('auth/verify-email.post'), resend = route('auth/resend-verification.post'), login = route('auth/login.post'), remove = route('settings/users/[id].delete'), selfDelete = route('auth/account.delete'), directory = route('settings/users.get'), saveAccess = route('settings/users.put')
    const { currentActor, MODULES } = load('server/utils/settingsAccess.ts', deps, cache)
    const google = load('server/utils/googleSignIn.ts', deps, cache).googleSignIn
    const event = body => ({ body, node: { req: { socket: { remoteAddress: '127.0.0.1' }, headers: { 'user-agent': 'Synthetic test' } } } })
    const admin = (id, confirmation = 'DELETE', role = 'Admin') => ({ ...event({ confirmation }), id: String(id), cookies: { pbs_session: JSON.stringify({ sub: role === 'Admin' ? 1 : 2, email: syntheticEmail, userType: role }) } })
    const body = { firstName: "Synthetic O'Brien", lastName: 'Signup', gender: 'Male', email: syntheticEmail, password: 'Synthetic-test-password123', departmentId: 1, UserType: 'Admin', Status: 'Inactive', EmailVerified: 1 }
    const account = async email => (await c.execute('SELECT * FROM `user` WHERE Email=?', [email]))[0][0]
    const tokenFromMail = () => new URL(state.sent.at(-1).text.match(/https:\/\/[^\s]+/)[0]).searchParams.get('token')
    let token, id
    await t.test('signup is Active Viewer with hashed token; verification still gates password login', async () => {
      const result = await register(event(body)), user = await account(syntheticEmail)
      id = user.UserID; token = tokenFromMail()
      assert.equal(result.accountCreated, true); assert.equal(result.emailSent, true); assert.equal(result.requiresVerification, true)
      assert.equal(user.Status, 'Active'); assert.equal(user.UserType, 'Viewer'); assert.equal(user.EmailVerified, 0); assert.equal(user.DepartmentID, 1)
      assert.match(token, /^[a-f0-9]{64}$/); assert.notEqual(user.VerificationToken, token)
      assert.equal(user.VerificationToken, require('node:crypto').createHash('sha256').update(token).digest('hex'))
      await assert.rejects(() => login(event({ email: syntheticEmail, password: body.password })), error => error.statusCode === 403 && /verify/.test(error.statusMessage))
      await assert.rejects(() => register(event(body)), denied(409))
      assert.equal((await c.query('SELECT COUNT(*) AS n FROM `user` WHERE Email=?', [syntheticEmail]))[0][0].n, 1)
    })
    await t.test('failed SMTP resend rolls back token rotation; successful resend replaces old link', async () => {
      const before = (await account(syntheticEmail)).VerificationToken
      state.fail = true; await assert.rejects(() => resend(event({ email: syntheticEmail })), denied(503)); state.fail = false
      assert.equal((await account(syntheticEmail)).VerificationToken, before)
      await resend(event({ email: syntheticEmail })); const newer = tokenFromMail()
      assert.notEqual(newer, token); await assert.rejects(() => verify({ query: { token } }), denied(400)); token = newer
      const sent = state.sent.length
      await resend(event({ email: 'missing@example.invalid' })); assert.equal(state.sent.length, sent)
    })
    await t.test('expired/malformed links fail; fresh link is single-use and permits login', async () => {
      await assert.rejects(() => verify({ query: { token: ['invalid'] } }), denied(400))
      await c.execute('UPDATE `user` SET VerificationTokenExpiry=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE UserID=?', [id])
      await assert.rejects(() => verify({ query: { token } }), denied(400))
      await resend(event({ email: syntheticEmail })); token = tokenFromMail()
      await verify({ query: { token } }); await assert.rejects(() => verify({ query: { token } }), denied(400))
      const e = event({ email: syntheticEmail, password: body.password }), result = await login(e)
      assert.equal(result.user.userType, 'Viewer'); assert.ok(e.cookies.pbs_session)
      assert.equal((await account(syntheticEmail)).VerificationToken, null)
      const sent = state.sent.length; await resend(event({ email: syntheticEmail })); assert.equal(state.sent.length, sent)
    })
    await t.test('new account survives initial email failure and can recover through resend without signing up twice', async () => {
      state.fail = true
      const result = await register(event({ ...body, email: 'smtp-failure@example.invalid' })); state.fail = false
      assert.equal(result.accountCreated, true); assert.equal(result.requiresVerification, true); assert.equal(result.emailSent, false)
      assert.equal((await account('smtp-failure@example.invalid')).Status, 'Active')
      await resend(event({ email: 'smtp-failure@example.invalid' })); await verify({ query: { token: tokenFromMail() } })
    })
    await t.test('Admin can delete Active and Inactive accounts and reuse their email without removing their internal ID', async () => {
      for (const status of ['Active', 'Inactive']) {
        await register(event({ ...body, email: 'unused@example.invalid' }))
        const user = await account('unused@example.invalid')
        await c.execute('UPDATE `user` SET Status=? WHERE UserID=?', [status, user.UserID])
        await assert.rejects(() => remove(admin(user.UserID, 'wrong')), denied(400))
        await remove(admin(user.UserID)); assert.equal(await account('unused@example.invalid'), undefined)
        const [[deleted]] = await c.execute('SELECT * FROM `user` WHERE UserID=?', [user.UserID])
        assert.ok(deleted.DeletedAt); assert.equal(deleted.DeletedBy, 1); assert.equal(deleted.Password, null); assert.equal(deleted.Email, null); assert.equal(deleted.Status, 'Inactive')
        assert.equal((await directory(admin(1))).users.some(row => row.id === user.UserID), false)
        await assert.rejects(() => remove(admin(user.UserID)), denied(404))
        const update = admin(1); update.body = { userId: user.UserID, role: 'Viewer', status: 'Active', departmentId: null, access: Object.fromEntries(MODULES.map(module => [module.key, { canView: true, canEdit: false }])) }
        await assert.rejects(() => saveAccess(update), denied(404))
      }
      await register(event({ ...body, email: 'unused@example.invalid' }))
    })
    await t.test('Admin deletion rejects self, non-Admin and missing accounts', async () => {
      await assert.rejects(() => remove(admin(1)), denied(400))
      await assert.rejects(() => remove(admin(id, 'DELETE', 'Viewer')), denied(403))
      await assert.rejects(() => remove(admin(999999)), denied(404))
      assert.ok(await account(syntheticEmail)); assert.equal((await c.execute('SELECT COUNT(*) AS n FROM user_history WHERE UserID=?', [id]))[0][0].n, 1)
    })
    await t.test('legacy verification code works without reactivating a deliberately inactive account', async () => {
      await c.execute("UPDATE `user` SET Status='Inactive',EmailVerified=0,VerificationToken=?,VerificationTokenExpiry=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE) WHERE UserID=?", [require('node:crypto').createHash('sha256').update('123456').digest('hex'), id])
      await verifyCode(event({ email: syntheticEmail, code: '123456' }))
      assert.equal((await account(syntheticEmail)).Status, 'Inactive')
      await assert.rejects(() => login(event({ email: syntheticEmail, password: body.password })), denied(403))
    })
    await t.test('verified Google newcomer receives Active Viewer session; existing inactive Google account remains blocked', async () => {
      const profile = { googleId: 'synthetic-google-id', email: 'google@example.invalid', emailVerified: true, firstName: 'Synthetic', lastName: 'Google' }, e = event()
      const result = await google(e, profile)
      assert.equal(result.user.userType, 'Viewer'); assert.ok(e.cookies.pbs_session)
      assert.equal((await account(profile.email)).Status, 'Active'); assert.equal((await account(profile.email)).EmailVerified, 1)
      await c.execute("UPDATE `user` SET Status='Inactive' WHERE Email=?", [profile.email])
      await assert.rejects(() => google(event(), profile), denied(403))
    })
    await t.test('Google signup form creates Active Viewer with a link; completed-password proof cannot be replayed', async () => {
      const profile = { googleId: 'synthetic-form-google', email: 'google-form@example.invalid', emailVerified: true, firstName: 'Synthetic', lastName: 'Google form' }, e = event()
      await google(e, profile, 'signup')
      const signup = event({ ...body, email: profile.email }); signup.cookies = e.cookies
      await register(signup)
      const user = await account(profile.email)
      assert.equal(user.Status, 'Active'); assert.equal(user.UserType, 'Viewer'); assert.equal(user.AuthProvider, 'google'); assert.equal(user.GoogleID, profile.googleId); assert.equal(user.EmailVerified, 0)
      assert.match(tokenFromMail(), /^[a-f0-9]{64}$/)
      // A pre-completion proof must not replace a password after it has been set.
      const retry = event({ ...body, email: profile.email, password: 'Different-synthetic-password123' })
      retry.cookies = { pbs_google_signup: JSON.stringify({ signup: true, completeUserId: user.UserID, email: profile.email, googleId: profile.googleId }) }
      await assert.rejects(() => register(retry), denied(409))
      assert.equal((await account(profile.email)).Password, user.Password)
    })
    await t.test('Admin deletion preserves sign-in and business history with the original actor name', async () => {
      const original = await account(syntheticEmail)
      await c.execute("UPDATE `user` SET Status='Active' WHERE UserID=?", [id])
      await c.execute("INSERT INTO user_module_permission VALUES(?,'payroll',1,1,1)", [id])
      await c.execute('INSERT INTO synthetic_business_history VALUES(1,?,1234.56)', [id])
      const [before] = await c.execute('SELECT * FROM user_history WHERE UserID=?', [id])
      const oldClaims = { pbs_session: JSON.stringify({ sub: id, email: syntheticEmail, userType: 'Viewer' }) }
      assert.equal((await currentActor({ cookies: oldClaims })).UserID, id)
      await remove(admin(id))
      const [[retained]] = await c.execute('SELECT * FROM `user` WHERE UserID=?', [id])
      assert.equal(retained.FirstName, original.FirstName); assert.equal(retained.LastName, original.LastName); assert.equal(retained.DeletedBy, 1); assert.ok(retained.DeletedAt)
      const [after] = await c.execute('SELECT * FROM user_history WHERE UserID=?', [id])
      assert.equal(after.length, before.length)
      for (let n = 0; n < before.length; n++) { for (const key of ['HistoryID','UserID','LoginDateTime','IPAddress','Device']) assert.deepEqual(after[n][key], before[n][key]); assert.ok(after[n].LogoutDateTime) }
      const [[business]] = await c.query('SELECT h.RecordID,h.Amount,u.UserID,u.FirstName,u.LastName FROM synthetic_business_history h JOIN `user` u ON u.UserID=h.CreatedBy WHERE h.RecordID=1')
      assert.equal(business.UserID, id); assert.equal(business.Amount, '1234.56'); assert.equal(business.FirstName, original.FirstName)
      await assert.rejects(() => currentActor({ cookies: oldClaims }), denied(401))
      await register(event(body)); assert.notEqual((await account(syntheticEmail)).UserID, id)
      assert.equal((await account(syntheticEmail)).UserType, 'Viewer')
      const fresh = (await directory(admin(1))).users.find(user => user.email === syntheticEmail)
      assert.equal(fresh.access.payroll.canEdit, false)
      assert.equal((await c.execute('SELECT COUNT(*) AS n FROM user_module_permission WHERE UserID=?', [id]))[0][0].n, 1)
    })
    await t.test('self-delete clears credentials and all open sessions, preserves history, and releases the email', async () => {
      const email = 'self-delete@example.invalid'
      await register(event({ ...body, email })); await verify({ query: { token: tokenFromMail() } })
      const e = event({ email, password: body.password }); await login(e)
      const user = await account(email), staleClaims = { ...e.cookies }
      await c.execute('INSERT INTO user_history (UserID,LoginDateTime,IPAddress,Device) VALUES (?,UTC_TIMESTAMP(),?,?)', [user.UserID, '127.0.0.2', 'Synthetic second session'])
      await c.execute('UPDATE `user` SET ResetPasswordToken=?,ResetPasswordExpiry=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR) WHERE UserID=?', ['a'.repeat(64), user.UserID])
      e.body = { confirmation: 'wrong' }; await assert.rejects(() => selfDelete(e), denied(400))
      e.body = { confirmation: 'DELETE' }; await selfDelete(e)
      assert.equal(e.cookies.pbs_session, '')
      const [[deleted]] = await c.execute('SELECT * FROM `user` WHERE UserID=?', [user.UserID])
      for (const key of ['Email','Password','GoogleID','VerificationToken','VerificationTokenExpiry','ResetPasswordToken','ResetPasswordExpiry']) assert.equal(deleted[key], null)
      assert.equal(deleted.DeletedBy, user.UserID); assert.ok(deleted.DeletedAt); assert.equal(deleted.FirstName, body.firstName)
      const [histories] = await c.execute('SELECT * FROM user_history WHERE UserID=?', [user.UserID]); assert.equal(histories.length, 2); assert.ok(histories.every(row => row.LogoutDateTime))
      assert.equal((await directory(admin(1))).users.some(row => row.id === user.UserID), false)
      await assert.rejects(() => currentActor({ cookies: staleClaims }), denied(401))
      await assert.rejects(() => login(event({ email, password: body.password })), denied(401))
      await register(event({ ...body, email })); assert.notEqual((await account(email)).UserID, user.UserID)
    })
    await t.test('self-delete protects the last active Admin and allows another Admin to leave', async () => {
      const last = admin(1); await assert.rejects(() => selfDelete(last), denied(409)); assert.equal(last.cookies.pbs_session.length > 0, true)
      const [created] = await c.execute("INSERT INTO `user` (FirstName,LastName,Email,UserType,Status,EmailVerified) VALUES ('Synthetic','Second admin','second-admin@example.invalid','Admin','Active',1)")
      const second = event({ confirmation: 'DELETE' }); second.cookies = { pbs_session: JSON.stringify({ sub: created.insertId, email: 'second-admin@example.invalid', userType: 'Admin' }) }
      await selfDelete(second); assert.equal(second.cookies.pbs_session, '')
      const [[remaining]] = await c.query("SELECT COUNT(*) AS n FROM `user` WHERE UserType='Admin' AND Status='Active' AND DeletedAt IS NULL")
      assert.equal(remaining.n, 1); assert.equal((await account('admin@example.invalid')).UserID, 1)
    })
    await t.test('deleted Google identity may register anew without inheriting its history or permissions', async () => {
      const previous = await account('google@example.invalid')
      await remove(admin(previous.UserID))
      const e = event(), result = await google(e, { googleId: 'synthetic-google-id', email: 'google@example.invalid', emailVerified: true, firstName: 'Synthetic', lastName: 'Google' })
      assert.notEqual(result.user.id, previous.UserID); assert.equal(result.user.userType, 'Viewer')
      const [oldHistory] = await c.execute('SELECT * FROM user_history WHERE UserID=?', [previous.UserID]); assert.equal(oldHistory.length, 1); assert.ok(oldHistory[0].LogoutDateTime)
    })
    await t.test('database failure during deletion rolls back the identity update as well as history changes', async () => {
      const user = await account('unused@example.invalid')
      const failing = { ...connection, execute: async (sql, args) => { if (sql.startsWith('UPDATE user_history')) throw Error('Synthetic interrupted deletion'); return c.execute(sql, args) } }
      const failRoute = load('server/api/settings/users/[id].delete.ts', { ...deps, database: { ...db, getConnection: async () => failing } }, new Map()).default
      await assert.rejects(() => failRoute(admin(user.UserID)), /Synthetic interrupted deletion/)
      const unchanged = await account(user.Email)
      assert.equal(unchanged.UserID, user.UserID); assert.equal(unchanged.DeletedAt, null); assert.equal(unchanged.Password, user.Password)
    })
    await t.test('invalid department and malformed resend input cannot create accounts or send mail', async () => {
      await assert.rejects(() => register(event({ ...body, email: 'bad-department@example.invalid', departmentId: 2 })), denied(400))
      assert.equal(await account('bad-department@example.invalid'), undefined)
      const count = state.sent.length
      await assert.rejects(() => resend(event({ email: { value: syntheticEmail } })), denied(400)); assert.equal(state.sent.length, count)
    })
  } finally { await c.end() }
})
