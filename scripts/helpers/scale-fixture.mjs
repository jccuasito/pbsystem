import mysql from 'mysql2/promise'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const root = path.resolve('.data/scale-tests')
export const identifier = value => {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw Error('Unsafe test identifier')
  return '`' + value + '`'
}
export function localConfig() {
  const host = process.env.DB_HOST || '127.0.0.1'
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw Error('Scale testing is loopback-only')
  if (!process.env.DB_NAME) throw Error('Load the local .env first')
  return { host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, timezone: 'Z' }
}
export async function insert(db, table, rows) {
  if (!rows.length) return
  const keys = Object.keys(rows[0])
  for (let offset = 0; offset < rows.length; offset += 400) {
    const chunk = rows.slice(offset, offset + 400)
    await db.execute(`INSERT INTO ${identifier(table)} (${keys.map(k => '`' + k + '`').join(',')}) VALUES ${chunk.map(() => '(' + keys.map(() => '?').join(',') + ')').join(',')}`, chunk.flatMap(row => keys.map(k => row[k] ?? null)))
  }
}
export const sites = Array.from({ length: 500 }, (_, i) => ({ id: i + 1, agency: Math.floor(i / 50) + 1, client: Math.floor(i / 2) % 150 + 1, region: i % 3 + 1 }))
export const periods = [{ start: '2026-09-01', end: '2026-09-15' }, { start: '2026-09-16', end: '2026-09-30' }]
export const pad = n => String(n).padStart(6, '0')
export const rateId = (agency, position, region) => ((agency - 1) * 3 + position - 1) * 3 + region
export function rates(position, region, version = false, billing = false) {
  const regular = 70 + position * 5 + region + (version ? 3 : 0) + (billing ? 20 : 0)
  return { RegularRate: regular, OTRate: regular * 1.25, OTExtRate: regular * 1.3, NightDiffRate: 10, RestDayRate: 100,
    RestDayOTRate: 125, SpecialHolidayRate: 110, LegalHolidayRate: 140, SpecialHolidayOTRate: 137.5,
    LegalHolidayOTRate: 175, LateDeduction: regular, UndertimeDeduction: regular, BreakDeduction: regular, Allowance: billing ? 0 : 100 }
}
export function dayRecord(employeeId, day, periodIndex) {
  const date = `2026-09-${String(day + periodIndex * 15).padStart(2, '0')}`
  const absent = day === 4 && employeeId % 11 === 0, leave = day === 9 && employeeId % 23 === 0
  const rest = day === 7 && employeeId % 19 === 0
  return { AttendanceDate: date, AttendanceStatus: absent ? 'Absent' : leave ? 'On-Leave' : rest ? 'Rest Day' : 'Present',
    RegularHours: absent || leave || rest ? 0 : 8, OTHours: day === 2 ? 2 : 0,
    NightDiffHours: day === 6 && employeeId % 17 === 0 ? 4 : 0, RestDayHours: rest ? 8 : 0,
    LateHours: day === 3 && employeeId % 5 === 0 ? 0.25 : 0, UndertimeHours: day === 5 && employeeId % 13 === 0 ? 0.5 : 0 }
}
export function expectedPay(employeeId, periodIndex) {
  const site = sites[Math.floor((employeeId - 1) / 12)], position = (employeeId - 1) % 3 + 1
  let gross = 0, deductions = 0
  for (let day = 1; day <= 15; day++) {
    const record = dayRecord(employeeId, day, periodIndex), rate = rates(position, site.region, day + periodIndex * 15 >= 8)
    for (const [field, price] of [['RegularHours', 'RegularRate'], ['OTHours', 'OTRate'], ['NightDiffHours', 'NightDiffRate'], ['RestDayHours', 'RestDayRate']]) gross += Math.round(record[field] * rate[price] * 100)
    deductions += Math.round(record.LateHours * rate.RegularRate * 100) + Math.round(record.UndertimeHours * rate.RegularRate * 100)
  }
  deductions += (employeeId % 3 === 0 && employeeId % 30 !== 0 ? 50000 : 0) + (employeeId % 4 === 0 ? 12500 : 0) + (employeeId % 5 === 0 ? 5000 : 0) + 7500
  return { gross: gross + 10000, allowance: 10000, deductions, net: gross + 10000 - deductions }
}
export async function createFixture() {
  const config = localConfig(), source = process.env.DB_NAME
  const database = 'pbsystem_scale_' + new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '_' + randomBytes(2).toString('hex')
  const folder = path.join(root, database)
  await mkdir(folder, { recursive: true })
  const db = await mysql.createConnection(config)
  try {
    await db.query('USE ' + identifier(source))
    const [tables] = await db.query('SHOW FULL TABLES')
    const schema = []
    for (const table of tables) {
      const [name, type] = Object.values(table)
      const [[definition]] = await db.query('SHOW CREATE TABLE ' + identifier(name))
      schema.push({ name, type, sql: Object.values(definition)[1] })
    }
    const [triggers] = await db.query('SHOW TRIGGERS')
    await db.query('CREATE DATABASE ' + identifier(database) + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
    await db.query('USE ' + identifier(database))
    await db.query('SET FOREIGN_KEY_CHECKS=0')
    try {
      for (const table of schema.filter(row => row.type === 'BASE TABLE')) {
        if (table.sql.includes('`' + source + '`.')) throw Error('Unexpected schema-qualified table reference')
        await db.query(table.sql.replace(/ AUTO_INCREMENT=\d+/g, ''))
      }
    } finally { await db.query('SET FOREIGN_KEY_CHECKS=1') }
    for (const table of schema.filter(row => row.type === 'VIEW')) {
      const sql = table.sql.replace(/DEFINER=`[^`]+`@`[^`]+`/g, '').replace('SQL SECURITY DEFINER', 'SQL SECURITY INVOKER').split('`' + source + '`.').join('`' + database + '`.')
      await db.query(sql)
    }
    for (const trigger of triggers) await db.query(`CREATE TRIGGER ${identifier(trigger.Trigger)} ${trigger.Timing} ${trigger.Event} ON ${identifier(trigger.Table)} FOR EACH ROW ${trigger.Statement}`)
    await db.query('CREATE TABLE scale_test_manifest (Marker varchar(80) PRIMARY KEY, CreatedAt timestamp DEFAULT current_timestamp())')
    await db.execute('INSERT INTO scale_test_manifest(Marker) VALUES (?)', ['SYNTHETIC_ONLY_6000_500_150_V1'])
    await seedFixture(db)
    const manifest = { database, sourceSchema: source, createdAt: new Date().toISOString(), employees: 6000, sites: 500, clients: 150, agencies: 10, attendance: 180000, periods, syntheticOnly: true }
    await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2))
    console.log(JSON.stringify(manifest))
    return manifest
  } finally { await db.end() }
}
async function seedFixture(db) {
  console.log('Seeding synthetic organization, rates and accounts')
  await db.beginTransaction()
  try {
    await insert(db, 'department', [{ DepartmentID: 1, DepartmentName: 'SCALE TEST ONLY' }])
    await insert(db, 'user', ['Admin', 'Viewer'].map((UserType, i) => ({ UserID: i + 1, FirstName: 'SCALE', LastName: UserType, Gender: 'Prefer not to say', Email: `${UserType.toLowerCase()}@scale.example.invalid`, EmailVerified: 1, DepartmentID: 1, UserType })))
    await insert(db, 'agency', Array.from({ length: 10 }, (_, i) => ({ AgencyID: i + 1, AgencyName: `SCALE TEST Agency ${pad(i + 1)}` })))
    await insert(db, 'client', Array.from({ length: 150 }, (_, i) => ({ ClientID: i + 1, ClientName: `SCALE TEST Client ${pad(i + 1)}` })))
    await insert(db, 'site_account', Array.from({ length: 150 }, (_, i) => ({ SiteAccountID: i + 1, SiteAccountName: `SCALE TEST Account ${pad(i + 1)}` })))
    await insert(db, 'region', [1, 2, 3].map(id => ({ RegionID: id, RegionCode: `SCALE${id}`, RegionName: `SCALE Region ${id}` })))
    await insert(db, 'position', [1, 2, 3].map(id => ({ PositionID: id, PositionName: `SCALE Position ${id}` })))
    await insert(db, 'agency_position', Array.from({ length: 30 }, (_, i) => ({ AgencyPositionID: i + 1, AgencyID: Math.floor(i / 3) + 1, PositionID: i % 3 + 1 })))
    for (const kind of ['payroll', 'billing']) {
      const rows = [], versions = []
      for (let agency = 1; agency <= 10; agency++) for (let pos = 1; pos <= 3; pos++) for (let region = 1; region <= 3; region++) {
        const id = rateId(agency, pos, region), key = kind === 'payroll' ? 'PayrollRateID' : 'BillingRateID'
        rows.push({ [key]: id, AgencyPositionID: (agency - 1) * 3 + pos, RegionID: region, ...rates(pos, region, false, kind === 'billing'), EffectiveDate: '2026-01-01' })
        versions.push({ [key]: id, EffectiveDate: '2026-09-08', ...rates(pos, region, true, kind === 'billing'), Reason: 'Synthetic dated rate test' })
      }
      await insert(db, kind + '_rate', rows); await insert(db, kind + '_rate_version', versions)
    }
    await insert(db, 'site', sites.map(s => ({ SiteID: s.id, ClientID: s.client, RegionID: s.region, SiteName: `SCALE TEST Site ${pad(s.id)}`, SiteAccountID: s.client })))
    await insert(db, 'site_agency', sites.map(s => ({ SiteID: s.id, AgencyID: s.agency, SiteAccountID: s.client })))
    await insert(db, 'site_policy', sites.map(s => ({ SiteID: s.id, AutoWDOEnabled: 0, ComputeHoliday: 0, AutoBreakEnabled: 0 })))
    await insert(db, 'site_rate', sites.flatMap(s => [1, 2, 3].map(pos => ({ SiteRateID: (s.id - 1) * 3 + pos, SiteID: s.id, PayrollRateID: rateId(s.agency, pos, s.region), BillingRateID: rateId(s.agency, pos, s.region) }))))
    await insert(db, 'shift_code', Array.from({ length: 10 }, (_, i) => ({ ShiftCodeID: i + 1, AgencyID: i + 1, ShiftCode: 'SCALE0800-1600', ShiftName: 'Synthetic 8-hour shift', TimeIn: '08:00', TimeOut: '16:00' })))
    const employees = Array.from({ length: 6000 }, (_, i) => ({ id: i + 1, site: sites[Math.floor(i / 12)], pos: i % 3 + 1 }))
    await insert(db, 'employee', employees.map(e => ({ EmployeeID: e.id, AgencyPositionID: (e.site.agency - 1) * 3 + e.pos, EmployeeNumber: `SCALE-${pad(e.id)}`, FirstName: 'SYNTHETIC', LastName: `WORKER ${pad(e.id)}`, DateHired: '2026-01-01', CreatedBy: 1 })))
    await insert(db, 'employee_deployment', employees.map(e => ({ DeploymentID: e.id, EmployeeID: e.id, SiteRateID: (e.site.id - 1) * 3 + e.pos, SiteID: e.site.id, StartDate: '2026-01-01', CreatedBy: 1 })))
    await insert(db, 'deduction_loan_classification', ['Loan', 'Deduction', 'Recurring Deduction', 'Contribution'].map((kind, i) => ({ ClassificationID: i + 1, ClassificationName: 'SCALE ' + kind, AppliesTo: kind })))
    await insert(db, 'loan_type', [{ LoanTypeID: 1, LoanName: 'SCALE Loan', ClassificationID: 1 }])
    await insert(db, 'deduction_type', [2, 3, 4].map(id => ({ DeductionTypeID: id, ClassificationID: id, DeductionName: 'SCALE Deduction ' + id, DeductionCategory: id === 4 ? 'Government' : 'Company' })))
    await insert(db, 'employee_loan', employees.filter(e => e.id % 3 === 0).map(e => ({ EmployeeID: e.id, LoanTypeID: 1, AccountReference: `SCALEL${e.id}`, LoanAmount: 6000, RemainingBalance: 6000, MonthlyDeduction: 500, ReleaseDate: '2026-08-01', RepaymentStartDate: '2026-09-01', RepaymentCutoff: 'Both', IsPaused: e.id % 30 === 0 ? 1 : 0, PauseStartDate: e.id % 30 === 0 ? '2026-09-01' : null })))
    await insert(db, 'employee_deduction', employees.filter(e => e.id % 4 === 0).map(e => ({ EmployeeID: e.id, DeductionTypeID: 2, AccountReference: `SCALED${e.id}`, Amount: 1000, RemainingBalance: 1000, InstallmentAmount: 125, IssuanceDate: '2026-08-01', RepaymentStartDate: '2026-09-01', RepaymentCutoff: 'Both' })))
    await insert(db, 'employee_recurring_deduction', employees.filter(e => e.id % 5 === 0).map(e => ({ EmployeeID: e.id, DeductionTypeID: 3, AmountPerCutoff: 50, DeductOn: 'Both', EffectiveStartDate: '2026-01-01' })))
    await insert(db, 'agency_contribution_plan', Array.from({ length: 30 }, (_, i) => ({ AgencyID: Math.floor(i / 3) + 1, AgencyPositionID: i + 1, DeductionTypeID: 4, AmountPerCutoff: 75, DeductOn: 'Both', EffectiveStartDate: '2026-01-01', CreatedBy: 1 })))
    await db.commit()
    for (let period = 0; period < 2; period++) {
      await db.beginTransaction()
      await insert(db, 'attendance_dtr', sites.map(s => ({ BatchID: s.id + period * 500, AgencyID: s.agency, ClientID: s.client, SiteID: s.id, PeriodStart: periods[period].start, PeriodEnd: periods[period].end, CreatedBy: 1 })))
      await insert(db, 'attendance_dtr_employee', employees.map(e => ({ BatchID: e.site.id + period * 500, EmployeeID: e.id, DeploymentID: e.id, IsPermanentSite: 1, DefaultShiftCodeID: e.site.agency, CreatedBy: 1 })))
      for (let offset = 0; offset < employees.length; offset += 120) {
        await insert(db, 'attendance', employees.slice(offset, offset + 120).flatMap(e => Array.from({ length: 15 }, (_, i) => ({ EmployeeID: e.id, DeploymentID: e.id, BatchID: e.site.id + period * 500, ShiftCodeID: e.site.agency, ...dayRecord(e.id, i + 1, period), CreatedBy: 1 }))))
      }
      await db.commit(); console.log(`Seeded cutoff ${period + 1}: 90,000 attendance rows`)
    }
  } catch (error) { await db.rollback(); throw error }
}
