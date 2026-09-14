const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const vue = require('vue')
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc')

function moduleFrom(filename, dependencies = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs' }).code,
    { module, Date, require: name => dependencies[name] || {}, ...globals })
  return module.exports
}
const shared = moduleFrom('shared/utils/dtrBtr.ts')
const sheetHelpers = moduleFrom('shared/utils/dtrBtrSheet.ts')
const h3 = { createError: value => Object.assign(new Error(value.statusMessage), value),
  getRouterParam: event => String(event.batchId), getQuery: event => event.query || {}, readBody: async event => event.body }
const server = moduleFrom('server/utils/dtrBtrCrud.ts', { h3, '../../shared/utils/dtrBtr': shared })
const batch = { BatchID: 5, AgencyID: 1, PeriodStart: '2026-08-16', PeriodEnd: '2026-08-31', Status: 'Draft' }
const entry = { BTRID: 1, AttendanceDate: '2026-08-16', ReplacedEmployeeID: 1, ReplacedEmployeeName: 'Name, Example Data',
  RelieverEmployeeID: 2, RelieverEmployeeName: 'Doe, John Example', Hours: 1, Revision: 1 }
const attendance = { EmployeeID: 1, AttendanceDate: '2026-08-16', AttendanceStatus: 'Present', RegularHours: 8, OTHours: 4 }
const fixture = { batch, employees: [{ EmployeeID: 1, EmployeeName: entry.ReplacedEmployeeName, EmployeeNumber: 'DJA-0001' }],
  relievers: [{ EmployeeID: 2, EmployeeName: entry.RelieverEmployeeName, EmployeeNumber: 'DJA-NOID001' }], attendance: [attendance], entries: [] }

test('BTR totals balance across days and employees without changing attendance allocations', () => {
  const before = JSON.stringify(attendance)
  const totals = shared.summarizeBtr([entry, { ...entry, BTRID: 2, AttendanceDate: '2026-08-17', Hours: 0.5 },
    { ...entry, BTRID: 3, ReplacedEmployeeID: 3, ReplacedEmployeeName: 'Another Employee', Hours: 1 }])
  assert.equal(totals.TotalHours, 2.5)
  assert.equal(totals.relievers[0].Hours, 2.5)
  assert.equal(totals.replaced.reduce((sum, row) => sum + row.Hours, 0), 2.5)
  assert.equal(totals.pairs.find(row => row.ReplacedEmployeeID === 1).Hours, 1.5)
  assert.equal(JSON.stringify(attendance), before)
  assert.equal(shared.summarizeBtr([{ ...entry, Hours: 0.1 }, { ...entry, Hours: 0.2 }]).TotalHours, 0.3)
})

test('BTR accepts either ID or Employee No, gives ID priority, and rejects ambiguous numbers', () => {
  const people = [...fixture.employees, ...fixture.relievers]
  for (const key of [1, '1', 'EMP-0001', ' emp-0001 ', 'dja-0001']) assert.equal(shared.resolveBtrEmployee(key, people).EmployeeID, 1)
  for (const key of ['EMP-0002', 'DJA-NOID001']) assert.equal(shared.resolveBtrEmployee(key, people).EmployeeID, 2)
  assert.equal(shared.resolveBtrEmployee('unknown', people), undefined)
  assert.equal(shared.resolveBtrEmployee('', people), undefined)
  assert.equal(shared.resolveBtrEmployee('Name, Example Data', people), undefined)
  assert.equal(shared.resolveBtrEmployee(true, people), undefined)
  const collision = [{ EmployeeID: 1, EmployeeNumber: '2' }, { EmployeeID: 2, EmployeeNumber: 'EMP-0001' }]
  assert.equal(shared.resolveBtrEmployee('2', collision).EmployeeID, 2)
  assert.equal(shared.resolveBtrEmployee('EMP-0001', collision).EmployeeID, 1)
  assert.equal(shared.resolveBtrEmployee('SAME', [{ EmployeeID: 1, EmployeeNumber: 'SAME' }, { EmployeeID: 2, EmployeeNumber: 'same' }]), undefined)
})

