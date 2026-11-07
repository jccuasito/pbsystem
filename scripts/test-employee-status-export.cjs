const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const XLSX = require('xlsx')
const { employeeDailySites } = require('../shared/utils/employeeStatusSheet.ts')

function exportApi() {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync('shared/utils/employeeStatusExport.ts', 'utf8'), { loader: 'ts', format: 'cjs', supported: { 'dynamic-import': false } }).code,
    { module, TextEncoder, TextDecoder, Uint8Array, require: name => name === 'xlsx' ? XLSX : { employeeDailySites } })
  return module.exports
}

test('daily sites prefer dated attendance and retain multiple sites, without borrowing a current posting', () => {
  const records = [
    { EmployeeID: 1, AttendanceDate: '2026-09-20', SiteID: 2, SiteName: 'Actual site', ClientName: 'Client' },
    { EmployeeID: 1, AttendanceDate: '2026-09-20', SiteID: 3, SiteName: 'Second site', ClientName: 'Client' },
    { EmployeeID: 1, AttendanceDate: '2026-09-20', SiteID: 2, SiteName: 'Actual site', ClientName: 'Client' },
  ]
  const fixed = [{ EmployeeID: 1, StartDate: '2026-10-01', SiteID: 4, SiteName: 'Current site' }]
  const roster = [{ EmployeeID: 1, PeriodStart: '2026-09-16', PeriodEnd: '2026-09-30', StartDate: '2026-09-18', EndDate: '2026-09-25', SiteID: 1, SiteName: 'Assigned site' }]
  const actual = employeeDailySites(1, '2026-09-20', records, roster, fixed)
  assert.deepEqual(actual.map(row => row.SiteID), [2, 3])
  assert.ok(actual.every(row => row.Source === 'Attendance record'))
  assert.equal(employeeDailySites(1, '2026-09-19', records, roster, fixed)[0].Source, 'DTR assignment')
  assert.equal(employeeDailySites(1, '2026-10-02', records, roster, fixed)[0].Source, 'Fixed deployment')
  assert.equal(employeeDailySites(1, '2026-09-16', records, roster, fixed).length, 0)
  assert.equal(employeeDailySites(2, '2026-09-20', records, roster, fixed).length, 0)
})

test('Excel export preserves filtered people, identifiers, typed dates, site history and native print settings', async () => {
  const employees = Array.from({ length: 8 }, (_, i) => ({ EmployeeID: i + 1, EmployeeNumber: i === 0 ? '00023' : null, EmployeeName: i === 1 ? '=1+1' : `Employee ${i + 1}`, AgencyName: 'Test agency', PositionName: 'Guard' }))
  const dates = Array.from({ length: 15 }, (_, i) => `2026-09-${i + 16}`)
  const history = [
    { EmployeeID: 1, AttendanceDate: dates[0], AttendanceStatus: 'Present', SiteID: 2, SiteName: 'Actual site', ClientName: 'Client', DtrStatus: 'Computed to Payroll', Remarks: 'Original record' },
    { EmployeeID: 1, AttendanceDate: dates[0], AttendanceStatus: 'Late', SiteID: 3, SiteName: 'Second site', ClientName: 'Client', DtrStatus: 'Draft', Remarks: 'Second duty' },
    { EmployeeID: 999, AttendanceDate: dates[0], AttendanceStatus: 'Absent', SiteName: 'Excluded employee site' },
  ]
  const bytes = await exportApi().createEmployeeStatusWorkbook({ employees, dates, history,
    rosters: [{ EmployeeID: 1, PeriodStart: dates[0], PeriodEnd: dates[14], SiteID: 1, SiteName: 'Roster site' }], deployments: [],
    filters: { Agency: 'Test agency', Status: 'Present' }, statusAt: (id, day) => id === 1 && day === dates[0] ? 'Present' : undefined })
  fs.mkdirSync('.data', { recursive: true })
  fs.writeFileSync('.data/employee-status-export-test.xlsx', bytes)
  const wb = XLSX.read(bytes, { type: 'array', cellStyles: true })
  assert.deepEqual(wb.SheetNames, ['Cutoff Sheet', 'Daily Details'])
  const grid = wb.Sheets['Cutoff Sheet'], details = wb.Sheets['Daily Details']
  assert.equal(grid.B7.v, '00023')
  assert.equal(grid.B7.t, 's')
  assert.equal(grid.F6.t, 'n')
  assert.equal(grid.F7.v, 'P')
  assert.match(grid.F8.v, /Actual site/)
  assert.match(grid.F8.v, /Second site/)
  assert.match(grid.G8.v, /Assigned: Roster site/)
  assert.equal(grid.F9.v, 'NE')
  assert.equal(grid.C9.v, '=1+1')
  assert.equal(grid.C9.f, undefined)
  assert.equal(details.D7.t, 'n')
  assert.equal(details.D7.z, 'mmm d, yyyy')
  const rows = XLSX.utils.sheet_to_json(details, { header: 1 })
  assert.equal(rows.length, 127)
  assert.ok(rows.some(row => row[5] === 'Client / Second site' && row[4] === 'Late'))
  assert.ok(rows.some(row => row[4] === 'Not yet encoded' && row[6] === 'Not assigned'))
  assert.ok(!rows.some(row => row.join(' ').includes('Excluded employee site')))
  assert.match(grid.A3.v, /Agency: Test agency/)
  assert.ok(wb.Workbook.Names.some(row => row.Name === '_xlnm.Print_Titles'))
  const zip = XLSX.CFB.read(bytes, { type: 'buffer' })
  const xml = path => new TextDecoder().decode(zip.FileIndex[zip.FullPaths.findIndex(name => name.endsWith('/' + path))].content)
  for (const n of [1, 2]) {
    const sheet = xml(`xl/worksheets/sheet${n}.xml`)
    assert.match(sheet, /orientation="landscape" fitToWidth="1" fitToHeight="0"/)
    assert.match(sheet, /state="frozen"/)
    assert.ok(sheet.indexOf('<pageSetup') < sheet.indexOf('<ignoredErrors'))
  }
  assert.match(xml('xl/worksheets/sheet1.xml'), /paperSize="8"/)
  assert.match(xml('xl/worksheets/sheet2.xml'), /paperSize="9"/)
  assert.match(xml('xl/worksheets/sheet1.xml'), /<rowBreaks/)
  assert.match(xml('xl/styles.xml'), /<cellXfs count="13">/)
  for (const sheet of [grid, details]) assert.ok(Object.entries(sheet).filter(([key]) => !key.startsWith('!')).every(([, cell]) => !cell.f), 'Text cannot become a formula')
})
