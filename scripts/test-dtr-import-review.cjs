// Executes the real import loop with an in-memory transaction adapter. No real SQL writes.
const { test } = require('node:test')
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const { transformSync } = require('esbuild')
const review = require('../shared/utils/dtrImportReview.ts')
const statuses = require('../shared/utils/attendanceStatuses.ts')
const shifts = [
  { ShiftCodeID: 1, ShiftCode: 'DS0700-1900', ShiftType: 'DS', TimeIn: '07:00', TimeOut: '19:00', RegularHours: 8, RegularOTCap: 4 },
  { ShiftCodeID: 2, ShiftCode: 'NS2200-1000', ShiftType: 'NS', TimeIn: '22:00', TimeOut: '10:00', RegularHours: 8, RegularOTCap: 4 },
]
function harness() {
  const attendance = new Map(), duties = [], writes = [], transaction = { committed: false, rolledBack: false, released: false }
  let nextId = 100
  const employees = [{ EmployeeID: 10, EmployeeNumber: 'DJA-0001', EmployeeName: 'DELA CRUZ, JUAN SANTOS', DeploymentID: 1, AttendanceType: 'Regular' }, { EmployeeID: 11, EmployeeNumber: null, EmployeeName: 'GARCIA, MARIA REYES', DeploymentID: 2, AttendanceType: 'Regular' }]
  attendance.set('11:2026-09-20', { AttendanceID: 80, BatchID: 1, AttendanceStatus: 'On-Leave' })
  attendance.set('10:2026-09-24', { AttendanceID: 81, BatchID: 1, AttendanceStatus: 'Present' })
  const connection = {
    async beginTransaction() {}, async commit() { transaction.committed = true }, async rollback() { transaction.rolledBack = true }, release() { transaction.released = true },
    async execute(sql, params) {
      if (sql.includes('FROM attendance_dtr_employee de')) return [employees]
      if (sql.includes('FROM shift_code WHERE')) return [shifts]
      if (sql.startsWith('SELECT AttendanceID, BatchID, AttendanceStatus FROM attendance')) return [[attendance.get(`${params[0]}:${params[1]}`)].filter(Boolean)]
      if (sql.startsWith('SELECT COUNT(*) AS DutyCount')) {
        const rows = duties.filter(d => d.AttendanceID === params[0]), totals = { DutyCount: rows.length, TimeIn: rows.map(d => d.TimeIn).sort()[0], TimeOut: rows.map(d => d.TimeOut).sort().at(-1), OnlyShiftCodeID: rows[0]?.ShiftCodeID }
        for (const key of ['RegularHours','OTHours','OTExtHours','NightDiffHours','LateHours','UndertimeHours']) totals[key] = rows.reduce((sum, row) => sum + row[key], 0)
        return [[totals]]
      }
      writes.push({ sql, params })
      if (sql.startsWith('INSERT INTO attendance (')) {
        const id = nextId++; attendance.set(`${params[0]}:${params[4]}`, { AttendanceID: id, BatchID: 1, AttendanceStatus: 'Present' }); return [{ insertId: id }]
      }
      if (sql.startsWith('INSERT INTO attendance_duty')) {
        const keys = ['AttendanceID','ShiftCodeID','SourceRowNumber','TimeIn','TimeOut','RegularHours','OTHours','OTExtHours','NightDiffHours','LateHours','UndertimeHours']
        duties.push(Object.fromEntries(keys.map((key, i) => [key, params[i]])))
      }
      if (sql.startsWith('DELETE FROM attendance WHERE')) for (const [key, row] of attendance) if (row.AttendanceID === params[0]) attendance.delete(key)
      return [{ affectedRows: 1 }]
    },
  }
  const context = { module: { exports: {} }, Map, Set, Date, require(name) {
    if (name === 'h3') return { getRouterParam: () => '1', createError: input => Object.assign(new Error(input.statusMessage), input) }
    if (name.endsWith('dbconnect')) return { getConnection: async () => connection }
    if (name.includes('dtrImportReview')) return review
    if (name.includes('attendanceStatuses')) return statuses
    if (name.includes('employeeStatusCrud')) return { employeeStatusAttendanceStatuses: ['On-Leave','Vacation Leave','Sick Leave','Suspended'], attachPendingEmployeeStatuses: async () => {} }
    if (name.includes('dtrDeploymentDates')) return { dtrDeploymentAtDate: async (_, enrollment) => enrollment }
    return {}
  } }
  vm.createContext(context)
  const source = fs.readFileSync('server/utils/dtrCrud.ts', 'utf8') + `
    batchDetail = async () => ({BatchID:1, AgencyID:1, SiteID:1, Status:'Draft', PeriodStart:'2026-09-16', PeriodEnd:'2026-09-30'});
    sitePolicyForBatch = async () => ({AutoBreakEnabled:0,DayShiftNDEnabled:0});
    activeHolidaysByDate = async () => new Map(); lockAttendanceEmployee = async () => {};
    syncBatchHolidays = async () => {}; syncAutoWdo = async () => {}; otherDtrAttendance = async () => [];
    module.exports.importRows = Rows => importDtrAttendanceDutyRows({}, {Rows}, {sub:1});`
  vm.runInContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, context)
  return { run: context.module.exports.importRows, transaction, duties, writes }
}
const source = (row, employee, date, extra = {}) => ({ RowNumber: row, EmployeeID: employee, AttendanceDate: date, ShiftCode: 'DS0700-1900', TimeIn: '07:00', TimeOut: '19:00', ...extra })

