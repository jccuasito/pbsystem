import { listId, listPage, listSearch, selectListPage } from './listPagination'
import { dateOnly, loadVersionMap, snapshotAtDate, todayInPhilippines, effectiveAmountSql } from './rateVersions'
import { regionalAtDate, rateDate } from '../../shared/utils/regionalRates'

export async function rateSnapshots(db: any, kind: 'payroll-rate' | 'billing-rate', rows: any[]) {
  const id = kind === 'payroll-rate' ? 'PayrollRateID' : 'BillingRateID'
  const versions = await loadVersionMap(db, kind, rows.map(row => Number(row[id])))
  const today = todayInPhilippines()
  return rows.map(row => {
    const history = versions.get(Number(row[id])) || []
    return { ...row, Versions: history, CurrentRate: snapshotAtDate(row, history, today), NextEffectiveDate: dateOnly(history.find(version => dateOnly(version.EffectiveDate) > today)?.EffectiveDate) || null }
  })
}

export async function regionalParents(db: any, ids: number[]) {
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  const [[rows], [versions]] = await Promise.all([
    db.execute(`SELECT r.*,a.AgencyName,rg.RegionCode,rg.RegionName FROM payroll_region_rate r INNER JOIN agency a ON a.AgencyID=r.AgencyID LEFT JOIN region rg ON rg.RegionID=r.RegionID WHERE r.RegionRateID IN (${placeholders})`, ids),
    db.execute(`SELECT * FROM payroll_region_rate_version WHERE RegionRateID IN (${placeholders}) ORDER BY EffectiveDate,RegionRateVersionID`, ids),
  ])
  const today = todayInPhilippines()
  return rows.map((row: any) => {
    const history = versions.filter((version: any) => Number(version.RegionRateID) === Number(row.RegionRateID))
    return { ...row, Versions: history, CurrentRate: regionalAtDate(row, history, today), NextEffectiveDate: [row,...history].map(version => rateDate(version.EffectiveDate)).filter(day => day > today).sort()[0] || null }
  })
}

export async function pagedPositionRates(db: any, kind: 'payroll-rate' | 'billing-rate', sql: string, query: Record<string, any>) {
  const params: unknown[] = []
  const conditions = listSearch(query.search, ['listed.AgencyName','listed.PositionName','listed.RegionCode','listed.RegionName'], params)
  for (const [key, field] of [['agency','AgencyName'],['position','PositionName'],['status','Status'],['regionId','RegionID']] as const) {
    if (query[key]) { conditions.push(`listed.${field} = ?`); params.push(query[key]) }
  }
  if (query.groupAgencyId) { conditions.push('listed.AgencyID = ?'); params.push(listId(query.groupAgencyId, 'Agency')) }
  if (query.groupRegionId !== undefined) { conditions.push('listed.RegionID <=> ?'); params.push(query.groupRegionId === 'all' ? null : listId(query.groupRegionId, 'Region')) }
  const index = sql.lastIndexOf(' ORDER BY ')
  const order = sql.slice(index).replace(/\b(?:a|p|r)\./g, 'listed.')
  const result = await selectListPage(db,sql.slice(0,index)+order,query,conditions,params)
  return { ...result, items: await rateSnapshots(db,kind,result.items) }
}

/** Summaries contain no per-position arrays or version histories. Paging the
 * overview and a selected group's records are separate operations. */
export async function pagedRateGroups(db: any, kind: 'payroll-rate' | 'billing-rate', query: Record<string, any>) {
  listPage(query)
  const payroll = kind === 'payroll-rate', table = payroll ? 'payroll_rate' : 'billing_rate'
  const params: unknown[] = []
  const filters = listSearch(query.search,['a.AgencyName','p.PositionName','rg.RegionCode','rg.RegionName'],params)
  for (const [key, expression] of [['agency','a.AgencyName'],['position','p.PositionName'],['status','r.Status'],['regionId','r.RegionID']] as const) {
    if (query[key]) {filters.push(`${expression} = ?`);params.push(query[key])}
  }
  // Billing summaries use the same effective version as the position detail.
  const regular = payroll ? 'r.RegularRate' : effectiveAmountSql('billing-rate','r','RegularRate',`'${todayInPhilippines()}'`)
  let sql = `SELECT ap.AgencyID,a.AgencyName,r.RegionID,rg.RegionCode,rg.RegionName,COUNT(DISTINCT r.AgencyPositionID) AS PositionCount,COUNT(*) AS RateCount,SUM(r.Status='Active') AS ActiveCount,MIN(${regular}) AS MinRate,MAX(${regular}) AS MaxRate,NULL AS RegionRateID
    FROM ${table} r INNER JOIN agency_position ap ON ap.AgencyPositionID=r.AgencyPositionID INNER JOIN agency a ON a.AgencyID=ap.AgencyID INNER JOIN \`position\` p ON p.PositionID=ap.PositionID LEFT JOIN region rg ON rg.RegionID=r.RegionID
    ${filters.length?'WHERE '+filters.join(' AND '):''} GROUP BY ap.AgencyID,a.AgencyName,r.RegionID,rg.RegionCode,rg.RegionName`
  if (payroll && !query.position) {
    const parentFilters = listSearch(query.search,['a.AgencyName','rg.RegionCode','rg.RegionName'],params)
    for (const [key,expression] of [['agency','a.AgencyName'],['status','r.Status'],['regionId','r.RegionID']] as const) {
      if(query[key]){parentFilters.push(`${expression} = ?`);params.push(query[key])}
    }
    sql += ` UNION ALL SELECT r.AgencyID,a.AgencyName,r.RegionID,rg.RegionCode,rg.RegionName,0,0,0,NULL,NULL,r.RegionRateID FROM payroll_region_rate r INNER JOIN agency a ON a.AgencyID=r.AgencyID LEFT JOIN region rg ON rg.RegionID=r.RegionID ${parentFilters.length?'WHERE '+parentFilters.join(' AND '):''}`
  }
  const grouped = `SELECT AgencyID,AgencyName,RegionID,RegionCode,RegionName,SUM(PositionCount) AS PositionCount,SUM(RateCount) AS RateCount,SUM(ActiveCount) AS ActiveCount,MIN(MinRate) AS MinRate,MAX(MaxRate) AS MaxRate,MAX(RegionRateID) AS RegionRateID FROM (${sql}) matched GROUP BY AgencyID,AgencyName,RegionID,RegionCode,RegionName ORDER BY AgencyName,CASE WHEN RegionCode='13' THEN 0 ELSE 1 END,RegionName,AgencyID,RegionID`
  const result = await selectListPage(db,grouped,query,[],params)
  // A filtered parent may be absent from the overview union; still retain its
  // base in a matched child group so Add/Edit inherit the correct amounts.
  if (payroll && result.items.length) {
    const scopes = result.items.map(() => '(AgencyID=? AND RegionID <=> ?)').join(' OR ')
    const [parents] = await db.execute(`SELECT RegionRateID,AgencyID,RegionID FROM payroll_region_rate WHERE ${scopes}`, result.items.flatMap((group: any) => [group.AgencyID,group.RegionID]))
    const fullParents = await regionalParents(db, parents.map((parent: any) => Number(parent.RegionRateID)))
    for (const group of result.items) group.parent = fullParents.find((parent: any) => Number(parent.AgencyID) === Number(group.AgencyID) && String(parent.RegionID??'') === String(group.RegionID??''))
  }
  return { ...result, items: result.items.map((group: any) => ({...group,RegionName:group.RegionName||'All regions',key:JSON.stringify([String(group.AgencyID),group.RegionID==null?'all':String(group.RegionID)]),items:[]})) }
}
