import { legalHolidayDefaults, legalHolidayKey, holidayDisplayDate } from '../../shared/utils/philippineLegalHolidays.ts'

/** Populate the same holiday table used by the existing CRUD and DTR queries. */
export async function seedLegalHolidayDefaults(connection: any, years: number[]) {
  let locked = false, added = 0, correctedRecurrence = 0
  try {
    const [[lock]] = await connection.execute("SELECT GET_LOCK('pbsystem:legal-holiday-defaults', 10) AS acquired")
    if (Number(lock?.acquired) !== 1) throw new Error('Legal holiday defaults are being prepared by another process.')
    locked = true
    await connection.beginTransaction()
    const [rows] = await connection.execute("SELECT HolidayID, HolidayName, DATE_FORMAT(HolidayDate, '%Y-%m-%d') AS HolidayDate, Recurring, Status FROM holiday WHERE HolidayType = 'Legal' FOR UPDATE")
    for (const year of [...new Set(years)].sort()) {
      for (const holiday of legalHolidayDefaults(year)) {
        // Movable national holidays must use dated rows, otherwise the existing
        // month/day recurrence would also mark the old date in the following year.
        if (!holiday.Recurring) {
          for (const row of rows.filter((row: any) => Number(row.Recurring) === 1 && legalHolidayKey(row.HolidayName) === holiday.key)) {
            await connection.execute('UPDATE holiday SET Recurring = 0 WHERE HolidayID = ?', [row.HolidayID])
            row.Recurring = 0
            correctedRecurrence++
          }
        }
        // Respect names/dates edited by a user and inactive records. Do not reset
        // status or rates. Fixed recurring holidays require only one stored row.
        const existing = rows.find((row: any) => {
          const sameName = legalHolidayKey(row.HolidayName) === holiday.key
          const sameYear = String(row.HolidayDate).slice(0, 4) === String(year)
          return (sameName && (Number(row.Recurring) === 1 || sameYear))
            || holidayDisplayDate(row.HolidayDate, row.Recurring, year) === holiday.HolidayDate
        })
        if (existing) continue
        const [result] = await connection.execute("INSERT INTO holiday (HolidayName, HolidayDate, HolidayType, Recurring, Status, CreatedBy) VALUES (?, ?, 'Legal', ?, 'Active', NULL)", [holiday.HolidayName, holiday.HolidayDate, holiday.Recurring])
        rows.push({ ...holiday, HolidayID: result.insertId, Status: 'Active' })
        added++
      }
    }
    await connection.commit()
    return { added, correctedRecurrence }
  } catch (error) { await connection.rollback(); throw error }
  finally { if (locked) await connection.execute("SELECT RELEASE_LOCK('pbsystem:legal-holiday-defaults')").catch(() => undefined) }
}
