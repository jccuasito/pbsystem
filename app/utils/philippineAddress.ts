export const addressFields = ['UnitHouseNumber','Street','Subdivision','Region','Province','CityMunicipality','Barangay','PostalCode'] as const
export type AddressField = typeof addressFields[number]
export type EmployeeAddress = Record<AddressField, string>
export type AddressOption = { code: string; name: string }

export function addressFromEmployee(person: Record<string, any>, prefix: 'Permanent' | 'Present'): EmployeeAddress {
  return Object.fromEntries(addressFields.map(field => [field, String(person[`${prefix}${field}`] ?? '')])) as EmployeeAddress
}
export function addressToEmployee(address: EmployeeAddress, prefix: 'Permanent' | 'Present') {
  return Object.fromEntries(addressFields.map(field => [`${prefix}${field}`, address[field]]))
}
function normalized(value: string) { return value.trim().toLocaleLowerCase().replace(/^city of /,'').replace(/ city$/,'').replace(/\s+/g,' ') }
export function findAddressOption(options: AddressOption[], name: string, level = '') {
  const value = normalized(name)
  if (!value) return options.find(option => option.code.startsWith('none:'))
  const exact = options.find(option => normalized(option.name) === value)
  if (exact) return exact
  if (level === 'Region') return options.find(option => {
    const full=normalized(option.name)
    return full.replace(/\s*\(.*\)$/,'') === value || full.match(/\(([^)]+)\)$/)?.[1] === value
  })
  if (level === 'Province' && ['metro manila','ncr'].includes(value)) return options.find(option=>option.code==='none:1300000000')
  return undefined
}
const optionRequests = new Map<string, Promise<AddressOption[]>>()
export function loadAddressOptions(level: string, parent = '') {
  const key = `${level}:${parent}`
  if (!optionRequests.has(key)) {
    const request = $fetch<{items:AddressOption[]}>('/api/employees/address-options', { query: { level, ...(parent ? { parent } : {}) }, timeout: 15000, retry: 0 })
      .then(response=>response.items).catch(error=>{ optionRequests.delete(key); throw error })
    optionRequests.set(key, request)
  }
  return optionRequests.get(key)!
}
