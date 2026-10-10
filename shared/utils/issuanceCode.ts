export function issuanceCodePrefix(classificationName: string, itemName: string) {
  const initials = (name: string) => (name.toUpperCase().match(/[A-Z0-9]+/g) || [])
    .map(word => word[0]).join('')
  return `${initials(classificationName) || 'X'}-${initials(itemName) || 'X'}`
}

export function generatedIssuanceCode(classificationName: string, itemName: string, number: string) {
  return `${issuanceCodePrefix(classificationName, itemName)}-${number}`
}
