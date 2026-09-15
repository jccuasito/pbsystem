// Shared stored/API monetary fields for payroll and billing rates.
export const rateMoneyFields = [
  { key: 'RegularRate', label: 'Regular' },
  { key: 'OTRate', label: 'OT' },
  { key: 'OTExtRate', label: 'OT extension' },
  { key: 'NightDiffRate', label: 'Night diff' },
  { key: 'RestDayRate', label: 'WDO / Rest day' },
  { key: 'RestDayOTRate', label: 'WDO OT / Rest day OT' },
  { key: 'SpecialHolidayRate', label: 'Special holiday' },
  { key: 'LegalHolidayRate', label: 'Legal holiday' },
  { key: 'SpecialHolidayOTRate', label: 'Special holiday OT' },
  { key: 'LegalHolidayOTRate', label: 'Legal holiday OT' },
  { key: 'LateDeduction', label: 'Late deduction (₱ / hour)' },
  { key: 'UndertimeDeduction', label: 'Undertime deduction (₱ / hour)' },
  { key: 'BreakDeduction', label: 'Break deduction' },
  { key: 'Allowance', label: 'Allowance' },
] as const

// Forms and linked-rate previews expose every configurable rate.
export const rateFormFields = rateMoneyFields
export const emptyRateAmounts = () => Object.fromEntries(rateFormFields.map(({ key }) => [key, 0]))
