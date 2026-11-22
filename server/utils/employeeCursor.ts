import { createError } from 'h3'
const fields = {
  employee: ['LastName', 'FirstName', 'EmployeeNumber', 'EmployeeID'],
  account: ['LastName', 'FirstName', 'MiddleName', 'EmployeeID'],
} as const
type Kind = keyof typeof fields
export function employeeCursor(row: Record<string, any> | undefined, kind: Kind) {
  return row ? Buffer.from(JSON.stringify({ kind, values: fields[kind].map(field => row[field] ?? null) })).toString('base64url') : null
}
/** Lexicographic continuation using the existing nullable sort fields and ID
 * tiebreaker. Values are parameters; column names come only from this map. */
export function employeeAfter(value: unknown, kind: Kind, params: any[]) {
  if (value === undefined || value === '') return ''
  let cursor: any
  try {
    if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error()
    cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (cursor?.kind !== kind || !Array.isArray(cursor.values) || cursor.values.length !== 4
      || cursor.values.slice(0, 3).some((v: unknown) => v !== null && (typeof v !== 'string' || v.length > 190))
      || !Number.isSafeInteger(cursor.values[3]) || cursor.values[3] < 1) throw Error()
  } catch { throw createError({ statusCode: 400, statusMessage: 'Reload the employee list before loading more records.' }) }
  // Keep one leading-key range instead of independent OR ranges. MariaDB can
  // otherwise choose an index-merge sort across hundreds of thousands of rows.
  const bound=cursor.values[0]===null?'':(params.push(cursor.values[0]),`e.${fields[kind][0]}>=? AND `)
  const columns:string[]=[],values:string[]=[]
  fields[kind].forEach((field,i)=>{
    if(i<3){columns.push(`(e.${field} IS NOT NULL)`,`COALESCE(e.${field},'')`);values.push('?','?');params.push(cursor.values[i]===null?0:1,cursor.values[i]??'')}
    else{columns.push(`e.${field}`);values.push('?');params.push(cursor.values[i])}
  })
  return '('+bound+'('+columns.join(',')+')>('+values.join(',')+'))'
}