test('only cutoff and REST membership trigger review; attendance status/hours never gate BTR', () => {
  assert.equal(server.btrIssues([entry], fixture.employees, batch)[0].Issue, '')
  assert.match(server.btrIssues([entry], [], batch)[0].Issue, /no longer enrolled/)
  assert.match(server.btrIssues([entry], fixture.employees, { ...batch, PeriodStart: '2026-08-17' })[0].Issue, /outside/)
  assert.equal(server.btrIssues([{ ...entry, Hours: 9 }], fixture.employees, batch)[0].Issue, '')
})

test('REST attendance warning checks the exact employee/date and reports non-work status', () => {
  const days = [{ EmployeeID: 1, AttendanceDate: '2026-08-16', AttendanceStatus: 'Late', HasWork: true }]
  assert.equal(shared.btrAttendanceWarning(1, '2026-08-16', days), '')
  assert.match(shared.btrAttendanceWarning(1, '2026-08-17', days), /No worked attendance.*2026-08-17/)
  assert.match(shared.btrAttendanceWarning(2, '2026-08-16', days), /No worked attendance/)
  for (const status of ['Present', 'Absent', 'Rest Day', 'On-Leave', 'Reliever']) {
    assert.ok(shared.btrAttendanceWarning(1, '2026-08-16', [{ ...days[0], HasWork: false, AttendanceStatus: status }]).includes('status: '+status))
  }
})

test('sheet parser accepts the Excel template, Employee No headers, and supported dates', () => {
  const rows = [sheetHelpers.btrSheetHeaders,
    ['EMP-0002', 'Doe', '16-Aug-26', 1, 'DJA-0001', 'Name'],
    ['DJA-NOID001', 'Doe', '08/17/2026', 1, 'EMP-0001', 'Name'],
    ['EMP-0002', 'Doe', '2026-08-18', 1, 'DJA-0001', 'Name'], []]
  const parsed = sheetHelpers.parseBtrSheet(rows, () => '')
  assert.equal(parsed.length, 3)
  assert.equal(parsed[0].RelieverEmployeeID, 'EMP-0002'); assert.equal(parsed[0].ReplacedEmployeeID, 'DJA-0001')
  assert.deepEqual(Array.from(parsed, row => row.AttendanceDate), ['2026-08-16', '2026-08-17', '2026-08-18'])
  assert.equal(sheetHelpers.parseBtrSheet([['BTR EMPLOYEE NO', 'REST EMPLOYEE NO', 'DATE', 'HOURS'], ['DJA-NOID001','DJA-0001','2026-08-16',1]], ()=>'')[0].ReplacedEmployeeID, 'DJA-0001')
  assert.throws(() => sheetHelpers.parseBtrSheet([['Name'], ['Doe']], ()=>''), /Required columns/)
})

