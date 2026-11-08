import { payrollHourComponents } from './payrollPreview'
import { defaultBillingSettings, normalizeBillingDraft } from './billingDraft'
import type { BillingLine, BillingSettings } from './billingDraft'

export const billingComponents = [
  ...payrollHourComponents.map(([code, rateField, label]) => ({ code, rateField, label, credit: false })),
  { code: 'LateHours', rateField: 'LateDeduction', label: 'Late', credit: true },
  { code: 'UndertimeHours', rateField: 'UndertimeDeduction', label: 'Undertime', credit: true },
  { code: 'BreakHours', rateField: 'BreakDeduction', label: 'Break', credit: true },
] as const

export type BillingRule = { code: string; enabled: boolean; label: string; unit: 'hour' | 'day' | 'item'; divisor: number; rateMode: 'linked' | 'fixed'; rate: number }
export type BillingProfile = {
  mode: 'site' | 'client'; layout: 'summary' | 'position' | 'site'; title: string;
  rules: BillingRule[]; settings: BillingSettings; notes: string; hoursPerDay: number
}
export function defaultBillingProfile(): BillingProfile {
  return { mode: 'site', layout: 'summary', title: 'Billing statement', notes: '', hoursPerDay: 8, settings: defaultBillingSettings(),
    rules: billingComponents.map(item => ({ code: item.code, enabled: false, label: item.label, unit: 'hour', divisor: 1, rateMode: 'linked', rate: 0 })) }
}
export function normalizeBillingProfile(value: any): BillingProfile {
  if (!value || !['site', 'client'].includes(value.mode) || !['summary', 'position', 'site'].includes(value.layout)) throw Error('Choose billing scope and line grouping.')
  const title = String(value.title || '').trim(), notes = String(value.notes || '').trim()
  if (!title || title.length > 100 || notes.length > 1000) throw Error('Enter a title up to 100 characters and notes up to 1,000 characters.')
  if (!Array.isArray(value.rules) || value.rules.length !== billingComponents.length) throw Error('Billing component settings are incomplete.')
  const seen = new Set<string>()
  const rules = value.rules.map((rule: any): BillingRule => {
    const code = String(rule.code), label = String(rule.label || '').trim()
    if (!billingComponents.some(item => item.code === code) || seen.has(code)) throw Error('Invalid or duplicate billing component.')
    seen.add(code)
    if (typeof rule.enabled !== 'boolean' || !label || label.length > 100 || !['hour', 'day', 'item'].includes(rule.unit) || !['linked', 'fixed'].includes(rule.rateMode)) throw Error('Check the billing component labels and units.')
    const divisor = Number(rule.divisor), rate = Number(rule.rate)
    if (!Number.isFinite(divisor) || divisor <= 0 || divisor > 744 || !Number.isFinite(rate) || rate < 0 || rate > 999999.99 || Math.abs(rate * 100 - Math.round(rate * 100)) > 0.00001) throw Error('Enter a valid hours-per-unit value and a rate with up to two decimals.')
    if (rule.unit === 'hour' && divisor !== 1) throw Error('Hours must use one hour per unit.')
    return { code, enabled: rule.enabled, label, unit: rule.unit, divisor, rateMode: rule.rateMode, rate }
  })
  if (!rules.some((rule: BillingRule) => rule.enabled && !billingComponents.find(item => item.code === rule.code)?.credit)) throw Error('Enable at least one service charge for this client.')
  const hoursPerDay = Number(value.hoursPerDay)
  if (!Number.isFinite(hoursPerDay) || hoursPerDay <= 0 || hoursPerDay > 24) throw Error('Enter the contract hours per billing day, up to 24.')
  const { settings } = normalizeBillingDraft([{ id: 'validation', description: 'Validation', quantity: 0, rate: 0, unit: 'item', direction: 'Charge', category: 'Service' }], value.settings)
  return { mode: value.mode, layout: value.layout, title, notes, hoursPerDay, rules, settings: { ...settings, retirementQuantity: 0, uniformQuantity: 0 } }
}

// Only the frozen finalized-payroll component quantities enter this calculation.
// Payroll money, employee deductions, allowances and manual payroll corrections do not.
export function profileBillingLines(people: any[], profile: BillingProfile): BillingLine[] {
  const lines = new Map<string, { line: BillingLine; divisor: number }>()
  for (const person of people) for (const rule of profile.rules) {
    if (!rule.enabled) continue
    const definition = billingComponents.find(item => item.code === rule.code)!
    const hours = (person.components || []).filter((item: any) => item.code === rule.code).reduce((sum: number, item: any) => sum + Number(item.hours || 0), 0)
    if (!Number.isFinite(hours) || hours < 0) throw Error('The finalized payroll has an invalid component quantity.')
    if (!hours) continue
    const linkedRate = Number(person.billingRate?.[definition.rateField] || 0)
    const rate = rule.rateMode === 'fixed' ? rule.rate : Math.round(linkedRate * rule.divisor * 100) / 100
    if (!Number.isFinite(rate) || rate < 0 || rate > 999999.99) throw Error('A billing unit price is outside the supported range.')
    const suffix = profile.layout === 'site' ? person.SiteName : profile.layout === 'position' ? person.PositionName : ''
    const group = profile.layout === 'site' ? person.SiteID || person.SiteName : suffix || ''
    const key = JSON.stringify([rule.code, rate, group])
    const line: BillingLine = lines.get(key)?.line || { id: `source-${lines.size + 1}`, description: `${rule.label}${suffix ? ` - ${suffix}` : ''}`.slice(0, 140), quantity: 0, unit: rule.unit, rate, direction: definition.credit ? 'Credit' : 'Charge', category: 'Service' }
    // Accumulate hours before conversion so per-person division does not compound rounding.
    line.quantity += hours
    lines.set(key, { line, divisor: rule.divisor })
  }
  return [...lines.values()].map(({ line, divisor }) => ({ ...line, quantity: Math.round(line.quantity / divisor * 100) / 100 }))
}
