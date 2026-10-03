const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')

const moduleState = { exports: {} }
const source = fs.readFileSync('server/utils/dtrCrud.ts', 'utf8')
vm.runInNewContext(transformSync(source + `
  module.exports.sitePolicyTest = {
    automaticWdoCount,
    sundayWdoOtHours,
    wdoAttendanceIds,
    activeHolidaysByDate,
  };
`, { loader: 'ts', format: 'cjs' }).code, { module: moduleState, require: () => ({}) })

const { automaticWdoCount, sundayWdoOtHours, wdoAttendanceIds, activeHolidaysByDate } = moduleState.exports.sitePolicyTest

test('automatic WDO follows the configured 14 and 15 day thresholds', () => {
  assert.equal(automaticWdoCount(13, 1), 0)
  assert.equal(automaticWdoCount(14, 1), 1)
  assert.equal(automaticWdoCount(15, 1), 2)
  assert.equal(automaticWdoCount(16, true), 2)
  assert.equal(automaticWdoCount(16, 0), 0)
})

test('Sunday WDO OT credits only regular OT and OT extension when enabled', () => {
  assert.equal(sundayWdoOtHours('2026-09-06', 0, 0, 1), 0)
  assert.equal(sundayWdoOtHours('2026-09-13', 4, 0, true), 4)
  assert.equal(sundayWdoOtHours('2026-09-13', 4, 2.5, 1), 6.5)
  assert.equal(sundayWdoOtHours('2026-09-14', 4, 2, 1), 0)
  assert.equal(sundayWdoOtHours('2026-09-13', 4, 2, 0), 0)
})

test('worked Sundays count as WDO days while automatic WDO fills remaining earned days', () => {
  const rows = [
    { AttendanceID: 15, AttendanceDate: '2026-09-15' },
    { AttendanceID: 14, AttendanceDate: '2026-09-14' },
    { AttendanceID: 13, AttendanceDate: '2026-09-13' },
    { AttendanceID: 6, AttendanceDate: '2026-09-06' },
  ]
  assert.deepEqual(Array.from(wdoAttendanceIds(rows, 2, 1)), [13, 6])
  assert.deepEqual(Array.from(wdoAttendanceIds(rows, 2, 0)), [15, 14])
  assert.deepEqual(Array.from(wdoAttendanceIds(rows, 0, 1)), [13, 6])
})

test('Legal Holidays always apply while Special Holidays follow the site mapping', async () => {
  const holidays = [
    { HolidayID: 1, HolidayName: 'Legal day', HolidayDate: '2026-09-07', HolidayType: 'Legal', Recurring: 0 },
    { HolidayID: 2, HolidayName: 'Regional day', HolidayDate: '2026-09-08', HolidayType: 'Special', Recurring: 0 },
    { HolidayID: 3, HolidayName: 'Other regional day', HolidayDate: '2026-09-09', HolidayType: 'Special', Recurring: 0 },
  ]
  const connection = {
    execute: async (sql) => sql.includes('FROM holiday') ? [holidays] : [[{ HolidayID: 2 }]],
  }
  const result = await activeHolidaysByDate(connection, ['2026-09-07', '2026-09-08', '2026-09-09'], 10)
  assert.equal(result.get('2026-09-07').HolidayType, 'Legal')
  assert.equal(result.get('2026-09-08').HolidayName, 'Regional day')
  assert.equal(result.has('2026-09-09'), false)
})

test('DTR summaries expose WDO and WDO OT without the removed WDO Hours column', () => {
  for (const filename of ['app/components/DtrAttendanceWorkspace.vue', 'app/components/DtrCompactPrintView.vue']) {
    const contents = fs.readFileSync(filename, 'utf8')
    const summary = contents.slice(contents.indexOf('const summaryFields'), contents.indexOf('] as const', contents.indexOf('const summaryFields')))
    assert.match(summary, /\['WDODays',\s*'WDO'\]/)
    assert.match(summary, /\['RestDayOTHours',\s*'WDO OT'\]/)
    assert.doesNotMatch(summary, /\['RestDayHours',\s*'WDO hours'\]/)
  }
})
