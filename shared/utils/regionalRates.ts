import { rateMoneyFields } from './rateFields'
export const regionalAmountKeys = rateMoneyFields.map(field => field.key)
export function rateDate(value: any): string { return value && typeof value.toISOString === 'function' ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10) }
export function regionalAtDate(base: any, versions: any[] = [], date: string) {
  if (!base || (rateDate(base.EffectiveDate) && rateDate(base.EffectiveDate) > date)) return null
  return [...versions].filter(version => rateDate(version.EffectiveDate) <= date).sort((a,b) => rateDate(a.EffectiveDate).localeCompare(rateDate(b.EffectiveDate))).at(-1) || base
}
export function regionalOverrides(value: any): Record<string, number> {
  if (typeof value === 'string') { try { value = JSON.parse(value) } catch { return {} } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(regionalAmountKeys.filter(key => Object.hasOwn(value, key) && value[key] !== null && value[key] !== '' && Number.isFinite(Number(value[key]))).map(key => [key, Number(value[key])]))
}
export function regionalAmounts(parent: any, overrides: any = {}) { return Object.fromEntries(regionalAmountKeys.map(key => [key, Object.hasOwn(overrides, key) ? Number(overrides[key]) : Number(parent?.[key] || 0)])) }
export function inferRegionalOverrides(child: any, parent: any) { return Object.fromEntries(regionalAmountKeys.filter(key => Math.round(Number(child?.[key] || 0)*100) !== Math.round(Number(parent?.[key] || 0)*100)).map(key => [key, Number(child?.[key] || 0)])) }
