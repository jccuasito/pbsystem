import { createError, getQuery } from 'h3'
import { requireSession } from './auth'
import snapshot from '../assets/addresses/philippines.json'

export function addressChoices(level: string, parent = '') {
  let rows: Array<{ code: string; name: string }> = []
  if (level === 'regions') rows = snapshot.regions
  else if (level === 'provinces') {
    if (!snapshot.regions.some(row => row.code === parent)) throw createError({ statusCode: 400, statusMessage: 'Choose a valid region.' })
    rows = snapshot.provinces.filter(row => row.region === parent)
    if (snapshot.cities.some(row => row.region === parent && row.province === null)) rows = [...rows, { code: `none:${parent}`, name: parent === '1300000000' ? 'No province / NCR' : 'Independent cities / no province' }]
  } else if (level === 'cities') {
    if (parent.startsWith('none:')) {
      const region = parent.slice(5)
      if (!snapshot.regions.some(row => row.code === region)) throw createError({ statusCode: 400, statusMessage: 'Choose a valid region.' })
      rows = snapshot.cities.filter(row => row.region === region && row.province === null)
    } else {
      if (!snapshot.provinces.some(row => row.code === parent)) throw createError({ statusCode: 400, statusMessage: 'Choose a valid province or no-province group.' })
      rows = snapshot.cities.filter(row => row.province === parent)
    }
  } else if (level === 'barangays') {
    if (!snapshot.cities.some(row => row.code === parent)) throw createError({ statusCode: 400, statusMessage: 'Choose a valid city or municipality.' })
    rows = snapshot.barangays.filter(row => row.city === parent)
  } else throw createError({ statusCode: 400, statusMessage: 'Choose regions, provinces, cities, or barangays.' })
  return rows.map(row => ({ code: row.code, name: row.name })).sort((a,b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
}

export async function listAddressOptions(event: any) {
  const session = requireSession(event)
  void session.sub
  const query = getQuery(event)
  if (Array.isArray(query.level) || Array.isArray(query.parent)) throw createError({ statusCode: 400, statusMessage: 'Choose a single address level and parent.' })
  const level = String(query.level || 'regions'), parent = String(query.parent || '')
  if (parent && !/^(?:none:)?\d{10}$/.test(parent)) throw createError({ statusCode: 400, statusMessage: 'Invalid address reference.' })
  return { items: addressChoices(level, parent), source: 'PSGC reference snapshot', revision: snapshot.revision }
}
