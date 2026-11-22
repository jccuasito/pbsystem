// Local-only, synthetic schema clone. Never connects the app to the source database.
// node --env-file=.env scripts/test-system-scale.mjs setup
// node --env-file=.env scripts/test-system-scale.mjs <phase> --database=pbsystem_scale_...
import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import mysql from 'mysql2/promise'
import jwt from 'jsonwebtoken'
import * as XLSX from 'xlsx'
import { root, localConfig, identifier, createFixture, insert, sites, periods, expectedPay, dayRecord, rates } from './helpers/scale-fixture.mjs'

const phase = process.argv[2] || 'setup'
if (phase === 'setup') { await createFixture(); process.exit(0) }
const database = process.argv.find(arg => arg.startsWith('--database='))?.slice(11)
if (!/^pbsystem_scale_\d{14}_[a-f0-9]{4}$/.test(database || '') || database === process.env.DB_NAME) throw Error('Provide the exact generated synthetic database name')
const folder = path.join(root, database), manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'))
assert.equal(manifest.database, database); assert.equal(manifest.syntheticOnly, true)
const admin = await mysql.createConnection({ ...localConfig(), database })
const [[marker]] = await admin.execute('SELECT Marker FROM scale_test_manifest')
assert.equal(marker.Marker, 'SYNTHETIC_ONLY_6000_500_150_V1')
const user = 'scale_' + randomBytes(7).toString('hex'), password = randomBytes(32).toString('hex'), secret = randomBytes(48).toString('hex')
const base = 'http://127.0.0.1:3196', measurements = [], checks = [], started = new Date().toISOString()
const token = role => 'pbs_session=' + jwt.sign({ sub: role === 'Admin' ? 1 : 2, email: role.toLowerCase() + '@scale.example.invalid', userType: role }, secret, { expiresIn: '3h', issuer: 'pbsystem', audience: 'pbsystem-web' })
let child, healthBefore, healthAfter, failure, accountCreated = false
const log = []
async function request(route, body, options = {}) {
  const start = performance.now()
  const response = await fetch(base + route, { method: options.method || (body === undefined ? 'GET' : 'POST'), headers: { cookie: options.cookie ?? token(options.role || 'Admin'), origin: base, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180000) })
  const raw = await response.text()
  let result; try { result = JSON.parse(raw) } catch { result = { raw: raw.slice(0, 300) } }
  measurements.push({ route, method: body === undefined ? 'GET' : 'POST', status: response.status, ms: Math.round((performance.now() - start) * 10) / 10, bytes: Buffer.byteLength(raw) })
  if (!(Array.isArray(options.status) ? options.status : [options.status || 200]).includes(response.status)) throw Error(`${response.status} ${route}: ${JSON.stringify(result).slice(0, 700)}`)
  if (options.returnStatus) return { status: response.status, result }
  return result
}
async function parallel(items, concurrency, work) {
  let index = 0, done = 0, failed
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!failed && index < items.length) {
      const item = items[index++]
      try { await work(item); if (++done % 50 === 0) console.log(`${phase}: ${done}/${items.length}`) }
      catch (error) { failed ||= error }
    }
  }))
  if (failed) throw failed
}
const note = (label, details = true) => { checks.push({ label, details }); console.log('PASS ' + label) }
async function verifyPayroll(periodIndex) {
  const period = periods[periodIndex]
  const [payroll] = await admin.execute("SELECT EmployeeID,GrossPay,Allowance,TotalDeduction,NetPay FROM payroll WHERE StartDate=? AND EndDate=? AND Status='Approved' ORDER BY EmployeeID", [period.start, period.end])
  assert.equal(payroll.length, 6000)
  for (const row of payroll) {
    const expected = expectedPay(row.EmployeeID, periodIndex)
    for (const [column, key] of [['GrossPay', 'gross'], ['Allowance', 'allowance'], ['TotalDeduction', 'deductions'], ['NetPay', 'net']]) assert.equal(Math.round(Number(row[column]) * 100), expected[key], `Employee ${row.EmployeeID} ${column} cutoff ${periodIndex + 1}`)
  }
  const [loans] = await admin.execute('SELECT EmployeeID,RemainingBalance FROM employee_loan')
  for (const loan of loans) assert.equal(Number(loan.RemainingBalance), 6000 - (loan.EmployeeID % 30 === 0 ? 0 : 500 * (periodIndex + 1)))
  const [deductions] = await admin.execute('SELECT RemainingBalance FROM employee_deduction')
  for (const deduction of deductions) assert.equal(Number(deduction.RemainingBalance), 1000 - 125 * (periodIndex + 1))
  note(`All 6,000 payrolls and 3,500 account balances match independent cent calculations: cutoff ${periodIndex + 1}`)
}
try {
  await admin.query('CREATE USER ?@? IDENTIFIED BY ?', [user, 'localhost', password]); accountCreated = true
  await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${identifier(database)}.* TO ?@?`, [user, 'localhost'])
  const restricted = await mysql.createConnection({ ...localConfig(), database, user, password })
  try {
    await assert.rejects(restricted.query('SELECT * FROM ' + identifier(manifest.sourceSchema) + '.employee LIMIT 0'), /denied/i)
    note('Test application account cannot access the original database')
  } finally { await restricted.end() }
  child = spawn(process.execPath, ['.output/server/index.mjs'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    DB_NAME: database, DB_USER: user, DB_PASSWORD: password, JWT_SECRET: secret,
    APP_URL: base, HOST: '127.0.0.1', PORT: '3196', NITRO_HOST: '127.0.0.1', NITRO_PORT: '3196',
    DB_AUTO_BACKUP: 'false', LEGAL_HOLIDAY_AUTO_SEED: 'false', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', GOOGLE_CLIENT_ID: '',
    DB_BACKUP_DIR: path.join(folder, 'backups'), PROFILE_IMAGE_STORAGE_DIR: path.join(folder, 'images'),
    GOVERNMENT_ID_STORAGE_DIR: path.join(folder, 'ids'), PAYSLIP_ARCHIVE_STORAGE_DIR: path.join(folder, 'payslips') } })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log.push(chunk.toString()); if (log.length > 100) log.shift() })
  child.on('error', error => { failure = error.message })
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null || failure) throw Error('Test server failed to start: ' + log.join('').slice(-2000))
    try { if ((await fetch(base + '/health/ready')).ok) break } catch { /* wait for local listener */ }
    await new Promise(resolve => setTimeout(resolve, 200))
    if (i === 99) throw Error('Test server readiness timeout')
  }
  // Reject an unrelated listener before any workload, using the unique fixture identity.
  const identity = await request('/api/auth/me')
  assert.ok(JSON.stringify(identity).includes('admin@scale.example.invalid'))
  healthBefore = await request('/api/settings/health')
  if (phase === 'baseline') {
    await parallel(sites, 2, s => request(`/api/attendance/dtr/${s.id}/compute`, { target: 'payroll' }))
    await request('/api/payroll/processing?periodStart=2026-09-01&periodEnd=2026-09-15')
    await request('/api/payroll/processing/1', { action: 'finalize' })
    note('Baseline: first cutoff computed, full preview and one site finalized')
  } else if (phase === 'payroll') {
    for (let index = 0; index < 2; index++) {
      const [batches] = await admin.execute('SELECT BatchID,Status FROM attendance_dtr WHERE PeriodStart=? ORDER BY BatchID', [periods[index].start])
      await parallel(batches.filter(b => b.Status === 'Draft'), 2, b => request(`/api/attendance/dtr/${b.BatchID}/compute`, { target: 'payroll' }))
      const [pending] = await admin.execute("SELECT d.BatchID FROM attendance_dtr d LEFT JOIN payroll_processing_review r ON r.BatchID=d.BatchID WHERE d.PeriodStart=? AND COALESCE(r.ReviewStatus,'Pending')<>'Approved' ORDER BY d.BatchID", [periods[index].start])
      await parallel(pending, 2, b => request(`/api/payroll/processing/${b.BatchID}`, { action: 'finalize' }))
      await verifyPayroll(index)
      await request('/api/payroll/processing/1', { action: 'finalize' }, { status: 409 })
      if (index === 0) {
        await request('/api/payroll/processing/1', { action: 'cancel', reason: 'Synthetic balance restoration test' })
        const [[loan]] = await admin.execute('SELECT RemainingBalance FROM employee_loan WHERE EmployeeID=3')
        assert.equal(Number(loan.RemainingBalance), 6000)
        await request('/api/attendance/dtr/1/compute', { target: 'payroll' })
        const duplicate = await Promise.all(Array.from({ length: 2 }, () => request('/api/payroll/processing/1', { action: 'finalize' }, { status: [200, 409], returnStatus: true })))
        assert.deepEqual(duplicate.map(r => r.status).sort(), [200, 409])
        await verifyPayroll(0); note('Cancel restores balances; concurrent duplicate finalization cannot double charge')
      }
    }
  } else if (phase === 'scope') {
    const query = 'periodStart=2026-09-01&periodEnd=2026-09-15'
    const full = await request('/api/payroll/processing?' + query)
    for (const page of [1, 20]) {
      const result = await request(`/api/payroll/processing?${query}&page=${page}&pageSize=25`)
      assert.equal(result.pagination.total, 500); assert.equal(result.items.length, 25)
      for (const site of result.items) assert.deepEqual(site, full.sites.find(s => s.BatchID === site.BatchID))
    }
    const search = await request(`/api/payroll/processing?${query}&page=1&search=WORKER%20000001`)
    assert.equal(search.pagination.total, 1); assert.equal(search.items[0].BatchID, 1)
    const literal = await request(`/api/payroll/processing?${query}&page=1&search=%25`)
    assert.equal(literal.pagination.total, 0)
    await request(`/api/payroll/processing?${query}&page=1&pageSize=101`, undefined, { status: 400 })
    note('First/last payroll pages equal full calculation; unloaded employee search, literal wildcard and page bounds pass')
    const a = await request('/api/attendance/dtr', { AgencyID: 1, ClientID: 1, SiteID: 1, PeriodStart: '2030-10-01', PeriodEnd: '2030-10-15' })
    const b = await request('/api/attendance/dtr', { AgencyID: 1, ClientID: 1, SiteID: 2, PeriodStart: '2030-10-01', PeriodEnd: '2030-10-15' })
    await admin.beginTransaction()
    try {
      await admin.execute("UPDATE employee_deployment SET EndDate='2030-10-01' WHERE DeploymentID=12")
      const [deployment] = await admin.execute("INSERT INTO employee_deployment(EmployeeID,SiteRateID,SiteID,StartDate,CreatedBy) VALUES(12,6,2,'2030-10-02',1)")
      await insert(admin, 'attendance_dtr_employee', [{ BatchID: b.id, EmployeeID: 12, DeploymentID: deployment.insertId, IsPermanentSite: 1, CreatedBy: 1 }])
      const rows = []
      for (let id = 1; id <= 24; id++) rows.push({ BatchID: id <= 12 ? a.id : b.id, EmployeeID: id, DeploymentID: id, AttendanceDate: '2030-10-01', ShiftCodeID: 1, RegularHours: 8, CreatedBy: 1 })
      for (const day of ['02', '03']) rows.push({ BatchID: b.id, EmployeeID: 12, DeploymentID: deployment.insertId, AttendanceDate: '2030-10-' + day, ShiftCodeID: 1, RegularHours: 8, CreatedBy: 1 })
      await insert(admin, 'attendance', rows); await admin.commit()
    } catch (error) { await admin.rollback(); throw error }
    await request(`/api/attendance/dtr/${a.id}/compute`, { target: 'payroll' })
    await request(`/api/attendance/dtr/${b.id}/compute`, { target: 'payroll' })
    const future = 'periodStart=2030-10-01&periodEnd=2030-10-15'
    const combined = await request('/api/payroll/processing?' + future)
    const people = []
    for (const page of [1, 2]) {
      const part = await request(`/api/payroll/processing?${future}&page=${page}&pageSize=1`)
      assert.equal(part.items.length, 1)
      assert.deepEqual(part.items[0], combined.sites.find(s => s.BatchID === part.items[0].BatchID))
      people.push(...part.items[0].employees.filter(e => e.EmployeeID === 12))
    }
    assert.equal(people.length, 2)
    assert.equal(people.reduce((sum, p) => sum + p.allowance, 0), 100)
    assert.equal(people.reduce((sum, p) => sum + p.accountDeductions, 0), 700)
    note('Same employee transfers between sites: pagination preserves exactly one allowance and one set of installments/contributions')
  } else if (phase === 'imports') {
    const [[existingImport]] = await admin.execute("SELECT BatchID AS id FROM attendance_dtr WHERE SiteID=1 AND PeriodStart='2026-10-01' AND PeriodEnd='2026-10-15'")
    const batch = existingImport || await request('/api/attendance/dtr', { AgencyID: 1, ClientID: 1, SiteID: 1, PeriodStart: '2026-10-01', PeriodEnd: '2026-10-15' })
    const rows = [
      { EmployeeID: 1, AttendanceDate: '2026-10-10', ShiftCode: 'SCALE0800-1600', TimeIn: '08:00', TimeOut: '16:00' },
      { EmployeeID: 2, AttendanceDate: '2026-10-10', ShiftCode: 'SCALE0800-1600', TimeIn: '08:16', TimeOut: '16:00' },
      { EmployeeID: 3, AttendanceDate: '2026-10-10', ShiftCode: 'SCALE0800-1600', TimeIn: '08:00', TimeOut: '' },
      { EmployeeID: 4, AttendanceDate: '2026-10-10', ShiftCode: 'MISSING-SCALE', TimeIn: '08:00', TimeOut: '16:00' },
      { EmployeeID: 5, AttendanceDate: '2026-10-10', ShiftCode: 'SCALE0800-1600', TimeIn: '', TimeOut: '' },
      { EmployeeID: 6, AttendanceDate: '2026-10-10', ShiftCode: 'SCALE0800-1600', TimeIn: '08:00', TimeOut: '15:00' },
      { EmployeeID: 999999, AttendanceDate: '2026-10-10', ShiftCode: 'SCALE0800-1600', TimeIn: '08:00', TimeOut: '16:00' },
    ]
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'DTR')
    const filename = path.join(folder, 'synthetic-biometric-review.xlsx'); await writeFile(filename, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
    const parsed = XLSX.utils.sheet_to_json(XLSX.read(await readFile(filename), { type: 'buffer' }).Sheets.DTR, { defval: '' }).map((row, index) => ({ ...row, RowNumber: index + 2 }))
    const result = await request(`/api/attendance/dtr/${batch.id}/records`, { ImportRows: true, Rows: parsed })
    await writeFile(path.join(folder, 'biometric-review.json'), JSON.stringify(result, null, 2))
    assert.equal(result.reviewRows.length, 7)
    assert.ok(result.reviewRows.some(r => r.employeeId === 2 && r.lateMinutes === 16))
    assert.ok(result.reviewRows.some(r => r.employeeId === 6 && r.undertimeMinutes === 60))
    assert.ok(result.reviewRows.some(r => r.employeeId === 3 && r.flags.includes('missing-out')))
    assert.ok(result.reviewRows.some(r => r.employeeId === 5 && r.flags.includes('no-punches')))
    assert.ok(result.issues.some(r => r.reason.includes('MISSING-SCALE')))
    await request(`/api/attendance/dtr/${batch.id}/records`, { ImportRows: true, Rows: Array.from({ length: 1001 }, () => rows[0]) }, { status: 400 })
    await request(`/api/attendance/dtr/${batch.id}/compute`, { target: 'payroll' }, { status: 409 })
    note('Excel roundtrip: late, undertime, missing punches, missing shift and unmatched employee reported; oversized import and incomplete compute rejected')
  } else if (phase === 'workflows') {
    const groups = [...new Map(sites.map(s => [`${s.agency}:${s.client}`, { agency: s.agency, client: s.client, sites: sites.filter(t => t.agency === s.agency && t.client === s.client) }])).values()]
    const componentFields = [['RegularHours', 'RegularRate'], ['OTHours', 'OTRate'], ['OTExtHours', 'OTExtRate'], ['NightDiffHours', 'NightDiffRate'], ['RestDayHours', 'RestDayRate'], ['RestDayOTHours', 'RestDayOTRate'], ['LegalHolidayHours', 'LegalHolidayRate'], ['LegalHolidayOTHours', 'LegalHolidayOTRate'], ['RestDayLegalHolidayHours', 'LegalHolidayRate'], ['RestDayLegalHolidayOTHours', 'LegalHolidayOTRate'], ['SpecialHolidayHours', 'SpecialHolidayRate'], ['SpecialHolidayOTHours', 'SpecialHolidayOTRate'], ['RestDaySpecialHolidayHours', 'SpecialHolidayRate'], ['RestDaySpecialHolidayOTHours', 'SpecialHolidayOTRate'], ['LateHours', 'LateDeduction'], ['UndertimeHours', 'UndertimeDeduction'], ['BreakHours', 'BreakDeduction']]
    const settings = { adminPercent: 0, adminBase: 'service', vatPercent: 0, vatBase: 'administrative', withholdingPercent: 0, withholdingBase: 'administrative', retirementQuantity: 0, retirementRate: 0, uniformQuantity: 0, uniformRate: 0 }
    await parallel(groups, 2, async group => {
      const [[existing]] = await admin.execute('SELECT Revision FROM billing_client_profile WHERE AgencyID=? AND ClientID=?', [group.agency, group.client])
      if (!existing) await request('/api/billing/profiles', { agencyId: group.agency, clientId: group.client, revision: 0, config: { mode: 'client', layout: 'site', title: 'Synthetic capacity test invoice', notes: 'TEST ONLY', hoursPerDay: 8, settings, rules: componentFields.map(([code]) => ({ code, enabled: true, label: code, unit: 'hour', divisor: 1, rateMode: 'linked', rate: 0 })) } })
      const batchIds = group.sites.flatMap(s => [s.id, s.id + 500]).sort((a, b) => a - b)
      let expected = 0
      for (const s of group.sites) for (let period = 0; period < 2; period++) for (let employee = (s.id - 1) * 12 + 1; employee <= s.id * 12; employee++) {
        const prices = rates((employee - 1) % 3 + 1, s.region, true, true)
        for (let day = 1; day <= 15; day++) {
          const record = dayRecord(employee, day, period)
          for (const [field, price] of componentFields) expected += Math.round(Number(record[field] || 0) * prices[price] * 100) * (['LateHours', 'UndertimeHours', 'BreakHours'].includes(field) ? -1 : 1)
        }
      }
      const [[saved]] = await admin.execute('SELECT b.BillingID,b.Status,b.TotalAmount FROM billing_draft_source ds JOIN billing b ON b.BillingID=ds.BillingID WHERE ds.BatchID=?', [batchIds[0]])
      if (saved?.Status === 'Finalized') { assert.equal(Math.round(Number(saved.TotalAmount) * 100), expected, 'Saved invoice matches independent total'); return }
      const draft = saved ? await request(`/api/billing/drafts/${saved.BillingID}`) : null
      const { source } = draft || await request('/api/billing/drafts/preview?batchIds=' + batchIds.join(','))
      const invoice = await request('/api/billing/drafts', { batchIds, billingId: saved?.BillingID, revision: draft?.draft.revision || 0, sourceHash: source.sourceHash, billingDate: '2026-10-01', lines: source.lines, settings: source.settings, notes: 'SYNTHETIC ONLY' })
      assert.equal(Math.round(invoice.totalDue * 100), expected, 'Independent billing total')
      await request(`/api/billing/drafts/${invoice.billingId}/status`, { action: 'finalize', revision: invoice.revision, sourceHash: source.sourceHash })
    })
    note('All 500 sites billed through actual preview/save/finalize; 250 agency/client invoice totals verified independently')
    await parallel(groups, 2, async group => {
      for (let period = 0; period < 2; period++) {
        const scope = { siteAccountId: group.client, agencyId: group.agency, periodStart: periods[period].start, periodEnd: periods[period].end }
        const roster = await request('/api/payroll/payslips/sites?' + new URLSearchParams(scope))
        const employeeIds = group.sites.flatMap(s => Array.from({ length: 12 }, (_, i) => (s.id - 1) * 12 + i + 1))
        assert.equal(roster.items.length, employeeIds.length)
        await request('/api/payroll/payslips/sites', { ...scope, action: 'post', reviewToken: roster.reviewToken, employeeIds })
      }
    })
    const [[publications]] = await admin.execute("SELECT COUNT(*) AS total FROM payslip_publication WHERE Status='Posted'")
    assert.equal(Number(publications.total), 12000)
    note('All 12,000 employee cutoff payslips posted')
    const portalToken = randomBytes(32).toString('hex')
    await admin.execute(`INSERT INTO employee_portal_account(EmployeeID,Email,ContactNumber,PasswordHash,AgreementVersion)
      VALUES(1,'employee@scale.example.invalid','00000000001','disabled-synthetic-login','scale-test')
      ON DUPLICATE KEY UPDATE Status='Active'`)
    const [[account]] = await admin.execute('SELECT AccountID FROM employee_portal_account WHERE EmployeeID=1')
    await admin.execute('INSERT INTO employee_portal_session(TokenHash,AccountID,ExpiresAt) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [createHash('sha256').update(portalToken).digest('hex'), account.AccountID])
    const own = await request('/api/employee-portal/payslips', undefined, { cookie: 'pbs_employee_session=' + portalToken })
    assert.ok(!JSON.stringify(own).includes('WORKER 000002'), 'Portal cannot expose another employee')
    assert.ok(JSON.stringify(own).includes('WORKER 000001'), 'Portal contains its owner')
    note('Employee portal reads only its own posted payslips')
    const [[ledger]] = await admin.execute(`SELECT COUNT(*) AS total FROM payroll py
      LEFT JOIN (SELECT PayrollID,SUM(Amount) AS amount FROM payroll_detail GROUP BY PayrollID) detail ON detail.PayrollID=py.PayrollID
      LEFT JOIN (SELECT PayrollID,SUM(Amount) AS amount FROM payroll_deduction GROUP BY PayrollID) deduction ON deduction.PayrollID=py.PayrollID
      WHERE py.Status='Approved' AND ROUND(py.NetPay,2)<>ROUND(COALESCE(detail.amount,0)-COALESCE(deduction.amount,0),2)`)
    assert.equal(Number(ledger.total), 0)
    const [[receipts]] = await admin.execute("SELECT COUNT(*) AS total FROM employee_account_transaction WHERE Status='Posted'")
    assert.equal(Number(receipts.total), 6600)
    note('Every approved payroll reconciles to detail lines; exactly 6,600 active account receipts, no duplicate charges')
    await request('/api/payroll/processing/1', { action: 'finalize' }, { role: 'Viewer', status: 403 })
    await request('/api/payroll/payslips/sites?batchId=1', { action: 'post' }, { role: 'Viewer', status: 403 })
    await request('/api/employees', undefined, { cookie: '', status: 401 })
    note('Anonymous reads and viewer financial writes rejected')
  } else if (phase === 'annual') {
    const annual = await request('/api/payroll/thirteenth-month?year=2026')
    assert.equal(annual.items.length, 6000)
    for (const employee of annual.items) {
      const employeeId = Number(employee.EmployeeID), site = sites[Math.floor((employeeId - 1) / 12)]
      let basic = 0
      for (let period = 0; period < 2; period++) for (let day = 1; day <= 15; day++) {
        const record = dayRecord(employeeId, day, period), price = rates((employeeId - 1) % 3 + 1, site.region, day + period * 15 >= 8).RegularRate
        basic += Math.round(record.RegularHours * price * 100) - Math.round(record.LateHours * price * 100) - Math.round(record.UndertimeHours * price * 100)
      }
      assert.equal(Math.round(employee.summary.basicEarned * 100), basic)
      assert.equal(Math.round(employee.summary.entitlement * 100), Math.round(basic / 12))
    }
    note('All 6,000 annual basic earnings and configured 13th-month previews match independent cents; no annual payment released')
  } else if (phase === 'directory') {
    const employeePage = await request('/api/employees?page=1&pageSize=25&includeLookups=0')
    assert.equal(employeePage.items.length, 25); assert.equal(employeePage.pagination.total, 6000)
    assert.equal(employeePage.employees, undefined); assert.equal(employeePage.agencies, undefined)
    const lastEmployee = await request('/api/employees?page=240&pageSize=25&includeLookups=0')
    assert.equal(lastEmployee.items.length, 25); assert.equal(lastEmployee.items.at(-1).EmployeeID, 6000)
    const employeeSearch = await request('/api/employees?page=1&search=EMP-6000&includeLookups=0')
    assert.equal(employeeSearch.items.length, 1); assert.equal(employeeSearch.items[0].EmployeeID, 6000)
    const employeeAgency = await request('/api/employees?page=1&agencyId=10&positionId=2&includeLookups=0')
    assert.equal(employeeAgency.pagination.total, 200)
    const [adminPreview, viewerPreview] = await Promise.all([
      request('/api/payroll/processing?page=1&pageSize=1'),
      request('/api/payroll/processing?page=1&pageSize=1', undefined, { role: 'Viewer' }),
    ])
    assert.equal(adminPreview.permissions.canReview, true); assert.equal(viewerPreview.permissions.canReview, false)
    note('Employee pages, unloaded ID search, agency/position filters and per-caller permissions pass')
    const period = 'periodStart=2026-09-01&periodEnd=2026-09-15'
    const roster = await request('/api/payroll/payslips/sites?batchId=1')
    await request('/api/payroll/payslips/sites', { batchId: 1, employeeIds: [1], action: 'withdraw', reviewToken: roster.reviewToken })
    try {
      const site = await request('/api/payroll/payslips/sites?' + period + '&search=SCALE%20TEST%20Site%20000001')
      assert.equal(site.pagination.total, 1); assert.equal(Number(site.items[0].PostedPayrollCount), 11)
      assert.equal(site.items[0].PublicationStatus, 'Partially posted')
      const accounts = await request('/api/payroll/payslips/sites?' + period + '&groupBy=account&postingStatus=partial')
      assert.equal(accounts.pagination.total, 1); assert.equal(Number(accounts.items[0].PostedPayrollCount), 23)
      const fresh = await request('/api/payroll/payslips/sites?batchId=1')
      await request('/api/payroll/payslips/sites', { batchId: 1, employeeIds: [1], action: 'post', reviewToken: '0'.repeat(64) }, { status: 409 })
      await request('/api/payroll/payslips/sites', { batchId: 1, employeeIds: [1], action: 'post', reviewToken: fresh.reviewToken })
      const [legacy] = await admin.execute(`INSERT INTO payroll(EmployeeID,DeploymentID,StartDate,EndDate,PayrollDate,GrossPay,NetPay,Status)
        VALUES(1,1,'2026-09-01','2026-09-15','2026-09-15',10,10,'Approved')`)
      try {
        const changed = await request('/api/payroll/payslips/sites?' + period + '&search=SCALE%20TEST%20Site%20000001')
        assert.equal(Number(changed.items[0].PostedPayrollCount), 11, 'An additional legacy source invalidates the old publication set')
      } finally { await admin.execute("UPDATE payroll SET Status='Cancelled' WHERE PayrollID=?", [legacy.insertId]) }
      const restored = await request('/api/payroll/payslips/sites?' + period + '&search=SCALE%20TEST%20Site%20000001')
      assert.equal(Number(restored.items[0].PostedPayrollCount), 12)
      note('Fast site/account directories preserve partial posting, stale-token rejection and exact source-set validation including legacy payroll')
    } finally {
      const fresh = await request('/api/payroll/payslips/sites?batchId=1')
      await request('/api/payroll/payslips/sites', { batchId: 1, employeeIds: [1], action: 'post', reviewToken: fresh.reviewToken })
    }
  } else if (phase === 'load') {
    const routes = ['/api/employees?page=1&pageSize=25&includeLookups=0', '/api/organization/site?page=1&pageSize=25&includeLookups=0', '/api/organization/client?page=1&pageSize=25&includeLookups=0', '/api/rates/site-rate?page=1&pageSize=25&includeLookups=0', '/api/rates/payroll-rate?view=groups&page=1&pageSize=25&includeLookups=0', '/api/attendance/dtr?page=1&pageSize=25&includeLookups=0', '/api/deductions-loans/employee-records?page=1&pageSize=25', '/api/payroll/processing?page=1&pageSize=25&includeLookups=0&periodStart=2026-09-16&periodEnd=2026-09-30', '/api/billing/drafts', '/api/payroll/payslips/sites']
    for (const users of [1, 5, 10, 25, 50]) {
      const start = measurements.length
      await parallel(Array.from({ length: users * 2 }, (_, i) => i), users, async i => { for (const route of routes) await request(route) })
      const rows = measurements.slice(start), sorted = rows.map(row => row.ms).sort((a, b) => a - b)
      const health = await request('/api/settings/health')
      note(`Concurrent readers ${users}`, { requests: rows.length, p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1), health })
    }
  } else if (phase === 'mixed') {
    const [invoices] = await admin.execute('SELECT BillingID,Revision,SourceHash FROM billing_draft ORDER BY BillingID LIMIT 2')
    const [[before]] = await admin.execute('SELECT SUM(RemainingBalance) AS balance FROM employee_loan')
    const routes = ['/api/employees?page=1&pageSize=25&includeLookups=0', '/api/organization/site?page=1&pageSize=25&includeLookups=0', '/api/attendance/dtr?page=1&pageSize=25&includeLookups=0', '/api/deductions-loans/employee-records?page=1&pageSize=25', '/api/payroll/processing?page=1&pageSize=25&includeLookups=0&periodStart=2026-09-16&periodEnd=2026-09-30', '/api/payroll/payslips/sites?groupBy=account']
    const outcomes = await Promise.allSettled([
      parallel(invoices, 2, async invoice => {
        let revision = Number(invoice.Revision)
        for (let i = 0; i < 10; i++) {
          const open = await request(`/api/billing/drafts/${invoice.BillingID}/status`, { action: 'reopen', revision, reason: 'Synthetic concurrent workflow test' })
          const close = await request(`/api/billing/drafts/${invoice.BillingID}/status`, { action: 'finalize', revision: open.revision, sourceHash: invoice.SourceHash })
          revision = close.revision
        }
      }),
      parallel(Array.from({ length: 60 }, (_, i) => i), 20, async () => { for (const route of routes) await request(route) }),
    ])
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason
    const [[after]] = await admin.execute('SELECT SUM(RemainingBalance) AS balance FROM employee_loan')
    assert.equal(after.balance, before.balance)
    const [[drafts]] = await admin.execute("SELECT COUNT(*) AS total FROM billing WHERE Status<>'Finalized'")
    assert.equal(Number(drafts.total), 0)
    note('20 simultaneous readers plus two billing writers: all invoices returned to Finalized; loan balances unchanged')
  } else if (phase === 'soak') {
    const routes = ['/api/employees?page=1&pageSize=25&includeLookups=0', '/api/organization/site?page=1&pageSize=25&includeLookups=0', '/api/attendance/dtr?page=1&pageSize=25&includeLookups=0', '/api/deductions-loans/employee-records?page=1&pageSize=25', '/api/payroll/payslips/sites?groupBy=account']
    const finish = Date.now() + 60000
    let sample = Date.now() + 10000
    await parallel(Array.from({ length: 10 }, (_, i) => i), 10, async index => {
      while (Date.now() < finish) {
        await request(routes[index++ % routes.length])
        if (Date.now() >= sample) { sample = Date.now() + 10000; note('Soak sample', await request('/api/settings/health')) }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    })
    note('60-second sustained read run completed without request failures')
  } else if (phase === 'capacity') {
    // Hold only synthetic DTR parents to occupy both allowed heavy slots.
    await admin.beginTransaction()
    let pending = []
    try {
      await admin.execute('SELECT BatchID FROM attendance_dtr WHERE BatchID IN (1,2) ORDER BY BatchID FOR UPDATE')
      pending = [1, 2].map(id => request(`/api/payroll/processing/${id}`, { action: 'finalize' }, { status: 409 }))
      for (let i = 0; i < 50; i++) {
        const health = await request('/api/settings/health')
        if (health.requests.heavy === 2) break
        await new Promise(resolve => setTimeout(resolve, 20))
        if (i === 49) throw Error('Heavy slots were not occupied')
      }
      await request('/api/payroll/processing/3', { action: 'finalize' }, { status: 503 })
      await request('/api/organization/site?page=1&pageSize=25&includeLookups=0')
    } finally { await admin.rollback(); await Promise.all(pending) }
    await request('/api/payroll/processing/3', { action: 'finalize' }, { status: 409 })
    const health = await request('/api/settings/health')
    assert.equal(health.requests.heavy, 0)
    note('Heavy write limit returns 503 while reads work, then capacity recovers without duplicate payroll')
  } else throw Error('Unknown phase: ' + phase)
  healthAfter = await request('/api/settings/health')
} catch (error) { failure = error.stack; console.error(error.stack); process.exitCode = 1 }
finally {
  if (child && child.exitCode === null) { child.kill(); await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]) }
  if (accountCreated) await admin.query('DROP USER ?@?', [user, 'localhost'])
  await admin.end()
  const report = { phase, database, started, finished: new Date().toISOString(), failure, checks, measurements, healthBefore, healthAfter }
  await writeFile(path.join(folder, phase + '-' + Date.now() + '.json'), JSON.stringify(report, null, 2))
  if (failure) await writeFile(path.join(folder, 'last-server-error.log'), log.join(''))
  console.log(JSON.stringify({ phase, database, requests: measurements.length, failure: failure?.split('\n')[0], checks: checks.length }))
}
