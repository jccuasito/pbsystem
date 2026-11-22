import { randomBytes } from 'node:crypto'
import { statfsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { insert, rates, rateId, pad } from './scale-fixture.mjs'

export const millionPeriod = { start: '2026-09-01', end: '2026-09-15' }
export const millionSites = Array.from({ length: 500 }, (_, i) => ({ id: i + 1,
  agency: Math.floor(i / 125) + 1, client: Math.floor(i / 2) % 150 + 1, region: i % 3 + 1 }))
export function resourceCheck(dataDirectory) {
  const disk = statfsSync(dataDirectory)
  if (disk.bavail * disk.bsize < 12 * 2 ** 30) throw Error('Stopped: database volume has less than 12 GiB free')
  if (os.freemem() < 512 * 2 ** 20) throw Error('Stopped: less than 512 MiB system memory available')
}

// The app subsequently computes/finalizes real DTRs. Seeding is bounded to 1,000
// employees / 15,000 attendance rows per committed transaction, never a million
// JavaScript objects or a single transaction spanning the complete fixture.
export async function seedMillionFixture(db, options = {}) {
  const [[variables]] = await db.query('SELECT @@datadir AS dataDirectory')
  resourceCheck(variables.dataDirectory)
  const portalSeed = options.portalSeed || randomBytes(32).toString('hex')
  let offsetStart = 0
  if (options.resume) {
    const [[marker]] = await db.execute('SELECT Marker FROM scale_test_manifest')
    if (marker.Marker !== 'SYNTHETIC_ONLY_MILLION_4_500_150_V1') throw Error('Not a million synthetic fixture')
    const [[existing]] = await db.execute('SELECT COUNT(*) AS n,MAX(EmployeeID) AS lastId FROM employee')
    offsetStart = Number(existing.n)
    if (offsetStart !== Number(existing.lastId) || offsetStart % 1000 !== 0 || offsetStart > 1_000_000) throw Error('Fixture is not at a committed seed boundary')
    // A first-run interruption may predate the persisted test token seed. These
    // sessions belong only to this marked synthetic schema; never actual users.
    if (!options.portalSeed) {
      await db.execute('DELETE FROM employee_portal_session')
      for (let offset = 0; offset < offsetStart; offset += 1000) await db.execute(`INSERT INTO employee_portal_session(TokenHash,AccountID,ExpiresAt)
        SELECT SHA2(SHA2(CONCAT(?,':',EmployeeID),256),256),EmployeeID,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 7 DAY)
        FROM employee WHERE EmployeeID>? AND EmployeeID<=?`, [portalSeed, offset, offset + 1000])
    }
  }
  if (options.folder) await writeFile(path.join(options.folder, 'seed-state.json'), JSON.stringify({ profile: 'million', portalSeed, completedEmployees: offsetStart, finished: false }))
  if (!options.resume) {
   await db.beginTransaction()
   try {
    await insert(db, 'department', [{ DepartmentID: 1, DepartmentName: 'MILLION SCALE TEST ONLY' }])
    await insert(db, 'user', Array.from({ length: 101 }, (_, i) => ({ UserID: i + 1, FirstName: 'SCALE', LastName: `STAFF ${pad(i + 1)}`,
      Gender: 'Prefer not to say', Email: `staff${i + 1}@million.example.invalid`, EmailVerified: 1, DepartmentID: 1, UserType: i < 100 ? 'Admin' : 'Viewer' })))
    await insert(db, 'agency', [1, 2, 3, 4].map(id => ({ AgencyID: id, AgencyName: `MILLION Agency ${id}` })))
    await insert(db, 'client', Array.from({ length: 150 }, (_, i) => ({ ClientID: i + 1, ClientName: `MILLION Client ${pad(i + 1)}` })))
    await insert(db, 'site_account', Array.from({ length: 150 }, (_, i) => ({ SiteAccountID: i + 1, SiteAccountName: `MILLION Account ${pad(i + 1)}` })))
    await insert(db, 'region', [1, 2, 3].map(id => ({ RegionID: id, RegionCode: `MILLION${id}`, RegionName: `MILLION Region ${id}` })))
    await insert(db, 'position', [1, 2, 3].map(id => ({ PositionID: id, PositionName: `MILLION Position ${id}` })))
    await insert(db, 'agency_position', Array.from({ length: 12 }, (_, i) => ({ AgencyPositionID: i + 1, AgencyID: Math.floor(i / 3) + 1, PositionID: i % 3 + 1 })))
    for (const kind of ['payroll', 'billing']) {
      const rows = [], versions = []
      for (let agency = 1; agency <= 4; agency++) for (let position = 1; position <= 3; position++) for (let region = 1; region <= 3; region++) {
        const key = kind === 'payroll' ? 'PayrollRateID' : 'BillingRateID', id = rateId(agency, position, region)
        rows.push({ [key]: id, AgencyPositionID: (agency - 1) * 3 + position, RegionID: region, ...rates(position, region, false, kind === 'billing'), EffectiveDate: '2026-01-01' })
        versions.push({ [key]: id, EffectiveDate: '2026-09-08', ...rates(position, region, true, kind === 'billing'), Reason: 'Synthetic dated rate test' })
      }
      await insert(db, kind + '_rate', rows); await insert(db, kind + '_rate_version', versions)
    }
    await insert(db, 'site', millionSites.map(s => ({ SiteID: s.id, ClientID: s.client, RegionID: s.region, SiteName: `MILLION Site ${pad(s.id)}`, SiteAccountID: s.client })))
    await insert(db, 'site_agency', millionSites.map(s => ({ SiteID: s.id, AgencyID: s.agency, SiteAccountID: s.client })))
    await insert(db, 'site_policy', millionSites.map(s => ({ SiteID: s.id, AutoWDOEnabled: 0, ComputeHoliday: 0, AutoBreakEnabled: 0 })))
    await insert(db, 'site_rate', millionSites.flatMap(s => [1, 2, 3].map(p => ({ SiteRateID: (s.id - 1) * 3 + p, SiteID: s.id, PayrollRateID: rateId(s.agency, p, s.region), BillingRateID: rateId(s.agency, p, s.region) }))))
    await insert(db, 'shift_code', [1, 2, 3, 4].map(id => ({ ShiftCodeID: id, AgencyID: id, ShiftCode: 'SCALE0800-1600', ShiftName: 'Synthetic eight-hour shift', TimeIn: '08:00', TimeOut: '16:00' })))
    await insert(db, 'deduction_loan_classification', ['Loan', 'Deduction', 'Recurring Deduction', 'Contribution'].map((kind, i) => ({ ClassificationID: i + 1, ClassificationName: 'MILLION ' + kind, AppliesTo: kind })))
    await insert(db, 'loan_type', [{ LoanTypeID: 1, LoanName: 'MILLION Loan', ClassificationID: 1 }])
    await insert(db, 'deduction_type', [2, 3, 4].map(id => ({ DeductionTypeID: id, ClassificationID: id, DeductionName: 'MILLION Deduction ' + id, DeductionCategory: id === 4 ? 'Government' : 'Company' })))
    await insert(db, 'agency_contribution_plan', Array.from({ length: 12 }, (_, i) => ({ AgencyID: Math.floor(i / 3) + 1, AgencyPositionID: i + 1, DeductionTypeID: 4, AmountPerCutoff: 75, DeductOn: 'Both', EffectiveStartDate: '2026-01-01', CreatedBy: 1 })))
    await insert(db, 'attendance_dtr', millionSites.map(s => ({ BatchID: s.id, AgencyID: s.agency, ClientID: s.client, SiteID: s.id, PeriodStart: millionPeriod.start, PeriodEnd: millionPeriod.end, CreatedBy: 1 })))
    await db.commit()
   } catch (error) { await db.rollback(); throw error }
  }
  const daysSql = Array.from({ length: 15 }, (_, i) => `SELECT ${i + 1} AS n`).join(' UNION ALL ')
  const resource = { datadir: variables.dataDirectory }
  for (let offset = offsetStart; offset < 1_000_000; offset += 1000) {
    resourceCheck(resource.datadir)
    const employees = Array.from({ length: 1000 }, (_, i) => {
      const id = offset + i + 1, site = millionSites[Math.floor((id - 1) / 2000)], position = (id - 1) % 3 + 1
      return { id, site, position }
    })
    await db.beginTransaction()
    try {
      await insert(db, 'employee', employees.map(e => ({ EmployeeID: e.id, AgencyPositionID: (e.site.agency - 1) * 3 + e.position,
        EmployeeNumber: `MILLION-${pad(e.id)}`, FirstName: 'SYNTHETIC', LastName: `WORKER ${pad(e.id)}`, DateHired: '2026-01-01', CreatedBy: 1 })))
      await insert(db, 'employee_deployment', employees.map(e => ({ DeploymentID: e.id, EmployeeID: e.id, SiteRateID: (e.site.id - 1) * 3 + e.position, SiteID: e.site.id, StartDate: '2026-01-01', CreatedBy: 1 })))
      await insert(db, 'attendance_dtr_employee', employees.map(e => ({ BatchID: e.site.id, EmployeeID: e.id, DeploymentID: e.id, IsPermanentSite: 1, DefaultShiftCodeID: e.site.agency, CreatedBy: 1 })))
      await insert(db, 'employee_loan', employees.filter(e => e.id % 3 === 0).map(e => ({ EmployeeID: e.id, LoanTypeID: 1, AccountReference: `MILLIONL${e.id}`, LoanAmount: 6000, RemainingBalance: 6000, MonthlyDeduction: 500, ReleaseDate: '2026-08-01', RepaymentStartDate: '2026-09-01', RepaymentCutoff: 'Both', IsPaused: e.id % 30 === 0 ? 1 : 0, PauseStartDate: e.id % 30 === 0 ? '2026-09-01' : null })))
      await insert(db, 'employee_deduction', employees.filter(e => e.id % 4 === 0).map(e => ({ EmployeeID: e.id, DeductionTypeID: 2, AccountReference: `MILLIOND${e.id}`, Amount: 1000, RemainingBalance: 1000, InstallmentAmount: 125, IssuanceDate: '2026-08-01', RepaymentStartDate: '2026-09-01', RepaymentCutoff: 'Both' })))
      await insert(db, 'employee_recurring_deduction', employees.filter(e => e.id % 5 === 0).map(e => ({ EmployeeID: e.id, DeductionTypeID: 3, AmountPerCutoff: 50, DeductOn: 'Both', EffectiveStartDate: '2026-01-01' })))
      await db.execute(`INSERT INTO attendance(EmployeeID,DeploymentID,BatchID,ShiftCodeID,AttendanceDate,AttendanceStatus,
          RegularHours,OTHours,NightDiffHours,RestDayHours,LateHours,UndertimeHours,CreatedBy)
        SELECT e.EmployeeID,e.EmployeeID,de.BatchID,de.DefaultShiftCodeID,DATE_ADD('2026-09-01',INTERVAL day.n-1 DAY),
          CASE WHEN day.n=4 AND MOD(e.EmployeeID,11)=0 THEN 'Absent' WHEN day.n=9 AND MOD(e.EmployeeID,23)=0 THEN 'On-Leave'
          WHEN day.n=7 AND MOD(e.EmployeeID,19)=0 THEN 'Rest Day' ELSE 'Present' END,
          IF((day.n=4 AND MOD(e.EmployeeID,11)=0) OR (day.n=9 AND MOD(e.EmployeeID,23)=0) OR (day.n=7 AND MOD(e.EmployeeID,19)=0),0,8),
          IF(day.n=2,2,0),IF(day.n=6 AND MOD(e.EmployeeID,17)=0,4,0),IF(day.n=7 AND MOD(e.EmployeeID,19)=0,8,0),
          IF(day.n=3 AND MOD(e.EmployeeID,5)=0,0.25,0),IF(day.n=5 AND MOD(e.EmployeeID,13)=0,0.5,0),1
        FROM employee e JOIN attendance_dtr_employee de ON de.EmployeeID=e.EmployeeID
        CROSS JOIN (${daysSql}) day WHERE e.EmployeeID>? AND e.EmployeeID<=?`, [offset, offset + 1000])
      await db.execute(`INSERT INTO employee_portal_account(AccountID,EmployeeID,Email,ContactNumber,PasswordHash,AgreementVersion)
        SELECT EmployeeID,EmployeeID,CONCAT('worker',EmployeeID,'@million.example.invalid'),'00000000001','disabled-synthetic-login','million-test'
        FROM employee WHERE EmployeeID>? AND EmployeeID<=?`, [offset, offset + 1000])
      await db.execute(`INSERT INTO employee_portal_session(TokenHash,AccountID,ExpiresAt)
        SELECT SHA2(SHA2(CONCAT(?,':',EmployeeID),256),256),EmployeeID,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 7 DAY)
        FROM employee WHERE EmployeeID>? AND EmployeeID<=?`, [portalSeed, offset, offset + 1000])
      await db.commit()
    } catch (error) { await db.rollback(); throw error }
    if ((offset + 1000) % 10000 === 0) {
      if (options.folder) await writeFile(path.join(options.folder, 'seed-state.json'), JSON.stringify({ profile: 'million', portalSeed, completedEmployees: offset + 1000, finished: offset + 1000 === 1_000_000 }))
      console.log(`Seeded ${offset + 1000}/1000000 employees and ${(offset + 1000) * 15} attendance rows; free memory ${Math.round(os.freemem()/2**20)} MiB`)
    }
  }
  return { profile: 'million', employees: 1_000_000, agencies: 4, sites: 500, clients: 150,
    attendance: 15_000_000, periods: [millionPeriod], portalAccounts: 1_000_000, portalSeed }
}
