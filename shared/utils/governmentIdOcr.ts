import { formatGovernmentNumber, validateGovernmentId, type GovernmentIdType } from './governmentIds'

export function extractGovernmentId(textValue: unknown, hint?: GovernmentIdType | '') {
  const text = String(textValue || '').replace(/\r/g, '').toUpperCase()
  const signatures: Array<[GovernmentIdType, RegExp]> = [
    ['PhilSys / National ID', /PHILSYS|PHILIPPINE\s+IDENTIFICATION|PAMBANSANG\s+PAGKAKAKILANLAN|\bPCN\b/],
    ['SSS', /SOCIAL\s+SECURITY|\bSSS\b|\bSS\s+(?:NO|NUMBER)\b/],
    ['PhilHealth', /PHILHEALTH|PHILIPPINE\s+HEALTH\s+INSURANCE/],
    ['TIN', /BUREAU\s+OF\s+INTERNAL\s+REVENUE|TAXPAYER\s+IDENTIFICATION|\bTIN\b/],
    ["Driver's License", /DRIVER[’']?S?\s+LICEN[CS]E|LAND\s+TRANSPORTATION\s+OFFICE/],
  ]
  const detected = signatures.filter(([, pattern]) => pattern.test(text)).map(([type]) => type)
  if (detected.length > 1) return { type: null, number: null, needsReview: true, message: 'More than one ID type was found. Enter the details for the intended ID manually.' }
  const type = detected[0] || (hint && hint !== 'Other' ? hint : null)
  if (!type) return { type: null, number: null, needsReview: true, message: 'ID type could not be identified. Choose the type and enter its number manually.' }
  const patterns: Record<string, RegExp[]> = {
    'PhilSys / National ID': [/(?<!\d)(?:\d{4}[ -]){3}\d{4}(?!\d)/g, /(?<!\d)\d{16}(?!\d)/g],
    SSS: [/(?<!\d)\d{2}[ -]\d{7}[ -]\d(?!\d)/g],
    PhilHealth: [/(?<!\d)\d{2}[ -]\d{9}[ -]\d(?!\d)/g],
    TIN: [/(?<!\d)\d{3}[ -]\d{3}[ -]\d{3}(?:[ -]\d{3,5})?(?!\d)/g],
    "Driver's License": [/(?<![A-Z0-9])[A-Z0-9]\d{2}[ -]\d{2}[ -]\d{6,7}(?!\d)/g],
  }
  const labels: Record<string, RegExp> = {
    'PhilSys / National ID': /(?:PCN|CARD\s*(?:NO\.?|NUMBER))\s*[:.#-]?\s*(\d[\d -]{14,23}\d)/g,
    SSS: /(?:SSS?|SOCIAL\s+SECURITY)\s*(?:NUMBER|NO\.?)?\s*[:.#-]?\s*(\d[\d -]{8,13}\d)/g,
    PhilHealth: /(?:PIN|PHILHEALTH\s*(?:NUMBER|NO\.?))\s*[:.#-]?\s*(\d[\d -]{10,15}\d)/g,
    TIN: /(?:TIN|TAXPAYER\s+IDENTIFICATION\s*(?:NUMBER|NO\.?))\s*[:.#-]?\s*(\d[\d -]{7,18}\d)/g,
    "Driver's License": /(?:LICEN[CS]E\s*(?:NUMBER|NO\.?)|DL\s*(?:NUMBER|NO\.?))\s*[:.#-]?\s*([A-Z0-9][\d -]{10,15})/g,
  }
  const valid = (values: string[]) => [...new Set(values.map(value => formatGovernmentNumber(type, value.trim())).filter(value => !validateGovernmentId(type, value)))]
  const labelled = valid(Array.from(text.matchAll(labels[type])).map(match => match[1]))
  const candidates = labelled.length ? labelled : valid((patterns[type] || []).flatMap(pattern => Array.from(text.matchAll(pattern)).map(match => match[0])))
  if (candidates.length !== 1) return { type, number: null, needsReview: true, message: candidates.length ? 'Several possible ID numbers were found. Enter the correct number manually.' : 'No clear ID number was found. Enter it manually or upload a clearer scan.' }
  return { type, number: candidates[0], needsReview: true, message: 'ID details were read from the scan. Review the type and number before saving.' }
}
