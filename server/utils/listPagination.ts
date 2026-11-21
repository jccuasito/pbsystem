import { createError } from 'h3'

type Query = Record<string, any>
export function listPage(query: Query) {
  if (query.page === undefined) return null // Existing lookup/export callers keep their full response.
  const page = Number(query.page), pageSize = Number(query.pageSize ?? 25)
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw createError({ statusCode: 400, statusMessage: 'Use a positive page and a page size from 1 to 100.' })
  }
  return { page, pageSize }
}

export function pagination(total: number, request: { page: number; pageSize: number }) {
  const pages = Math.max(1, Math.ceil(total / request.pageSize))
  return { page: Math.min(request.page, pages), pageSize: request.pageSize, total, pages }
}

/** SQL identifiers/expressions come only from fixed resource definitions. */
export function listSearch(value: unknown, expressions: string[], params: unknown[]) {
  if (value === undefined || value === '') return []
  if (typeof value !== 'string' || value.length > 200) throw createError({ statusCode: 400, statusMessage: 'Search must be at most 200 characters.' })
  return value.trim().split(/\s+/).filter(Boolean).map(word => {
    const term = '%' + word.replace(/[=%_]/g, character => '=' + character) + '%'
    params.push(...expressions.map(() => term))
    return '(' + expressions.map(expression => `${expression} LIKE ? ESCAPE '='`).join(' OR ') + ')'
  })
}

export function listId(value: unknown, label: string) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) throw createError({ statusCode: 400, statusMessage: `${label} must be a valid ID.` })
  return id
}

/** The configured SELECT must end in an ORDER BY with a unique ID tiebreaker. */
export async function selectListPage(db: any, sql: string, query: Query, conditions: string[] = [], params: unknown[] = []) {
  const request = listPage(query)!
  const index = sql.lastIndexOf(' ORDER BY ')
  if (index < 0) throw new Error('A list query needs deterministic ordering.')
  const from = `FROM (${sql.slice(0, index)}) listed${conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''}`
  const [[count]] = await db.execute(`SELECT COUNT(*) AS Total ${from}`, params)
  const meta = pagination(Number(count.Total), request)
  const [items] = await db.execute(`SELECT listed.* ${from}${sql.slice(index)} LIMIT ? OFFSET ?`, [...params, meta.pageSize, (meta.page - 1) * meta.pageSize])
  return { items, pagination: meta }
}
