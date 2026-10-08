import { rateMoneyFields } from '../../shared/utils/rateFields'

export type VersionKind = 'payroll-rate' | 'billing-rate'
export const versionDefinitions = {
  'payroll-rate': { table: 'payroll_rate', versionTable: 'payroll_rate_version', id: 'PayrollRateID', versionId: 'PayrollRateVersionID' },
  'billing-rate': { table: 'billing_rate', versionTable: 'billing_rate_version', id: 'BillingRateID', versionId: 'BillingRateVersionID' },
} as const

export const rateAmountKeys = rateMoneyFields.map(field => field.key)

export function dateOnly(value: unknown) {
  if (value && typeof value === 'object' && 'toISOString' in value && typeof value.toISOString === 'function') return value.toISOString().slice(0, 10)
  return String(value || '').slice(0, 10)
}

export function todayInPhilippines() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function snapshotAtDate(base: any, versions: any[], date: string) {
  const applicable = versions.filter(version => dateOnly(version.EffectiveDate) <= date)
  return applicable.length ? applicable[applicable.length - 1] : base
}

export async function loadVersionMap(connection: any, kind: VersionKind, ids: number[]) {
  const map = new Map<number, any[]>()
  if (!ids.length) return map
  const { versionTable, id } = versionDefinitions[kind]
  const [rows] = await connection.execute<any[]>(`SELECT * FROM ${versionTable} WHERE ${id} IN (${ids.map(() => '?').join(', ')}) ORDER BY ${id}, EffectiveDate, ${versionDefinitions[kind].versionId}`, ids)
  for (const row of rows) {
    const rateId = Number(row[id])
    if (!map.has(rateId)) map.set(rateId, [])
    map.get(rateId)!.push(row)
  }
  return map
}

export function effectiveAmountSql(kind: VersionKind, alias: string, field: string, dateSql: string) {
  if (!rateAmountKeys.includes(field as typeof rateAmountKeys[number])) throw new Error('Invalid rate amount field.')
  const { versionTable, id } = versionDefinitions[kind]
  return `COALESCE((SELECT rv.${field} FROM ${versionTable} rv WHERE rv.${id} = ${alias}.${id} AND rv.EffectiveDate <= ${dateSql} ORDER BY rv.EffectiveDate DESC, rv.${versionDefinitions[kind].versionId} DESC LIMIT 1), ${alias}.${field})`
}
