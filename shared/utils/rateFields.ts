// Stored/API fields retain legacy deduction values for compatibility.
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

// Payroll will deduct missed time using the applicable regular/OT rate.
export const rateFormFields = rateMoneyFields.filter(field => field.key !== 'LateDeduction' && field.key !== 'UndertimeDeduction')
export const emptyRateAmounts = () => Object.fromEntries(rateFormFields.map(({ key }) => [key, 0]))