test('Excel import previews matching names, saves multiple rows, and exports round-trip dates without changing attendance', async () => {
  const filename = 'app/components/DtrBtrModal.vue', { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  const compiled = compileScript(descriptor, { id: 'btr-test' })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'btr-test', compilerOptions: { bindingMetadata: compiled.bindings } }).errors, [])
  assert.deepEqual(compileStyle({ source: descriptor.styles[0].content, filename, id: 'btr-test', scoped: true }).errors, [])
  const calls = [], workbooks = [], XLSX = require('xlsx'), scope = vue.effectScope(), module = { exports: {} }
  const context = { ...vue, Date, onMounted() {}, defineProps: () => ({ dtr: batch }), defineEmits: () => () => {}, module,
    require: name => name.endsWith('dtrBtrSheet') ? sheetHelpers : name.includes('dtrBtr') ? shared : {},
    xlsxForTest: { ...XLSX, writeFile: workbook => workbooks.push(workbook) },
    $fetch: async (url, options) => { calls.push({ url, options }); return options ? { success: true } : { ...fixture, attendance: [] } } }
  try {
    scope.run(() => vm.runInNewContext(transformSync(descriptor.scriptSetup.content.replaceAll("await import('xlsx')", 'xlsxForTest') +
      '\nmodule.exports={load,drafts,save,data,ready,totals,readFile,download,resolve,addRow,attendanceWarning,cutoffDays,gridCell,personTotal,dateTotal,gridTotal,openCell,cellReliever,cellHours,cellError,addCoverage,updateCoverage,removeCoverage,cellRows};', { loader: 'ts', format: 'cjs' }).code, context))
    const state = module.exports
    await state.load(); state.addRow()
    const sheet = XLSX.utils.aoa_to_sheet([sheetHelpers.btrSheetHeaders, ...[16,17,18].map(day => ['EMP-0002', 'Ignored stale Excel name', new Date('2026-08-'+day+'T00:00:00'), 1, 'DJA-0001', 'Ignored stale name'])])
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'BTR')
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    await state.readFile({ name: 'BTR.xlsx', arrayBuffer: async () => bytes })
    assert.equal(state.drafts.value.length, 3)
    assert.equal(state.resolve(state.drafts.value[0], 'rest').EmployeeName, entry.ReplacedEmployeeName)
    assert.equal(state.ready.value, true)
    const first = state.drafts.value[0]
    const warning = vue.computed(() => state.attendanceWarning(state.resolve(first, 'rest')?.EmployeeID, first.AttendanceDate))
    assert.match(warning.value, /No worked attendance/)
    state.data.value.attendance = [{ EmployeeID: 1, AttendanceDate: '2026-08-16', AttendanceStatus: 'Half-Day', HasWork: true }]
    assert.equal(warning.value, '')
    first.AttendanceDate = '2026-08-17'
    assert.match(warning.value, /2026-08-17/)
    first.AttendanceDate = '2026-08-16'
    first.ReplacedEmployeeID = 'EMP-0001'
    assert.equal(warning.value, '')
    first.ReplacedEmployeeID = 'DJA-0001'
    assert.match(state.attendanceWarning(1, state.drafts.value[1].AttendanceDate), /No worked attendance/)
    assert.equal(state.ready.value, true, 'Attendance warnings are advisory and do not block saving')
    await state.save()
    const writes = calls.filter(call => call.options)
    assert.equal(writes.length, 1); assert.equal(writes[0].url, '/api/attendance/dtr/5/btr')
    const rows = writes[0].options.body.Rows
    assert.equal(rows.length, 3); assert.equal(rows[0].Hours, '1')
    assert.equal(rows[0].ReplacedEmployeeID, 'DJA-0001'); assert.equal(rows[0].RelieverEmployeeID, 'EMP-0002')
    assert.deepEqual(Array.from(rows, row => row.AttendanceDate), ['2026-08-16','2026-08-17','2026-08-18'])
    assert.equal(rows[0].RegularHours, undefined)
    assert.equal(attendance.RegularHours, 8); assert.equal(attendance.OTHours, 4)
    state.data.value = { ...fixture, entries: [entry], batch: { ...batch, Status: 'Computed to Payroll' } }
    assert.equal(state.ready.value, false)
    await state.download(false)
    const reopened = XLSX.read(XLSX.write(workbooks[0], { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
    const reimported = sheetHelpers.parseBtrSheet(XLSX.utils.sheet_to_json(reopened.Sheets.BTR, { header:1, raw:true }), serial => {
      const date = XLSX.SSF.parse_date_code(serial); return date.y+'-'+String(date.m).padStart(2,'0')+'-'+String(date.d).padStart(2,'0')
    })
    assert.equal(reimported[0].AttendanceDate, '2026-08-16'); assert.equal(reimported[0].Hours, '1')
    assert.equal(reimported[0].RelieverEmployeeID, 'EMP-0002')
    await state.download(true); assert.deepEqual(XLSX.utils.sheet_to_json(workbooks[1].Sheets.BTR,{header:1})[0], Array.from(sheetHelpers.btrSheetHeaders))
    // Grid dates come from the cutoff; multiple relievers share a cell. Edits
    // replace the saved value in totals instead of counting it twice.
    const secondReliever = { EmployeeID: 4, EmployeeName: 'Another, Reliever', EmployeeNumber: null }
    state.data.value = { ...fixture, entries: [entry], relievers: [...fixture.relievers, secondReliever] }
    assert.equal(state.cutoffDays.value.length, 16)
    assert.equal(state.cutoffDays.value[0], '2026-08-16')
    assert.equal(state.cutoffDays.value[15], '2026-08-31')
    await state.openCell(fixture.employees[0], '2026-08-16')
    assert.equal(state.drafts.value.length, 0, 'Opening a cell must not stage an edit')
    state.cellReliever.value = 'EMP-0004'; state.cellHours.value = 1
    state.addCoverage()
    assert.equal(state.drafts.value[0].AttendanceDate, '2026-08-16')
    assert.equal(state.drafts.value[0].ReplacedEmployeeID, 'EMP-0001')
    assert.equal(state.gridCell(1, '2026-08-16').rows.length, 2)
    assert.equal(state.personTotal(1), 2); assert.equal(state.dateTotal('2026-08-16'), 2)
    state.addCoverage()
    assert.match(state.cellError.value, /already listed/)
    assert.equal(state.drafts.value.length, 1)
    const savedCellKey = state.cellRows.value.find(row => row.saved).key
    state.updateCoverage(state.cellRows.value.find(row => row.saved), '0.5')
    assert.equal(state.cellRows.value.find(row => row.saved).key, savedCellKey, 'Editing preserves input identity and focus')
    assert.equal(state.gridTotal.value, 1.5)
    assert.equal(entry.Hours, 1, 'Saved data is unchanged until Save BTR')
    const edit = state.drafts.value.find(row => row.BTRID)
    assert.equal(edit.Revision, 1); assert.equal(edit.BTRID, 1)
    await state.removeCoverage(state.cellRows.value.find(row => !row.saved))
    assert.equal(state.gridTotal.value, 0.5)
    state.updateCoverage(state.cellRows.value[0], '0')
    assert.equal(state.ready.value, false)
    state.updateCoverage(state.cellRows.value[0], '0.5')
    assert.equal(state.ready.value, true)
    await state.save()
    const gridWrite = calls.filter(call => call.options).at(-1).options.body.Rows[0]
    assert.equal(gridWrite.BTRID, 1); assert.equal(gridWrite.Revision, 1); assert.equal(gridWrite.Hours, '0.5')
    assert.equal(gridWrite.AttendanceDate, '2026-08-16')
    state.data.value = { ...fixture, batch: { ...batch, Status: 'Computed to Payroll' } }
    state.addCoverage(); assert.equal(state.drafts.value.length, 0, 'Computed DTR stays read-only')
    state.data.value = { ...fixture, batch: { ...batch, PeriodStart: '2028-02-16', PeriodEnd: '2028-02-29' } }
    assert.equal(state.cutoffDays.value.length, 14); assert.equal(state.cutoffDays.value.at(-1), '2028-02-29')
  } finally { scope.stop() }
})

