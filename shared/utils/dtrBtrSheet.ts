export type BtrSheetRow = {
  BTRID?: number
  Revision?: number
  RelieverEmployeeID: string
  ReplacedEmployeeID: string
  AttendanceDate: string
  Hours: number | string
}
export const btrSheetHeaders = ['BTR EMPLOYEE ID','BTR EMPLOYEE NAME','DATE','HOURS','REST EMPLOYEE ID','REST EMPLOYEE NAME']
const text = (value: unknown) => String(value ?? '').trim()
const header = (value: unknown) => text(value).toUpperCase().replace(/[^A-Z0-9]/g,'')
export function btrSheetDate(value: unknown, decodeSerial: (value:number)=>string): string {
  if (typeof value === 'number') return decodeSerial(value)
  if (value instanceof Date) return value.getFullYear()+'-'+String(value.getMonth()+1).padStart(2,'0')+'-'+String(value.getDate()).padStart(2,'0')
  const raw = text(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw)
  if (us) return us[3]+'-'+us[1]!.padStart(2,'0')+'-'+us[2]!.padStart(2,'0')
  const named = /^(\d{1,2})[- ]([a-z]{3})[- ](\d{2}|\d{4})$/i.exec(raw)
  if (named) {
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[2]!.toLowerCase())+1
    const year = named[3]!.length===2 ? (Number(named[3])<30?'20':'19')+named[3] : named[3]
    if (month) return year+'-'+String(month).padStart(2,'0')+'-'+named[1]!.padStart(2,'0')
  }
  return raw // Invalid/ambiguous dates remain visible for correction before save.
}
export function parseBtrSheet(rows: unknown[][], decodeSerial: (value:number)=>string): BtrSheetRow[] {
  const columns = (rows[0]||[]).map(header)
  const find = (names:string[]) => columns.findIndex(value=>names.includes(value))
  const btr = find(['BTREMPLOYEEID','BTREMPLOYEENO','BTREMPLOYEENUMBER'])
  const rest = find(['RESTEMPLOYEEID','RESTEMPLOYEENO','RESTEMPLOYEENUMBER'])
  const date = find(['DATE','ATTENDANCEDATE']), hours = find(['HOURS','BTRHOURS'])
  if ([btr,rest,date,hours].some(index=>index<0)) throw new Error('Required columns: BTR EMPLOYEE ID (or NO), DATE, HOURS, REST EMPLOYEE ID (or NO).')
  const result = rows.slice(1).filter(row=>row.some(value=>text(value)!=='')).map(row=>({
    RelieverEmployeeID:text(row[btr]), ReplacedEmployeeID:text(row[rest]),
    AttendanceDate:btrSheetDate(row[date],decodeSerial), Hours:text(row[hours])
  }))
  if (!result.length) throw new Error('The first worksheet has no BTR rows.')
  if (result.length>1000) throw new Error('Import up to 1,000 BTR rows at a time.')
  return result
}