test('import report identifies actual source rows, overnight late, undertime and every incomplete punch without inventing absence', async () => {
  const h = harness()
  const result = await h.run([
    source(2,'DJA-0001','2026-09-16'),
    source(27,'EMP-0011','2026-09-23',{ShiftCode:'NS2200-1000',TimeIn:'22:16',TimeOut:'10:00',DateOut:'2026-09-24'}),
    source(11,'DJA-0001','2026-09-22',{TimeOut:''}),
    source(12,'DJA-0001','2026-09-23',{TimeIn:''}),
    source(22,'EMP-0011','2026-09-18',{TimeIn:'',TimeOut:'',ShiftCode:''}),
    source(30,'EMP-0011','2026-09-26',{ShiftCode:'MISSING'}),
    source(10,'DJA-0001','2026-09-21',{TimeOut:'18:00'}),
    source(40,'EMP-0011','2026-09-20'),
    source(41,'DJA-0001','2026-09-24',{TimeIn:'',TimeOut:''}),
  ])
  const byRow = new Map(result.reviewRows.map(row => [row.row,row]))
  assert.equal(result.reviewRows.length, 9)
  assert.equal(byRow.get(27).employeeName, 'GARCIA, MARIA REYES')
  assert.equal(byRow.get(27).employeeId, 11); assert.equal(byRow.get(2).employeeId, 10)
  assert.equal(byRow.get(27).lateMinutes, 16)
  assert.equal(byRow.get(27).expectedTimeIn, '2026-09-23 22:00:00')
  assert.equal(byRow.get(27).expectedTimeOut, '2026-09-24 10:00:00')
  assert.equal(byRow.get(10).undertimeMinutes, 60)
  assert.ok(byRow.get(11).flags.includes('missing-out')); assert.ok(byRow.get(12).flags.includes('missing-in'))
  assert.ok(byRow.get(22).flags.includes('no-punches')); assert.equal(byRow.get(22).outcome, 'blank')
  assert.equal(byRow.get(30).outcome, 'skipped'); assert.match(byRow.get(30).reason, /Shift code "MISSING"/)
  assert.equal(byRow.get(40).outcome, 'preserved'); assert.equal(result.preservedEmployeeStatusDays, 1)
  assert.equal(byRow.get(41).cleared, true); assert.equal(result.cleared, 1)
  assert.equal(h.duties.length, 3); assert.equal(h.duties[1].LateHours, .27)
  assert.ok(result.reviewRows.every(row => row.sourceStatus !== 'Absent'))
  assert.deepEqual(h.transaction, { committed: true, rolledBack: false, released: true })
})

test('detailed report retains all skipped rows beyond the legacy 12-note limit and avoids links for invalid employee/date', async () => {
  const h = harness(), rows = Array.from({ length: 16 }, (_, i) => source(i + 100, 'unknown', '2026-09-20'))
  rows.push(source(200,'DJA-0001','2026-10-01'))
  const result = await h.run(rows)
  assert.equal(result.issues.length, 12); assert.equal(result.reviewRows.length, 17)
  assert.equal(result.reviewRows.at(-1).canReview, false)
  assert.ok(result.reviewRows.every(row => !row.canReview && row.outcome === 'skipped'))
  assert.equal(h.duties.length, 0)
})

test('duplicate/overnight overlap diagnostics preserve distinct adjacent duties and never change imported amounts', async () => {
  const h = harness()
  const result = await h.run([
    source(2,'DJA-0001','2026-09-16'), source(3,'DJA-0001','2026-09-16'),
    source(4,'EMP-0011','2026-09-17',{ShiftCode:'NS2200-1000',TimeIn:'22:00',TimeOut:'10:00',DateOut:'2026-09-18'}),
    source(5,'EMP-0011','2026-09-18'),
    source(6,'DJA-0001','2026-09-16',{ShiftCode:'NS2200-1000',TimeIn:'19:00',TimeOut:'07:00',DateOut:'2026-09-17'}),
  ])
  assert.equal(result.reviewRows[0].flags.includes('duplicate'), true)
  assert.equal(result.reviewRows[1].flags.includes('duplicate'), true)
  assert.equal(result.reviewRows[2].flags.includes('overlap'), true)
  assert.equal(result.reviewRows[3].flags.includes('overlap'), true)
  assert.equal(result.reviewRows[4].flags.some(flag => ['duplicate','overlap'].includes(flag)), false)
  assert.equal(h.duties.length, 5)
  const counts = review.dtrImportReviewCounts(result.reviewRows)
  assert.equal(counts.conflicts, 4); assert.equal(counts.employees, 2)
})

test('oversized import is rejected before starting the transaction', async () => {
  const h = harness()
  await assert.rejects(h.run(Array(1001).fill(source(2,'DJA-0001','2026-09-16'))), /1,000/)
})
