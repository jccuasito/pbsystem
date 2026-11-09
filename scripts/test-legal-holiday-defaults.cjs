const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const { test } = require('node:test'), { transformSync } = require('esbuild'), { parse } = require('@vue/compiler-sfc'), vue = require('vue')
const calendar = require('../shared/utils/philippineLegalHolidays.ts')

test('Legal default lists include annual regular holidays only and no guessed Eid dates', () => {
  assert.equal(calendar.legalHolidayDefaults(2026).length, 12)
  assert.equal(calendar.legalHolidayDefaults(2027).length, 10)
  assert.equal(calendar.legalHolidayDefaults(2028).length, 0)
  assert.ok(calendar.legalHolidayDefaults(2026).every(row => row.HolidayType === 'Legal'))
  const find = (year, key) => calendar.legalHolidayDefaults(year).find(row => row.key === key)
  assert.equal(find(2026, 'heroes').HolidayDate, '2026-08-31')
  assert.equal(find(2027, 'heroes').HolidayDate, '2027-08-30')
  assert.equal(find(2026, 'eid-fitr').HolidayDate, '2026-03-20')
  assert.equal(find(2026, 'eid-adha').HolidayDate, '2026-05-27')
  assert.equal(find(2027, 'maundy-thursday').HolidayDate, '2027-03-25')
  assert.equal(find(2027, 'heroes').Recurring, 0)
  assert.equal(find(2027, 'christmas').Recurring, 1)
})

test('recurring date display follows the selected year and weekday without modifying stored dates', () => {
  const date = calendar.holidayDisplayDate('2026-12-25', 1, 2027)
  assert.equal(date, '2027-12-25')
  assert.equal(calendar.holidayWeekday(date), 'Saturday')
  assert.equal(calendar.holidayWeekday('2026-12-25'), 'Friday')
  assert.equal(calendar.holidayDisplayDate('2026-12-25', 0, 2027), '2026-12-25')
  assert.equal(calendar.holidayDisplayDate('2024-02-29', 1, 2027), '')
})

test('year filtering preserves the existing edit payload, type filters, and CRUD requests', async () => {
  const scope = vue.effectScope(), calls = [], module = { exports: {} }
  const source = parse(fs.readFileSync('app/pages/attendance/holiday-manager/index.vue', 'utf8')).descriptor.scriptSetup.content
  const rows = [{ HolidayID: 2, HolidayName: 'Christmas Day', HolidayDate: '2026-12-25', HolidayType: 'Legal', Recurring: 1, Status: 'Active' }, { HolidayID: 4, HolidayName: 'Cebu holiday', HolidayDate: '2026-09-09', HolidayType: 'Special', Recurring: 1, Status: 'Active' }]
  scope.run(() => vm.runInNewContext(transformSync(source + '\nmodule.exports={items,yearFilter,filteredItems,typeFilter,editing,form,edit,save,deactivate,modalOpen};', { loader: 'ts', format: 'cjs' }).code, { module, require: name => name === 'vue' ? { ...vue, onMounted() {} } : name.includes('philippineLegalHolidays') ? calendar : { useRealtimeRefresh() {} }, $fetch: async (url, options) => { calls.push({ url, options }); return { items: rows } }, confirm: () => true }))
  try {
    const state = module.exports
    state.items.value = rows; state.yearFilter.value = '2027'
    const christmas = state.filteredItems.value.find(row => row.HolidayID === 2)
    assert.equal(christmas.DisplayDate, '2027-12-25')
    state.edit(christmas)
    assert.equal(state.form.value.HolidayDate, '2026-12-25', 'Editing keeps the existing saved recurrence anchor')
    await state.save()
    assert.equal(calls[0].options.method, 'PUT')
    assert.equal(calls[0].options.body.id, 2)
    assert.equal(calls[0].options.body.HolidayDate, '2026-12-25')
    await state.deactivate(christmas)
    assert.equal(calls[2].options.method, 'DELETE')
    assert.equal(calls[2].options.body.id, 2)
    state.typeFilter.value = 'Special'
    assert.equal(state.filteredItems.value.length, 1)
    assert.equal(state.filteredItems.value[0].HolidayID, 4)
  } finally { scope.stop() }
})

test('database defaults are idempotent and existing DTR functions read them without schema or Special changes', { skip: process.env.LEGAL_HOLIDAY_TEST_DATABASE !== '1' }, async () => {
  const mysql = require('mysql2/promise'), { seedLegalHolidayDefaults } = await import('../server/utils/legalHolidayDefaults.ts')
  const db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'pbsystem', timezone: 'Z', dateStrings: true })
  try {
    await db.query('CREATE TEMPORARY TABLE holiday (HolidayID INT PRIMARY KEY AUTO_INCREMENT, HolidayName VARCHAR(150), HolidayDate DATE, HolidayType VARCHAR(20), Recurring INT DEFAULT 0, Status VARCHAR(20), CreatedBy INT NULL, UNIQUE KEY uq_name_date (HolidayDate,HolidayName))')
    await db.query('CREATE TEMPORARY TABLE site_special_holiday (SiteID INT, HolidayID INT)')
    await db.execute("INSERT INTO holiday (HolidayID,HolidayName,HolidayDate,HolidayType,Recurring,Status) VALUES (1,?,'2026-08-31','Legal',1,'Active'),(2,?,'2026-12-25','Legal',1,'Inactive'),(3,?,'2026-08-21','Special',1,'Active'),(4,?,'2026-09-09','Special',1,'Active')", ['Heroes Day', 'Christmas Day', 'Ninoy Aquino Day', 'Cebu holiday'])
    const [specialBefore] = await db.execute("SELECT * FROM holiday WHERE HolidayType = 'Special' ORDER BY HolidayID")
    assert.deepEqual(await seedLegalHolidayDefaults(db, [2026, 2027]), { added: 13, correctedRecurrence: 1 })
    assert.deepEqual(await seedLegalHolidayDefaults(db, [2026, 2027]), { added: 0, correctedRecurrence: 0 })
    const [specialAfter] = await db.execute("SELECT * FROM holiday WHERE HolidayType = 'Special' ORDER BY HolidayID")
    assert.deepEqual(specialAfter, specialBefore)
    const [[christmas]] = await db.execute('SELECT Status FROM holiday WHERE HolidayID = ?', [2])
    assert.equal(christmas.Status, 'Inactive', 'Defaults never reactivate a saved record')
    const dtr = { exports: {} }
    vm.runInNewContext(transformSync(fs.readFileSync('server/utils/dtrCrud.ts', 'utf8') + '\nmodule.exports={activeHolidaysByDate};', { loader: 'ts', format: 'cjs' }).code, { module: dtr, require: () => ({}) })
    let holidays = await dtr.exports.activeHolidaysByDate(db, ['2027-08-30', '2027-08-31', '2027-12-25', '2027-09-09'], 99)
    assert.equal(holidays.get('2027-08-30').HolidayType, 'Legal')
    assert.equal(holidays.has('2027-08-31'), false, 'The old Heroes Day date does not recur incorrectly')
    assert.equal(holidays.has('2027-12-25'), false, 'Existing DTR respects deactivation')
    assert.equal(holidays.has('2027-09-09'), false, 'Special still requires site applicability')
    await db.execute('INSERT INTO site_special_holiday VALUES (?, ?)', [99, 4])
    holidays = await dtr.exports.activeHolidaysByDate(db, ['2027-09-09'], 99)
    assert.equal(holidays.get('2027-09-09').HolidayType, 'Special')
  } finally { await db.end() }
})
