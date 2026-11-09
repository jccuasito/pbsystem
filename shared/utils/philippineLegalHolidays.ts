export type LegalHolidayDefault = { key: string; HolidayName: string; HolidayDate: string; HolidayType: 'Legal'; Recurring: number }

// Annual Legal/regular holidays only. Special holidays keep their existing site policy.
// Sources: Proclamations 1006 (2026), 1427 (2027), 1189 and 1264 (2026 Eid dates).
export const legalHolidayYears = [2026, 2027]
export const legalHolidaySources: Record<number, string> = {
  2026: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/7/99678',
  2027: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/7/102791',
}
const fixed = [
  ['new-year', "New Year's Day", '01-01'], ['kagitingan', 'Araw ng Kagitingan', '04-09'],
  ['labor', 'Labor Day', '05-01'], ['independence', 'Independence Day', '06-12'],
  ['bonifacio', 'Bonifacio Day', '11-30'], ['christmas', 'Christmas Day', '12-25'], ['rizal', 'Rizal Day', '12-30'],
] as const
const annual: Record<number, Array<[string, string, string]>> = {
  2026: [['maundy-thursday', 'Maundy Thursday', '04-02'], ['good-friday', 'Good Friday', '04-03'], ['heroes', 'National Heroes Day', '08-31'], ['eid-fitr', "Eid'l Fitr", '03-20'], ['eid-adha', "Eid'l Adha", '05-27']],
  2027: [['maundy-thursday', 'Maundy Thursday', '03-25'], ['good-friday', 'Good Friday', '03-26'], ['heroes', 'National Heroes Day', '08-30']],
}

export function legalHolidayDefaults(year: number): LegalHolidayDefault[] {
  if (!annual[year]) return []
  return [
    ...fixed.map(([key, name, day]) => ({ key, HolidayName: name, HolidayDate: `${year}-${day}`, HolidayType: 'Legal' as const, Recurring: 1 })),
    ...annual[year]!.map(([key, name, day]) => ({ key, HolidayName: name, HolidayDate: `${year}-${day}`, HolidayType: 'Legal' as const, Recurring: 0 })),
  ].sort((a, b) => a.HolidayDate.localeCompare(b.HolidayDate))
}

export function legalHolidayKey(name: unknown) {
  const normalize = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const normalized = normalize(name)
  if (normalized === 'heroesday') return 'heroes'
  if (['eidulfitr', 'eidalfitr'].includes(normalized)) return 'eid-fitr'
  if (['eiduladha', 'eidaladha'].includes(normalized)) return 'eid-adha'
  return [...fixed, ...Object.values(annual).flat()].find(row => normalize(row[1]) === normalized)?.[0] || null
}

export function holidayDisplayDate(value: unknown, recurring: unknown, year?: number) {
  const original = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10)
  const candidate = Number(recurring) === 1 && year ? `${year}-${original.slice(5)}` : original
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return ''
  const parsed = new Date(`${candidate}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : ''
}

export function holidayWeekday(date: string) {
  return date ? new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)) : ''
}
