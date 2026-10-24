export const governmentIdTypes = ['PhilSys / National ID', 'SSS', 'PhilHealth', 'TIN', "Driver's License", 'Other'] as const
export type GovernmentIdType = typeof governmentIdTypes[number]
export const governmentAttachmentMaxBytes = 5 * 1024 * 1024

// Match the generated database keys in database/government-id-uniqueness.mjs.
export function governmentIdIdentity(typeValue: unknown, numberValue: unknown) {
  const type = governmentIdType(typeValue)
  const typeKey = (type === 'Other' ? String(typeValue || '').trim() : type).toLowerCase()
  const compact = String(numberValue || '').replace(/[ \t\r\n-]/g, '').toUpperCase()
  return { typeKey, numberKey: type === 'TIN' ? compact.slice(0, 9) : compact }
}

export function governmentIdType(value: unknown): GovernmentIdType {
  const type = String(value || '').trim().toLowerCase()
  if (['philsys / national id', 'philsys', 'national id', 'philid', 'pcn'].includes(type)) return 'PhilSys / National ID'
  if (type === 'sss') return 'SSS'
  if (type === 'philhealth') return 'PhilHealth'
  if (type === 'tin') return 'TIN'
  if (["driver's license", 'drivers license', 'driver’s license', 'driving license', 'lto'].includes(type)) return "Driver's License"
  return 'Other'
}

export function governmentIdRule(type: GovernmentIdType) {
  switch (type) {
    case 'PhilSys / National ID': return { placeholder: '1234567890123456', hint: 'Enter the 16-digit PCN printed on the ID, not the private 12-digit PSN.', lengths: [16], groups: [16] }
    case 'SSS': return { placeholder: '12-3456789-0', hint: '10 digits, displayed as 12-3456789-0.', lengths: [10], groups: [2, 7, 1] }
    case 'PhilHealth': return { placeholder: '12-345678901-2', hint: '12-digit PIN, displayed in the 2-9-1 format.', lengths: [12], groups: [2, 9, 1] }
    case 'TIN': return { placeholder: '123-456-789', hint: '9-digit TIN; an optional 3-5 digit branch code is also accepted.', lengths: [9, 12, 13, 14], groups: [3, 3, 3, 5] }
    case "Driver's License": return { placeholder: 'N01-23-123456', hint: 'Enter the license number printed on the card, such as N01-23-123456.', lengths: [11, 12], groups: [3, 2, 7] }
    default: return { placeholder: 'Enter the number as printed on the ID', hint: 'Letters, numbers and separators are accepted. No fixed mask.', lengths: [], groups: [] }
  }
}

export function formatGovernmentNumber(type: GovernmentIdType, value: unknown) {
  const raw = String(value ?? '')
  if (type === 'Other') return raw
  const digits = type === "Driver's License" ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '') : raw.replace(/\D/g, '')
  const groups = governmentIdRule(type).groups
  const parts: string[] = []
  let offset = 0
  for (const size of groups) {
    if (offset >= digits.length) break
    parts.push(digits.slice(offset, offset + size)); offset += size
  }
  // Keep overlong input visible so validation catches it rather than silently
  // discarding part of an identifier pasted from a document.
  if (offset < digits.length) parts.push(digits.slice(offset))
  return parts.join(type === 'PhilSys / National ID' ? '' : '-')
}

export function validateGovernmentId(typeValue: unknown, numberValue: unknown) {
  const name = String(typeValue || '').trim()
  const type = governmentIdType(name)
  const number = String(numberValue ?? '').trim()
  if (name.length < 2 || name.length > 80 || name.toLowerCase() === 'other') return 'Enter the government ID type or specify the name for Other.'
  if (!number || number.length > 50) return 'Enter an ID number of at most 50 characters.'
  if (type === 'Other') return ''
  if (type === "Driver's License") return /^[A-Z0-9]\d{10,11}$/.test(number.toUpperCase().replace(/[\s-]/g, '')) ? '' : governmentIdRule(type).hint
  if (!/^[\d\s-]+$/.test(number)) return 'This ID number accepts digits only, with optional spaces or dashes.'
  const digits = number.replace(/\D/g, '')
  if (!governmentIdRule(type).lengths.includes(digits.length)) return governmentIdRule(type).hint
  return ''
}
