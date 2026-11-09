const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const moduleScope = { exports: {} }
vm.runInNewContext(transformSync(fs.readFileSync('app/utils/employee.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module: moduleScope })
const { employeeAge, employeeCurrentDate, formatEmployeeAge } = moduleScope.exports

test('age advances on the birthday, including across the year boundary', () => {
  assert.equal(employeeAge('2001-11-09', '2026-11-08'), 24)
  assert.equal(employeeAge('2001-11-09', '2026-11-09'), 25)
  assert.equal(employeeAge('2001-11-09', '2026-11-10'), 25)
  assert.equal(employeeAge('2001-01-01', '2026-12-31'), 25)
  assert.equal(employeeAge('2001-01-01', '2027-01-01'), 26)
  assert.equal(employeeAge('2026-11-09', '2026-11-09'), 0)
  assert.equal(formatEmployeeAge('2025-11-09', '2026-11-09'), '1 year old')
  assert.equal(formatEmployeeAge('2001-11-09', '2026-11-09'), '25 years old')
})

test('calendar dates retain the saved birthday and handle leap years', () => {
  assert.equal(employeeAge('2001-11-09T00:00:00.000Z', '2026-11-09'), 25)
  assert.equal(employeeAge('2000-02-29', '2026-02-28'), 25)
  assert.equal(employeeAge('2000-02-29', '2026-03-01'), 26)
  assert.equal(employeeAge('2000-02-29', '2028-02-29'), 28)
  assert.equal(employeeAge('1900-02-29', '2026-11-09'), null)
})

test('missing, impossible, and future birthdays never display an incorrect age', () => {
  for (const birthday of ['', null, undefined, 'invalid', '0000-00-00', '2001-02-29', '2001-04-31', '2001-13-01', '2026-11-10', '2027-01-01']) {
    assert.equal(employeeAge(birthday, '2026-11-09'), null, String(birthday))
    assert.equal(formatEmployeeAge(birthday, '2026-11-09'), '\u2014')
  }
})

test('current day changes at Philippine midnight regardless of the host timezone', () => {
  assert.equal(employeeCurrentDate(new Date('2026-11-08T15:59:59Z')), '2026-11-08')
  assert.equal(employeeCurrentDate(new Date('2026-11-08T16:00:00Z')), '2026-11-09')
})
