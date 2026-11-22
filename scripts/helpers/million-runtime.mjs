import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import mysql from 'mysql2/promise'
import jwt from 'jsonwebtoken'
import { identifier, localConfig, root } from './scale-fixture.mjs'

export async function millionRuntime(phase, run) {
  // Windows native modules must not be loaded while the production build is
  // replacing .output. A queued suite can wait while a fixture is being copied.
  const buildLock=path.join(root,'million-build.lock')
  for(let i=0;;i++){
    try{await readFile(buildLock,'utf8')}catch(error){if(error.code==='ENOENT')break;throw error}
    if(i===240)throw Error('Production build lock remains; inspect the build result before starting this test')
    await new Promise(resolve=>setTimeout(resolve,500))
  }
  const database = process.argv.find(arg => arg.startsWith('--database='))?.slice(11)
  if (!/^pbsystem_scale_\d{14}_[a-f0-9]{4}$/.test(database || '') || database === process.env.DB_NAME) throw Error('Exact generated local synthetic database required')
  const folder = path.join(root, database), manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'))
  assert.equal(manifest.database, database); assert.equal(manifest.profile, 'million'); assert.equal(manifest.syntheticOnly, true)
  if (manifest.seedComplete === false && !['batch-preflight', 'preview-baseline', 'packet-guard', 'preview-bounded'].includes(phase)) throw Error('Wait for the million fixture to finish seeding')
  const db = await mysql.createConnection({ ...localConfig(), database })
  const [[marker]] = await db.execute('SELECT Marker FROM scale_test_manifest')
  assert.equal(marker.Marker, 'SYNTHETIC_ONLY_MILLION_4_500_150_V1')
  const user = 'scale_' + randomBytes(7).toString('hex'), password = randomBytes(32).toString('hex'), secret = randomBytes(48).toString('hex')
  const base = 'http://127.0.0.1:3197', rows = [], checks = [], logs = [], started = new Date().toISOString()
  const staff = id => 'pbs_session=' + jwt.sign({ sub: id, email: `staff${id}@million.example.invalid`, userType: id <= 100 ? 'Admin' : 'Viewer' }, secret, { expiresIn: '12h', issuer: 'pbsystem', audience: 'pbsystem-web' })
  const portal = id => 'pbs_employee_session=' + createHash('sha256').update(manifest.portalSeed + ':' + id).digest('hex')
  const reportPath = path.join(folder, `million-${phase}-${Date.now()}.json`)
  let child, accountCreated = false, error, healthBefore, healthAfter, timer, originalPacket, testPacket, packetLease, bufferLease
  const leaseFile = path.join(folder, 'packet-override.json')
  const bufferLeaseFile = path.join(folder, 'buffer-override.json')
  async function waitBuffer(bytes){
    for(let i=0;i<120;i++){
      const [[current]]=await db.query('SELECT @@global.innodb_buffer_pool_size AS bytes')
      if(Number(current.bytes)===bytes)return
      await new Promise(resolve=>setTimeout(resolve,500))
    }
    throw Error('Timed out waiting for asynchronous local InnoDB buffer resize')
  }
  const note = (label, details = true) => { checks.push({ label, details }); console.log(label + (details === true ? '' : ' ' + JSON.stringify(details))) }
  const save = running => writeFile(reportPath, JSON.stringify({ phase, database, started, finished: running ? undefined : new Date().toISOString(), running, error, checks, measurements: rows, healthBefore, healthAfter }, null, 2))
  async function request(route, body, options = {}) {
    const before = performance.now(); let status = 0, result, bytes = 0
    try {
      const response = await fetch(base + route, { method: options.method || (body === undefined ? 'GET' : 'POST'), headers: { cookie: options.cookie || staff(options.staff || 1), origin: base, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(options.timeout || 180000) })
      status = response.status
      if(options.discardResult){for await(const chunk of response.body)bytes+=chunk.length;result={}}
      else{const raw = await response.text(); bytes = Buffer.byteLength(raw)
        try { result = JSON.parse(raw) } catch { result = { message: raw.slice(0, 180) } }}
    } catch (failure) { result = { message: failure.name } }
    rows.push({ route: route.replace(/([?&]search=)[^&]*/g, '$1[test]'), method: options.method || (body === undefined ? 'GET' : 'POST'), status, ms: Math.round((performance.now() - before) * 10) / 10, bytes })
    if (!options.capture && !(options.status || [200]).includes(status)) throw Error(`${status} ${route}: ${JSON.stringify(result).slice(0, 280)}`)
    return options.capture ? { status, result } : result
  }
  async function parallel(items, concurrency, work) {
    let index = 0, failure
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!failure && index < items.length) {
        const item = items[index++]
        try { await work(item) } catch (error) { failure ||= error }
      }
    }))
    if (failure) throw failure
  }
  try {
    // Check port ownership before spawning; never attach to an unrelated app.
    try { await fetch(base + '/health/live', { signal: AbortSignal.timeout(500) }); throw Error('Test port 3197 is occupied') }
    catch (error) { if (error.message === 'Test port 3197 is occupied') throw error }
    if (process.argv.includes('--packet-mb=16')) {
      const [[config]] = await db.query('SELECT @@global.max_allowed_packet AS bytes')
      originalPacket = Number(config.bytes); testPacket = 16 * 2 ** 20
      packetLease={database,user,driverPid:process.pid,started,originalBytes:originalPacket,testBytes:testPacket,state:'active'}
      await writeFile(leaseFile,JSON.stringify(packetLease,null,2))
      await db.query('SET GLOBAL max_allowed_packet=16777216')
      note('Temporary local packet-limit override', { originalBytes: originalPacket, testBytes: testPacket })
    }
    if (process.argv.includes('--buffer-mb=256')) {
      const [[config]] = await db.query('SELECT @@global.innodb_buffer_pool_size AS bytes')
      bufferLease={database,driverPid:process.pid,started,originalBytes:Number(config.bytes),testBytes:256*2**20,state:'active'}
      await writeFile(bufferLeaseFile,JSON.stringify(bufferLease,null,2))
      await db.query('SET GLOBAL innodb_buffer_pool_size=268435456')
      await waitBuffer(bufferLease.testBytes)
      const [[actual]]=await db.query('SELECT @@global.innodb_buffer_pool_size AS bytes')
      assert.equal(Number(actual.bytes),bufferLease.testBytes)
      note('Temporary local database buffer override',bufferLease)
    }
    await db.query('CREATE USER ?@? IDENTIFIED BY ?', [user, 'localhost', password]); accountCreated = true
    await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${identifier(database)}.* TO ?@?`, [user, 'localhost'])
    const restricted = await mysql.createConnection({ ...localConfig(), database, user, password })
    try { await assert.rejects(restricted.query('SELECT * FROM ' + identifier(manifest.sourceSchema) + '.employee LIMIT 0'), /denied/i) }
    finally { await restricted.end() }
    child = spawn(process.execPath, ['--max-old-space-size=768', '.output/server/index.mjs'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
      DB_NAME: database, DB_USER: user, DB_PASSWORD: password, JWT_SECRET: secret,
      APP_URL: base, HOST: '127.0.0.1', PORT: '3197', NITRO_HOST: '127.0.0.1', NITRO_PORT: '3197',
      DB_AUTO_BACKUP: 'false', LEGAL_HOLIDAY_AUTO_SEED: 'false', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', GOOGLE_CLIENT_ID: '',
      DB_BACKUP_DIR: path.join(folder, 'backups'), PROFILE_IMAGE_STORAGE_DIR: path.join(folder, 'images'), GOVERNMENT_ID_STORAGE_DIR: path.join(folder, 'ids'), PAYSLIP_ARCHIVE_STORAGE_DIR: path.join(folder, 'payslips') } })
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs.push(chunk.toString()); if (logs.length > 300) logs.shift() })
    if(packetLease){packetLease.childPid=child.pid;await writeFile(leaseFile,JSON.stringify(packetLease,null,2))}
    child.on('error', failure => { error = failure.message })
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null || error) throw Error('Test server startup failed')
      try { if ((await fetch(base + '/health/ready')).ok) break } catch { /* wait for owned child */ }
      await new Promise(resolve => setTimeout(resolve, 200)); if (i === 99) throw Error('Readiness timeout')
    }
    const identity = await request('/api/auth/me'); assert.ok(JSON.stringify(identity).includes('staff1@million.example.invalid'))
    healthBefore = await request('/api/settings/health')
    await save(true)
    timer = setInterval(() => { void save(true).catch(() => {}) }, 10000)
    await run({ db, request, parallel, note, rows, manifest, staff, portal, folder, base })
    healthAfter = await request('/api/settings/health', undefined, { capture: true, timeout: 10000 })
    if (healthAfter.status !== 200 || rows.some(row => row.status === 0 || (row.status >= 500 && row.status !== 503))) throw Error('Observed an unexpected request failure or unhealthy isolated app; see captured measurements')
    note('Phase complete', { requests: rows.length, statuses: rows.reduce((s, r) => (s[r.status] = (s[r.status] || 0) + 1, s), {}) })
  } catch (failure) { error = failure.stack; console.error(error); process.exitCode = 1 }
  finally {
    clearInterval(timer)
    if (child && child.exitCode === null) { child.kill(); await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]) }
    // Kill only connections authenticated as this phase's random test account,
    // in this exact generated test database, after its owning process has exited.
    const [connections] = await db.execute('SELECT ID FROM information_schema.PROCESSLIST WHERE USER=? AND DB=?', [user, database])
    for (const connection of connections) if (Number.isSafeInteger(Number(connection.ID))) await db.query('KILL CONNECTION ' + Number(connection.ID)).catch(() => {})
    if (accountCreated) await db.query('DROP USER ?@?', [user, 'localhost'])
    if (originalPacket !== undefined) {
      const [[current]] = await db.query('SELECT @@global.max_allowed_packet AS bytes')
      if (Number(current.bytes) === testPacket) {
        await db.query('SET GLOBAL max_allowed_packet=' + originalPacket)
        packetLease.state='restored';packetLease.finished=new Date().toISOString();await writeFile(leaseFile,JSON.stringify(packetLease,null,2))
        note('Restored local packet limit', { bytes: originalPacket })
      } else {packetLease.state='external-setting-preserved';packetLease.finished=new Date().toISOString();await writeFile(leaseFile,JSON.stringify(packetLease,null,2));note('Packet limit changed externally; left that setting untouched')}
    }
    if(bufferLease){
      const [[current]]=await db.query('SELECT @@global.innodb_buffer_pool_size AS bytes')
      if(Number(current.bytes)===bufferLease.testBytes){
        await db.query('SET GLOBAL innodb_buffer_pool_size='+bufferLease.originalBytes)
        await waitBuffer(bufferLease.originalBytes)
        bufferLease.state='restored';note('Restored local database buffer',{bytes:bufferLease.originalBytes})
      }else{bufferLease.state='external-setting-preserved';note('Database buffer changed externally; left that setting untouched')}
      bufferLease.finished=new Date().toISOString();await writeFile(bufferLeaseFile,JSON.stringify(bufferLease,null,2))
    }
    await db.end(); await save(false)
    await writeFile(path.join(folder, `million-${phase}-server.log`), logs.join(''))
    console.log(JSON.stringify({ phase, database, reportPath, requests: rows.length, failed: !!error }))
  }
}