test('MySQL BTR attendance warnings read current batch attendance without changing records', { skip: process.env.BTR_TEST_DATABASE !== '1' }, async () => {
  const mysql = require('mysql2/promise')
  const env = { ...require('node:util').parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
  const connection = await mysql.createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root', password: env.DB_PASSWORD, database: env.DB_NAME || 'pbsystem', dateStrings: true })
  try {
    const [batches] = await connection.execute('SELECT DISTINCT BatchID FROM attendance WHERE BatchID IS NOT NULL')
    assert.ok(batches.length, 'Existing DTR attendance is needed for this read-only check')
    const api = moduleFrom('server/utils/dtrBtrCrud.ts', { h3, '../../shared/utils/dtrBtr': shared,
      '../connection/dbconnect': { getConnection: async () => ({ execute: (...args) => connection.execute(...args),
        beginTransaction: () => connection.query('START TRANSACTION READ ONLY'), commit: () => connection.commit(), rollback: () => connection.rollback(), release() {} }) },
      './auth': { requireSession: () => ({ sub: 1 }) } })
    for (const { BatchID } of batches) {
      const listing = await api.listDtrBtr({ batchId: BatchID })
      const [rows] = await connection.execute('SELECT * FROM attendance WHERE BatchID=?', [BatchID])
      assert.equal(listing.attendance.length, rows.length)
      for (const row of rows) {
        const day = listing.attendance.find(item => item.EmployeeID === row.EmployeeID && item.AttendanceDate === row.AttendanceDate)
        const worked = !['Absent','Rest Day','On-Leave','Reliever'].includes(row.AttendanceStatus) &&
          (Object.entries(row).some(([key,value]) => key.endsWith('Hours') && !['BreakHours','LateHours','UndertimeHours'].includes(key) && Number(value) > 0) || row.TimeIn != null || row.TimeOut != null)
        assert.equal(day.HasWork, worked)
        assert.equal(!!shared.btrAttendanceWarning(row.EmployeeID, row.AttendanceDate, listing.attendance), !worked)
      }
    }
  } finally { await connection.end() }
})

test('MySQL BTR CRUD, atomic sheet save, membership guards, soft removal, and payroll review (all writes rolled back)', { skip: process.env.BTR_TEST_DATABASE !== '1' }, async () => {
  const mysql = require('mysql2/promise')
  const env = { ...require('node:util').parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
  const connection = await mysql.createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root', password: env.DB_PASSWORD, database: env.DB_NAME || 'pbsystem', dateStrings: true })
  await connection.beginTransaction()
  try {
    const [[actor]] = await connection.execute('SELECT UserID FROM user ORDER BY UserID LIMIT 1')
    const [[worked]] = await connection.execute(`SELECT d.BatchID, d.AgencyID, d.PeriodStart, d.PeriodEnd, d.Status,
      a.EmployeeID, a.AttendanceDate, a.RegularHours, a.OTHours FROM attendance_dtr d
      INNER JOIN attendance a ON a.BatchID=d.BatchID
      INNER JOIN attendance_dtr_employee de ON de.BatchID=d.BatchID AND de.EmployeeID=a.EmployeeID
      WHERE d.Status='Draft' AND a.RegularHours>=2 AND a.AttendanceStatus IN ('Present','Late','Half-Day','Holiday')
      AND NOT EXISTS (SELECT 1 FROM attendance_dtr_btr b WHERE b.BatchID=d.BatchID)
      AND EXISTS (SELECT 1 FROM employee e INNER JOIN agency_position ap ON ap.AgencyPositionID=e.AgencyPositionID WHERE ap.AgencyID=d.AgencyID AND e.Status='Active' AND e.EmployeeID<>a.EmployeeID)
      ORDER BY d.BatchID,a.AttendanceDate LIMIT 1`)
    assert.ok(worked, 'A Draft DTR with worked attendance and two agency employees is needed for this integration check')
    const [[reliever]] = await connection.execute(`SELECT e.EmployeeID, e.EmployeeNumber FROM employee e INNER JOIN agency_position ap ON ap.AgencyPositionID=e.AgencyPositionID
      WHERE ap.AgencyID=? AND e.Status='Active' AND e.EmployeeID<>? ORDER BY e.EmployeeID LIMIT 1`, [worked.AgencyID, worked.EmployeeID])
    const [[outsider]] = await connection.execute(`SELECT e.EmployeeID FROM employee e INNER JOIN agency_position ap ON ap.AgencyPositionID=e.AgencyPositionID
      WHERE ap.AgencyID<>? AND e.Status='Active' ORDER BY e.EmployeeID LIMIT 1`, [worked.AgencyID])
    const wrapped = { execute: (...args) => connection.execute(...args),
      beginTransaction: () => connection.query('SAVEPOINT btr_api_test'),
      commit: () => connection.query('RELEASE SAVEPOINT btr_api_test'),
      rollback: () => connection.query('ROLLBACK TO SAVEPOINT btr_api_test'), release() {} }
    const api = moduleFrom('server/utils/dtrBtrCrud.ts', { h3, '../../shared/utils/dtrBtr': shared,
      '../connection/dbconnect': { getConnection: async () => wrapped }, './auth': { requireSession: () => ({ sub: actor.UserID }) } })
    const body = { AttendanceDate: worked.AttendanceDate, ReplacedEmployeeID: worked.EmployeeID, RelieverEmployeeID: reliever.EmployeeID, Hours: 1 }
    const event = { batchId: worked.BatchID, body }
    const before = await connection.execute('SELECT * FROM attendance WHERE BatchID=? ORDER BY AttendanceID', [worked.BatchID])
    const enrolledBefore = await connection.execute('SELECT * FROM attendance_dtr_employee WHERE BatchID=? ORDER BY EmployeeID', [worked.BatchID])
    const saved = await api.saveDtrBtr(event)
    let listing = await api.listDtrBtr(event)
    assert.equal(listing.entries.length, 1); assert.equal(listing.totals.TotalHours, 1)
    assert.equal(listing.entries[0].Issue, '')
    assert.equal(shared.btrAttendanceWarning(worked.EmployeeID, worked.AttendanceDate, listing.attendance), '')
    await assert.rejects(api.saveDtrBtr(event), /already has/)
    await assert.rejects(api.saveDtrBtr({ ...event, body: { ...body, RelieverEmployeeID: body.ReplacedEmployeeID } }), /different employee/)
    await assert.rejects(api.saveDtrBtr({ ...event, body: { ...body, AttendanceDate: '2026-02-30' } }), /valid date/)
    await assert.rejects(api.saveDtrBtr({ ...event, body: { ...body, AttendanceDate: '1900-01-01' } }), /cutoff/)
    if (outsider) await assert.rejects(api.saveDtrBtr({ ...event, body: { ...body, RelieverEmployeeID: outsider.EmployeeID } }), /this agency/)
    await assert.rejects(api.saveDtrBtr({ ...event, body: { ...body, Hours: 0 } }), /hours/)
    await assert.rejects(api.saveDtrBtr({ ...event, body: { ...body, Hours: 0.001 } }), /decimal/)
    await assert.rejects(api.saveDtrBtr({ ...event, body: { ...body, BTRID: saved.BTRID, Revision: 99 } }), /changed/)
    await assert.rejects(api.saveDtrBtr({ ...event, body: { ...body, BTRID: saved.BTRID, Revision: 1, Hours: 24.01 } }), /at most 24/)
    await api.saveDtrBtr({ ...event, body: { ...body, BTRID: saved.BTRID, Revision: 1, Hours: 1.5 } })
    listing = await api.listDtrBtr(event)
    assert.equal(listing.totals.TotalHours, 1.5); assert.equal(listing.entries[0].Revision, 2)
    assert.equal(JSON.stringify((await connection.execute('SELECT * FROM attendance WHERE BatchID=? ORDER BY AttendanceID', [worked.BatchID]))[0]), JSON.stringify(before[0]))
    assert.equal(JSON.stringify((await connection.execute('SELECT * FROM attendance_dtr_employee WHERE BatchID=? ORDER BY EmployeeID', [worked.BatchID]))[0]), JSON.stringify(enrolledBefore[0]))
    await api.assertDtrBtrReady(wrapped, worked)
    await connection.execute('UPDATE attendance SET RegularHours=0 WHERE BatchID=? AND EmployeeID=? AND AttendanceDate=?', [worked.BatchID, worked.EmployeeID, worked.AttendanceDate])
    await api.assertDtrBtrReady(wrapped, worked)
    listing = await api.listDtrBtr(event)
    assert.equal(listing.entries[0].Issue, '')
    // Blank/no-work attendance no longer prevents recording; the employee is enrolled.
    await api.saveDtrBtr({ ...event, body: { ...body, BTRID: saved.BTRID, Revision: 2, Hours: 2 } })
    for (const status of ['Absent','Rest Day','On-Leave','Reliever']) {
      await connection.query('SAVEPOINT btr_status_case')
      await connection.execute('UPDATE attendance SET AttendanceStatus=?, RegularHours=0 WHERE BatchID=? AND EmployeeID=? AND AttendanceDate=?', [status, worked.BatchID, worked.EmployeeID, worked.AttendanceDate])
      await api.saveDtrBtr({ ...event, body: { ...body, BTRID: saved.BTRID, Revision: 3, Hours: 2 } })
      const reviewed = await api.listDtrBtr(event)
      assert.equal(reviewed.entries[0].Issue, '')
      assert.ok(shared.btrAttendanceWarning(worked.EmployeeID, worked.AttendanceDate, reviewed.attendance).includes('status: '+status))
      await connection.query('ROLLBACK TO SAVEPOINT btr_status_case')
    }
    await connection.query('SAVEPOINT btr_blank_case')
    await connection.execute('DELETE FROM attendance WHERE BatchID=? AND EmployeeID=? AND AttendanceDate=?', [worked.BatchID, worked.EmployeeID, worked.AttendanceDate])
    await api.saveDtrBtr({ ...event, body: { ...body, BTRID: saved.BTRID, Revision: 3, Hours: 2 } })
    await connection.query('ROLLBACK TO SAVEPOINT btr_blank_case')
    const nextDate = new Date(worked.PeriodStart+'T00:00:00'); nextDate.setDate(nextDate.getDate()+1)
    const secondDate = shared.btrDate(nextDate)
    const thirdDate = new Date(nextDate); thirdDate.setDate(thirdDate.getDate()+1)
    const row2 = { ...body, AttendanceDate: secondDate, RelieverEmployeeID: 'EMP-'+String(reliever.EmployeeID).padStart(4,'0') }
    await assert.rejects(api.saveDtrBtr({ ...event, body: { Rows: [row2, { ...body, AttendanceDate: shared.btrDate(thirdDate), ReplacedEmployeeID: 'missing-employee' }] } }), /Row 2/)
    assert.equal((await api.listDtrBtr(event)).entries.length, 1, 'The first row rolls back when another row fails')
    const [[rest]] = await connection.execute('SELECT EmployeeNumber FROM employee WHERE EmployeeID=?', [worked.EmployeeID])
    await api.saveDtrBtr({ ...event, body: { Rows: [{ ...row2, ReplacedEmployeeID: rest.EmployeeNumber || 'EMP-'+worked.EmployeeID }] } })
    assert.equal((await api.listDtrBtr(event)).entries.length, 2)
    await connection.query('SAVEPOINT btr_membership_test')
    await connection.execute('DELETE FROM attendance_dtr_employee WHERE BatchID=? AND EmployeeID=?', [worked.BatchID, worked.EmployeeID])
    await assert.rejects(api.assertDtrBtrReady(wrapped, worked), /Review/)
    await connection.query('ROLLBACK TO SAVEPOINT btr_membership_test')
    await connection.execute("UPDATE attendance_dtr SET Status='Computed to Payroll' WHERE BatchID=?", [worked.BatchID])
    await assert.rejects(api.removeDtrBtr({ batchId: worked.BatchID, query: { btrId: saved.BTRID, revision: 3 } }), /Draft/)
    await connection.execute("UPDATE attendance_dtr SET Status='Draft' WHERE BatchID=?", [worked.BatchID])
    await api.removeDtrBtr({ batchId: worked.BatchID, query: { btrId: saved.BTRID, revision: 3 } })
    assert.equal((await api.listDtrBtr(event)).entries.length, 1)
    const [[removed]] = await connection.execute('SELECT Status FROM attendance_dtr_btr WHERE BTRID=?', [saved.BTRID])
    assert.equal(removed.Status, 'Inactive')
  } finally { await connection.rollback(); await connection.end() }
})
