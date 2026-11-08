export type BillingLine = {
  id: string
  description: string
  quantity: number
  unit: 'hour' | 'day' | 'item'
  rate: number
  direction: 'Charge' | 'Credit'
  category: 'Service' | 'Additional'
}

export type BillingSettings = {
  adminPercent: number
  adminBase: 'service' | 'serviceAndExtras'
  vatPercent: number
  vatBase: 'administrative' | 'beforeTax'
  withholdingPercent: number
  withholdingBase: 'administrative' | 'beforeTax'
  retirementQuantity: number
  retirementRate: number
  uniformQuantity: number
  uniformRate: number
}

export function defaultBillingSettings(workedDays = 0): BillingSettings {
  return { adminPercent: 0, adminBase: 'service', vatPercent: 0, vatBase: 'administrative',
    withholdingPercent: 0, withholdingBase: 'administrative', retirementQuantity: workedDays,
    retirementRate: 0, uniformQuantity: workedDays, uniformRate: 0 }
}

function amount(value: unknown, label: string, maximum = 999999.99) {
  const number = Number(value)
  if (!['number', 'string'].includes(typeof value) || value === '' || !Number.isFinite(number) || number < 0 || number > maximum) {
    throw new Error(`${label} must be between 0 and ${maximum}.`)
  }
  return Math.round(number * 100) / 100
}

export function normalizeBillingDraft(lines: unknown, settings: unknown) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 200) throw new Error('Enter between 1 and 200 billing lines.')
  const ids = new Set<string>()
  const normalizedLines: BillingLine[] = lines.map((line: any, index) => {
    const id = String(line?.id || '').trim(), description = String(line?.description || '').trim()
    if (!id || id.length > 100 || ids.has(id)) throw new Error(`Billing line ${index + 1} has an invalid identifier.`)
    ids.add(id)
    if (!description || description.length > 140) throw new Error(`Enter a description of up to 140 characters for line ${index + 1}.`)
    if (!['hour', 'day', 'item'].includes(line.unit) || !['Charge', 'Credit'].includes(line.direction) || !['Service', 'Additional'].includes(line.category)) {
      throw new Error(`Billing line ${index + 1} has an invalid unit or type.`)
    }
    const quantity = amount(line.quantity, `Line ${index + 1} quantity`), rate = amount(line.rate, `Line ${index + 1} rate`)
    if (quantity * rate > 99999999.99) throw new Error(`Billing line ${index + 1} exceeds the supported amount.`)
    return { id, description, quantity, unit: line.unit, rate, direction: line.direction, category: line.category }
  })
  const input = settings as Record<string, unknown>
  if (!input || typeof input !== 'object') throw new Error('Billing calculation settings are required.')
  if (!['service', 'serviceAndExtras'].includes(String(input.adminBase)) || !['administrative', 'beforeTax'].includes(String(input.vatBase)) || !['administrative', 'beforeTax'].includes(String(input.withholdingBase))) {
    throw new Error('Choose a valid calculation base for each percentage.')
  }
  const normalizedSettings: BillingSettings = {
    adminPercent: amount(input.adminPercent, 'Administrative cost percentage', 100), adminBase: input.adminBase as BillingSettings['adminBase'],
    vatPercent: amount(input.vatPercent, 'VAT percentage', 100), vatBase: input.vatBase as BillingSettings['vatBase'],
    withholdingPercent: amount(input.withholdingPercent, 'Withholding percentage', 100), withholdingBase: input.withholdingBase as BillingSettings['withholdingBase'],
    retirementQuantity: amount(input.retirementQuantity, 'Retirement quantity'), retirementRate: amount(input.retirementRate, 'Retirement rate'),
    uniformQuantity: amount(input.uniformQuantity, 'Uniform quantity'), uniformRate: amount(input.uniformRate, 'Uniform rate'),
  }
  if (normalizedSettings.retirementQuantity * normalizedSettings.retirementRate > 99999999.99 || normalizedSettings.uniformQuantity * normalizedSettings.uniformRate > 99999999.99) {
    throw new Error('Retirement or uniform charges exceed the supported amount.')
  }
  return { lines: normalizedLines, settings: normalizedSettings }
}

const cents = (value: number) => Math.round(value * 100)
export const billingLineAmount = (line: Pick<BillingLine, 'quantity' | 'rate' | 'direction'>) =>
  Math.round(Math.round(line.quantity * 100) * cents(line.rate) / 100) / 100 * (line.direction === 'Credit' ? -1 : 1)

// Draft contract arithmetic only. Percentage bases are explicit configuration,
// not a determination of the client's tax treatment or official invoice rules.
export function calculateBillingDraft(lines: BillingLine[], settings: BillingSettings) {
  const lineCents = (category: BillingLine['category']) => lines.filter(line => line.category === category).reduce((sum, line) => sum + cents(billingLineAmount(line)), 0)
  const service = lineCents('Service'), extras = lineCents('Additional')
  const retirement = Math.round(Math.round(settings.retirementQuantity * 100) * cents(settings.retirementRate) / 100)
  const uniform = Math.round(Math.round(settings.uniformQuantity * 100) * cents(settings.uniformRate) / 100)
  const administrativeBase = service + (settings.adminBase === 'serviceAndExtras' ? extras + retirement + uniform : 0)
  if (service < 0 || administrativeBase < 0) throw new Error('Credits cannot exceed the applicable service charges.')
  const administrative = Math.round(administrativeBase * settings.adminPercent / 100)
  const beforeTax = service + extras + retirement + uniform + administrative
  const vatableSales = settings.vatPercent > 0 ? (settings.vatBase === 'administrative' ? administrative : beforeTax) : 0
  const vat = Math.round(vatableSales * settings.vatPercent / 100)
  const withholdingBase = settings.withholdingBase === 'administrative' ? administrative : beforeTax
  const withholding = Math.round(withholdingBase * settings.withholdingPercent / 100)
  const gross = beforeTax + vat, totalDue = gross - withholding
  if (beforeTax < 0 || totalDue < 0 || gross > 9999999999.99 * 100) throw new Error('The billing total is outside the supported range.')
  return Object.fromEntries(Object.entries({ serviceSubtotal: service, additionalCharges: extras, retirement, uniform, administrativeBase,
    administrative, beforeTax, vatableSales, vatExemptSales: beforeTax - vatableSales, vat, gross, withholdingBase, withholding, totalDue }).map(([key, value]) => [key, value / 100])) as Record<'serviceSubtotal' | 'additionalCharges' | 'retirement' | 'uniform' | 'administrativeBase' | 'administrative' | 'beforeTax' | 'vatableSales' | 'vatExemptSales' | 'vat' | 'gross' | 'withholdingBase' | 'withholding' | 'totalDue', number>
}
