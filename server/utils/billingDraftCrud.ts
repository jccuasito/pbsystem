import { createHash } from 'node:crypto'
import { createError, getQuery, getRouterParam, readBody } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { loadVersionMap, snapshotAtDate } from './rateVersions'
import { billingLineAmount, calculateBillingDraft, normalizeBillingDraft } from '../../shared/utils/billingDraft'
import { billingComponents, normalizeBillingProfile, profileBillingLines } from '../../shared/utils/billingProfile'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = (statusCode: number, statusMessage: string): never => { throw createError({ statusCode, statusMessage }) }
const canEdit = (event: any, session: any) => event.context?.moduleCanEdit !== false && session.userType !== 'Viewer'
const decode = (value: any) => typeof value === 'string' ? JSON.parse(value) : value
function id(value: unknown) { const number = Number(value); if (!['number', 'string'].includes(typeof value) || !Number.isSafeInteger(number) || number <= 0) fail(400, 'Choose a valid billing record.'); return number }
function date(value: unknown) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value }
function batchIds(value: unknown): number[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  if (!values.length || values.length > 100) fail(400, 'Select between 1 and 100 finalized payroll sources.')
  const ids = values.map(id)
  if (new Set(ids).size !== ids.length) fail(400, 'A payroll source cannot be selected twice.')
  return ids.sort((a, b) => a - b)
}
async function profileAt(connection: any, agencyId: number, clientId: number) {
  const [[row]] = await connection.execute<any[]>('SELECT Revision,ConfigJson FROM billing_client_profile WHERE AgencyID=? AND ClientID=? AND Status=?', [agencyId, clientId, 'Active'])
  return row ? { revision: Number(row.Revision), config: normalizeBillingProfile(decode(row.ConfigJson)) } : null
}

export async function saveBillingProfile(event: any) {
  const session = requireSession(event)
  if (!canEdit(event, session)) fail(403, 'You do not have edit access to billing.')
  const body = await readBody(event), agencyId = id(body?.agencyId), clientId = id(body?.clientId)
  let config
  try { config = normalizeBillingProfile(body.config) } catch (error: any) { fail(400, error.message) }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[agency]] = await connection.execute<any[]>('SELECT AgencyID FROM agency WHERE AgencyID=? FOR UPDATE', [agencyId])
    const [[client]] = await connection.execute<any[]>('SELECT ClientID FROM client WHERE ClientID=?', [clientId])
    const [[scope]] = await connection.execute<any[]>(`SELECT s.SiteID FROM site s INNER JOIN site_agency sa ON sa.SiteID=s.SiteID
      WHERE sa.AgencyID=? AND s.ClientID=? LIMIT 1`, [agencyId, clientId])
    if (!agency || !client || !scope) fail(400, 'Choose a client with sites under this agency.')
    const [[existing]] = await connection.execute<any[]>('SELECT Revision FROM billing_client_profile WHERE AgencyID=? AND ClientID=? FOR UPDATE', [agencyId, clientId])
    if (!Number.isSafeInteger(body.revision) || body.revision !== Number(existing?.Revision || 0)) fail(409, 'This client setup changed. Close and reopen it before saving.')
    const revision = Number(existing?.Revision || 0) + 1
    await connection.execute(`INSERT INTO billing_client_profile(AgencyID,ClientID,Revision,ConfigJson,UpdatedBy) VALUES(?,?,?,?,?)
      ON DUPLICATE KEY UPDATE Revision=VALUES(Revision),ConfigJson=VALUES(ConfigJson),UpdatedBy=VALUES(UpdatedBy),Status='Active'`, [agencyId, clientId, revision, JSON.stringify(config), session.sub])
    await connection.commit()
    return { success: true, revision }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

// Frozen payroll quantities only. Linked billing prices are effective at each source cutoff end.
export async function billingSourceData(connection: any, requestedIds: number[]) {
  const ids = batchIds(requestedIds)
  const [batches] = await connection.execute<any[]>(`SELECT d.BatchID,d.AgencyID,d.ClientID,d.SiteID,d.Status,
      DATE_FORMAT(d.PeriodStart,'%Y-%m-%d') AS PeriodStart,DATE_FORMAT(d.PeriodEnd,'%Y-%m-%d') AS PeriodEnd,
      a.AgencyName,a.AgencyAddress,a.AgencyContact,c.ClientName,c.ClientAddress,s.SiteName,
      review.ReviewStatus,review.SnapshotJson
    FROM attendance_dtr d INNER JOIN agency a ON a.AgencyID=d.AgencyID INNER JOIN client c ON c.ClientID=d.ClientID
    INNER JOIN site s ON s.SiteID=d.SiteID LEFT JOIN payroll_processing_review review ON review.BatchID=d.BatchID
    WHERE d.BatchID IN (${ids.map(() => '?').join(',')}) ORDER BY d.BatchID`, ids)
  if (batches.length !== ids.length) fail(404, 'A payroll source was not found.')
  const first = batches[0]
  if (batches.some(batch => batch.AgencyID !== first.AgencyID || batch.ClientID !== first.ClientID)) fail(400, 'One billing draft must belong to one agency and one client.')
  const profile = await profileAt(connection, first.AgencyID, first.ClientID)
  if (!profile) fail(409, 'Save the client billing setup before preparing a draft.')
  if (profile.config.mode === 'site' && new Set(batches.map(batch => batch.SiteID)).size > 1) fail(400, 'This client requires a separate bill for each site.')
  const people: any[] = [], fingerprints: any[] = [], warnings = new Set<string>()
  for (const batch of batches) {
    if (batch.ReviewStatus !== 'Approved') fail(409, 'Billing requires finalized payroll. A selected payroll was cancelled or is not finalized.')
    let snapshot
    try { snapshot = decode(batch.SnapshotJson) } catch { fail(409, 'The finalized payroll snapshot is unavailable.') }
    if (!Array.isArray(snapshot?.employees) || !snapshot.employees.length || Number(snapshot.BatchID) !== Number(batch.BatchID) || Number(snapshot.AgencyID) !== Number(batch.AgencyID) || Number(snapshot.ClientID) !== Number(batch.ClientID) || Number(snapshot.SiteID) !== Number(batch.SiteID)) fail(409, 'The finalized payroll snapshot does not match this source.')
    const [postings] = await connection.execute<any[]>(`SELECT pp.EmployeeID,pp.PayrollID,py.Status FROM payroll_processing_posting pp
      INNER JOIN payroll py ON py.PayrollID=pp.PayrollID WHERE pp.BatchID=? AND pp.Status='Active' ORDER BY pp.EmployeeID`, [batch.BatchID])
    const expected = snapshot.employees.map((person: any) => Number(person.EmployeeID)).sort((a: number, b: number) => a - b)
    if (postings.length !== expected.length || postings.some((posting, index) => Number(posting.EmployeeID) !== expected[index] || !['Approved', 'Released'].includes(posting.Status))) fail(409, 'All source payroll postings must still be finalized and active.')
    if (snapshot.employees.some((person: any) => !Array.isArray(person.components))) fail(409, 'The finalized payroll component snapshot is unavailable.')
    for (const person of snapshot.employees) people.push({ employeeId: Number(person.EmployeeID), name: person.EmployeeName,
      type: person.AttendanceType, PositionName: person.PositionName || 'Service', SiteName: snapshot.SiteName || batch.SiteName,
      SiteID: Number(batch.SiteID), BatchID: Number(batch.BatchID), SiteRateID: Number(person.SiteRateID) || null,
      PeriodEnd: batch.PeriodEnd, components: (person.components || []).filter((item: any) => billingComponents.some(definition => definition.code === item.code)).map((item: any) => ({ code: item.code, hours: Number(item.hours || 0) })) })
    fingerprints.push({ batchId: batch.BatchID, snapshotHash: hash(snapshot), payrollIds: postings.map(posting => posting.PayrollID) })
  }
  const siteRateIds = [...new Set(people.map(person => person.SiteRateID).filter(Boolean))]
  const [rates] = siteRateIds.length ? await connection.execute<any[]>(`SELECT sr.SiteRateID,sr.SiteID,ap.AgencyID,br.*,
      DATE_FORMAT(br.EffectiveDate,'%Y-%m-%d') AS BaseEffectiveDate
    FROM site_rate sr INNER JOIN billing_rate br ON br.BillingRateID=sr.BillingRateID
    INNER JOIN agency_position ap ON ap.AgencyPositionID=br.AgencyPositionID
    WHERE sr.SiteRateID IN (${siteRateIds.map(() => '?').join(',')})`, siteRateIds) : [[]]
  const versions = await loadVersionMap(connection, 'billing-rate', [...new Set<number>(rates.map(row => Number(row.BillingRateID)))])
  for (const person of people) {
    const base = rates.find(row => Number(row.SiteRateID) === person.SiteRateID && Number(row.SiteID) === person.SiteID && Number(row.AgencyID) === Number(first.AgencyID))
    const applicable = base && base.BaseEffectiveDate <= person.PeriodEnd ? snapshotAtDate(base, versions.get(Number(base.BillingRateID)) || [], person.PeriodEnd) : null
    person.billingRate = applicable || {}
    if (!applicable && profile.config.rules.some(rule => rule.enabled && rule.rateMode === 'linked' && person.components.some((item: any) => item.code === rule.code && item.hours > 0))) fail(409, 'A source employee has no linked billing rate effective by the cutoff end. Configure a contract rate in Client billing setup or fix the site billing-rate link.')
  }
  const lines = profileBillingLines(people, profile.config)
  for (const line of lines) if (!line.rate) warnings.add(`${line.description}: the billing rate is zero. Confirm the contract amount.`)
  if (profile.config.rules.some(rule => !rule.enabled && people.some(person => person.components.some((item: any) => item.code === rule.code && item.hours > 0)))) warnings.add('Some finalized payroll components are excluded by this client setup. Only enabled items are included in the bill.')
  warnings.add('Linked prices use billing rates effective at each payroll cutoff end. Review or split invoice lines for contracts with mid-cutoff rate or position changes.')
  const workedDays = Math.round(people.reduce((sum, person) => sum + person.components.filter((item: any) => item.code === 'RegularHours').reduce((subtotal: number, item: any) => subtotal + item.hours, 0), 0) / profile.config.hoursPerDay * 100) / 100
  const { SnapshotJson, ReviewStatus, ...metadata } = first
  const batch = { ...metadata, BatchID: ids[0], BatchIDs: ids, SiteID: new Set(batches.map(batch => batch.SiteID)).size === 1 ? first.SiteID : null,
    SiteName: [...new Set(batches.map(batch => batch.SiteName))].join(', '), PeriodStart: batches.map(batch => batch.PeriodStart).sort()[0], PeriodEnd: batches.map(batch => batch.PeriodEnd).sort().at(-1) }
  return { batch, lines, workedDays, employees: people.map(person => ({ employeeId: person.employeeId, name: person.name, type: person.type, siteName: person.SiteName,
      workedDays: Math.round((person.components.find((item: any) => item.code === 'RegularHours')?.hours || 0) / profile.config.hoursPerDay * 100) / 100,
      regularHours: person.components.find((item: any) => item.code === 'RegularHours')?.hours || 0,
      otHours: person.components.find((item: any) => item.code === 'OTHours')?.hours || 0,
      extensionHours: person.components.find((item: any) => item.code === 'OTExtHours')?.hours || 0,
      nightHours: person.components.find((item: any) => item.code === 'NightDiffHours')?.hours || 0 })),
    warnings: [...warnings], profile: profile.config, profileRevision: profile.revision,
    sourceHash: hash({ batch, fingerprints, profile, prices: people.map(person => ({ batchId: person.BatchID, employeeId: person.employeeId, rates: person.billingRate })) }),
    settings: { ...profile.config.settings, retirementQuantity: workedDays, uniformQuantity: workedDays } }
}

export async function listBillingDrafts(event: any) {
  const session = requireSession(event), query = getQuery(event)
  if ((query.periodStart || query.periodEnd) && (!date(query.periodStart) || !date(query.periodEnd) || String(query.periodStart) > String(query.periodEnd))) fail(400, 'Choose valid service dates.')
  const [accounts] = await pool.execute<any[]>(`SELECT DISTINCT a.AgencyID,a.AgencyName,c.ClientID,c.ClientName,p.Revision,p.ConfigJson
    FROM site s INNER JOIN site_agency sa ON sa.SiteID=s.SiteID INNER JOIN agency a ON a.AgencyID=sa.AgencyID
    INNER JOIN client c ON c.ClientID=s.ClientID LEFT JOIN billing_client_profile p ON p.AgencyID=a.AgencyID AND p.ClientID=c.ClientID AND p.Status='Active'
    WHERE a.Status='Active' AND c.Status='Active' ORDER BY a.AgencyName,c.ClientName`)
  const [sources] = await pool.execute<any[]>(`SELECT d.BatchID,d.AgencyID,a.AgencyName,d.ClientID,c.ClientName,d.SiteID,s.SiteName,
      DATE_FORMAT(d.PeriodStart,'%Y-%m-%d') AS PeriodStart,DATE_FORMAT(d.PeriodEnd,'%Y-%m-%d') AS PeriodEnd,
      (SELECT COUNT(*) FROM payroll_processing_posting pp INNER JOIN payroll py ON py.PayrollID=pp.PayrollID WHERE pp.BatchID=d.BatchID AND pp.Status='Active' AND py.Status IN ('Approved','Released')) AS PeopleCount,
      ds.BillingID
    FROM attendance_dtr d INNER JOIN agency a ON a.AgencyID=d.AgencyID INNER JOIN client c ON c.ClientID=d.ClientID INNER JOIN site s ON s.SiteID=d.SiteID
    INNER JOIN payroll_processing_review r ON r.BatchID=d.BatchID AND r.ReviewStatus='Approved'
    LEFT JOIN billing_draft_source ds ON ds.BatchID=d.BatchID
    WHERE EXISTS(SELECT 1 FROM payroll_processing_posting pp INNER JOIN payroll py ON py.PayrollID=pp.PayrollID WHERE pp.BatchID=d.BatchID AND pp.Status='Active' AND py.Status IN ('Approved','Released'))
    ORDER BY d.PeriodStart DESC,s.SiteName,d.BatchID`)
  const [drafts] = await pool.execute<any[]>(`SELECT d.BillingID,d.AgencyID,a.AgencyName,d.ClientID,c.ClientName,d.Revision,
      DATE_FORMAT(d.PeriodStart,'%Y-%m-%d') AS PeriodStart,DATE_FORMAT(d.PeriodEnd,'%Y-%m-%d') AS PeriodEnd,
      DATE_FORMAT(d.UpdatedAt,'%Y-%m-%d %H:%i:%s') AS UpdatedAt,b.TotalAmount,b.Status,d.SnapshotJson
    FROM billing_draft d INNER JOIN billing b ON b.BillingID=d.BillingID INNER JOIN agency a ON a.AgencyID=d.AgencyID INNER JOIN client c ON c.ClientID=d.ClientID
    ORDER BY d.PeriodStart DESC,d.BillingID DESC`)
  const within = (item: any) => !query.periodStart || item.PeriodStart >= query.periodStart && item.PeriodEnd <= query.periodEnd
  return { accounts: accounts.map(({ ConfigJson, Revision, ...account }) => ({ ...account, profile: ConfigJson ? { revision: Number(Revision), config: decode(ConfigJson) } : null })),
    sources: sources.filter(within), drafts: drafts.filter(within).map(({ SnapshotJson, ...draft }) => { const snapshot = decode(SnapshotJson); return { ...draft, SiteName: snapshot.source.SiteName } }), permissions: { canEdit: canEdit(event, session) } }
}

export async function previewBillingDraft(event: any) {
  const session = requireSession(event)
  const source = await billingSourceData(pool, batchIds(getQuery(event).batchIds))
  const [claimed] = await pool.execute<any[]>(`SELECT BillingID FROM billing_draft_source WHERE BatchID IN (${source.batch.BatchIDs.map(() => '?').join(',')})`, source.batch.BatchIDs)
  if (claimed.length) fail(409, 'A selected payroll source already belongs to a saved draft. Open that draft from Billing History.')
  return { source, draft: null, history: [], permissions: { canEdit: canEdit(event, session) } }
}
export async function getBillingDraft(event: any) {
  const session = requireSession(event), billingId = id(getRouterParam(event, 'id'))
  const [[saved]] = await pool.execute<any[]>(`SELECT d.*,b.Status FROM billing_draft d INNER JOIN billing b ON b.BillingID=d.BillingID WHERE d.BillingID=?`, [billingId])
  if (!saved) fail(404, 'Billing draft not found.')
  const [sources] = await pool.execute<any[]>('SELECT BatchID FROM billing_draft_source WHERE BillingID=? ORDER BY BatchID', [billingId])
  let source: any = null, sourceIssue = ''
  try { if (saved.Status === 'Draft') source = await billingSourceData(pool, sources.map(row => Number(row.BatchID))) } catch (error: any) {
    if (![400, 404, 409].includes(error.statusCode)) throw error
    sourceIssue = error.statusMessage || error.message
  }
  const [history] = await pool.execute<any[]>(`SELECT revision.Revision,DATE_FORMAT(revision.CreatedAt,'%Y-%m-%d %H:%i:%s') AS CreatedAt,
    JSON_UNQUOTE(JSON_EXTRACT(revision.SnapshotJson,'$.workflow.action')) AS Action,
    JSON_UNQUOTE(JSON_EXTRACT(revision.SnapshotJson,'$.workflow.reason')) AS Reason,
    CONCAT_WS(' ',actor.FirstName,actor.LastName) AS ActorName FROM billing_draft_revision revision LEFT JOIN \`user\` actor ON actor.UserID=revision.ActorUserID WHERE revision.BillingID=? ORDER BY revision.Revision DESC`, [billingId])
  return { source, sourceIssue, draft: { billingId, revision: Number(saved.Revision), status: saved.Status, snapshot: decode(saved.SnapshotJson), sourceHash: saved.SourceHash },
    history: history.map(({ Action, Reason, ...revision }) => ({ ...revision, action: Action || 'Saved', reason: Reason || '' })),
    permissions: { canEdit: canEdit(event, session) && !!source && saved.Status === 'Draft',
      canFinalize: canEdit(event, session) && !!source && saved.Status === 'Draft' && source.sourceHash === saved.SourceHash,
      canReopen: canEdit(event, session) && saved.Status === 'Finalized' } }
}

// A status change always appends a revision; finalized statement values stay frozen.
export async function changeBillingStatusData(connection: any, billingId: number, input: any, actorId: number) {
  if (!input || !['finalize', 'reopen'].includes(input.action)) fail(400, 'Choose Finalize or Reopen billing.')
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (input.action === 'reopen' && (reason.length < 5 || reason.length > 500)) fail(400, 'Enter a reason for reopening (5 to 500 characters).')
  const [sources] = await connection.execute<any[]>('SELECT BatchID FROM billing_draft_source WHERE BillingID=? ORDER BY BatchID', [billingId])
  const ids = sources.map(row => Number(row.BatchID))
  if (ids.length) await connection.execute(`SELECT BatchID FROM attendance_dtr WHERE BatchID IN (${ids.map(() => '?').join(',')}) ORDER BY BatchID FOR UPDATE`, ids)
  const [[saved]] = await connection.execute<any[]>(`SELECT d.*,b.Status,b.TotalAmount FROM billing_draft d INNER JOIN billing b ON b.BillingID=d.BillingID WHERE d.BillingID=? FOR UPDATE`, [billingId])
  if (!saved) fail(404, 'Billing record not found.')
  if (!Number.isSafeInteger(input.revision) || input.revision !== Number(saved.Revision)) fail(409, 'This bill changed. Close and reopen it before continuing.')
  const finalize = input.action === 'finalize', status = finalize ? 'Finalized' : 'Draft'
  if (saved.Status !== (finalize ? 'Draft' : 'Finalized')) fail(409, finalize ? 'Only a Draft bill can be finalized.' : 'Only a Finalized bill can be reopened.')
  const snapshot = decode(saved.SnapshotJson)
  if (finalize) {
    const source = await billingSourceData(connection, ids)
    if (input.sourceHash !== saved.SourceHash || source.sourceHash !== saved.SourceHash) fail(409, 'The payroll, rates or client setup changed. Reload source values and save the draft before finalizing.')
    const normalized = normalizeBillingDraft(snapshot.lines, snapshot.settings)
    const totals = calculateBillingDraft(normalized.lines, normalized.settings)
    if (hash(totals) !== hash(snapshot.totals) || Number(saved.TotalAmount) !== totals.totalDue) fail(409, 'Saved billing totals do not match. Review and save this draft again.')
  }
  const revision = Number(saved.Revision) + 1
  snapshot.workflow = { status, action: finalize ? 'Finalized' : 'Reopened', reason: finalize ? '' : reason }
  const json = JSON.stringify(snapshot)
  await connection.execute('UPDATE billing SET Status=? WHERE BillingID=?', [status, billingId])
  await connection.execute('UPDATE billing_draft SET Revision=?,SnapshotJson=?,UpdatedBy=? WHERE BillingID=?', [revision, json, actorId, billingId])
  await connection.execute('INSERT INTO billing_draft_revision(BillingID,Revision,SnapshotJson,ActorUserID) VALUES(?,?,?,?)', [billingId, revision, json, actorId])
  return { success: true, billingId, revision, status }
}

export async function changeBillingStatus(event: any) {
  const session = requireSession(event)
  if (!canEdit(event, session)) fail(403, 'You do not have edit access to billing.')
  const billingId = id(getRouterParam(event, 'id')), body = await readBody(event)
  const connection = await pool.getConnection()
  try { await connection.beginTransaction(); const result = await changeBillingStatusData(connection, billingId, body, Number(session.sub)); await connection.commit(); return result }
  catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function saveBillingDraftData(connection: any, input: any, actorId: number) {
  const ids = batchIds(input.batchIds), billingId = input.billingId ? id(input.billingId) : null
  // This is the same parent-row lock used by payroll cancellation/finalization.
  await connection.execute(`SELECT BatchID FROM attendance_dtr WHERE BatchID IN (${ids.map(() => '?').join(',')}) ORDER BY BatchID FOR UPDATE`, ids)
  const source = await billingSourceData(connection, ids)
  if (input.sourceHash !== source.sourceHash) fail(409, 'The payroll, rates or client setup changed. Close and reopen this draft, then reload source values.')
  if (!date(input.billingDate)) fail(400, 'Choose a valid billing date.')
  let normalized, totals
  try { normalized = normalizeBillingDraft(input.lines, input.settings); totals = calculateBillingDraft(normalized.lines, normalized.settings) } catch (error: any) { fail(400, error.message) }
  if (typeof input.notes !== 'string' || input.notes.length > 1000) fail(400, 'Billing notes must be 1,000 characters or less.')
  const [[saved]] = billingId ? await connection.execute<any[]>(`SELECT d.*,b.Status FROM billing_draft d INNER JOIN billing b ON b.BillingID=d.BillingID WHERE d.BillingID=? FOR UPDATE`, [billingId]) : [[]]
  if (billingId && !saved) fail(404, 'Billing draft not found.')
  if (!Number.isSafeInteger(input.revision) || input.revision !== Number(saved?.Revision || 0) || saved && saved.Status !== 'Draft') fail(409, 'This draft changed or is no longer editable. Close and reopen it.')
  const [claimed] = await connection.execute<any[]>(`SELECT BillingID,BatchID FROM billing_draft_source WHERE BatchID IN (${ids.map(() => '?').join(',')}) FOR UPDATE`, ids)
  if (claimed.some(row => Number(row.BillingID) !== billingId)) fail(409, 'A payroll source already belongs to another saved bill.')
  if (saved) {
    const [existing] = await connection.execute<any[]>('SELECT BatchID FROM billing_draft_source WHERE BillingID=? ORDER BY BatchID', [billingId])
    if (JSON.stringify(existing.map(row => Number(row.BatchID))) !== JSON.stringify(ids)) fail(409, 'Saved invoice source selection is fixed. Open the existing source set.')
  }
  const revision = Number(saved?.Revision || 0) + 1
  const snapshot = { schemaVersion: 2, source: source.batch, profile: source.profile, profileRevision: source.profileRevision, sourceHash: source.sourceHash,
    workedDays: source.workedDays, employees: source.employees, originalLines: source.lines, lines: normalized.lines, settings: normalized.settings, totals, warnings: source.warnings, billingDate: input.billingDate, notes: input.notes.trim() }
  let storedId = billingId
  if (!storedId) {
    const [insert] = await connection.execute<any>('INSERT INTO billing(ClientID,BillingPeriod,BillingDate,TotalAmount,Status) VALUES(?,?,?,?,?)', [source.batch.ClientID, `${source.batch.PeriodStart} to ${source.batch.PeriodEnd}`, input.billingDate, totals.totalDue, 'Draft'])
    storedId = Number(insert.insertId)
    await connection.execute('INSERT INTO billing_draft(BillingID,AgencyID,ClientID,PeriodStart,PeriodEnd,Revision,SourceHash,SnapshotJson,CreatedBy,UpdatedBy) VALUES(?,?,?,?,?,?,?,?,?,?)', [storedId, source.batch.AgencyID, source.batch.ClientID, source.batch.PeriodStart, source.batch.PeriodEnd, revision, source.sourceHash, JSON.stringify(snapshot), actorId, actorId])
    for (const batchId of ids) await connection.execute('INSERT INTO billing_draft_source(BillingID,BatchID) VALUES(?,?)', [storedId, batchId])
  } else {
    await connection.execute('UPDATE billing SET BillingDate=?,TotalAmount=? WHERE BillingID=?', [input.billingDate, totals.totalDue, storedId])
    await connection.execute('UPDATE billing_draft SET Revision=?,SourceHash=?,SnapshotJson=?,UpdatedBy=? WHERE BillingID=?', [revision, source.sourceHash, JSON.stringify(snapshot), actorId, storedId])
    // Detail rows have no status column; immutable prior content remains in revision snapshots.
    await connection.execute('DELETE FROM billing_detail WHERE BillingID=?', [storedId])
  }
  const details = normalized.lines.map(line => ({ description: line.description, quantity: line.quantity, rate: line.rate, amount: billingLineAmount(line) }))
  for (const [description, amount] of [['Retirement pay', totals.retirement], ['Uniform allowance', totals.uniform], ['Administrative cost', totals.administrative], ['VAT', totals.vat], ['Less: withholding tax', -totals.withholding]] as [string, number][]) if (amount) details.push({ description, quantity: 1, rate: Math.abs(amount), amount })
  for (const line of details) {
    if (Math.abs(line.amount) > 99999999.99) fail(400, 'A billing line exceeds the supported amount.')
    await connection.execute('INSERT INTO billing_detail(BillingID,EmployeeID,SiteID,Description,Quantity,Rate,Amount) VALUES(?,NULL,?,?,?,?,?)', [storedId, source.batch.SiteID, line.description, line.quantity, line.rate, line.amount])
  }
  await connection.execute('INSERT INTO billing_draft_revision(BillingID,Revision,SnapshotJson,ActorUserID) VALUES(?,?,?,?)', [storedId, revision, JSON.stringify(snapshot), actorId])
  return { success: true, billingId: storedId, revision, totalDue: totals.totalDue }
}
export async function saveBillingDraft(event: any) {
  const session = requireSession(event)
  if (!canEdit(event, session)) fail(403, 'You do not have edit access to billing.')
  const body = await readBody(event)
  if (!body || typeof body !== 'object') fail(400, 'Billing details are required.')
  const connection = await pool.getConnection()
  try { await connection.beginTransaction(); const result = await saveBillingDraftData(connection, body, Number(session.sub)); await connection.commit(); return result }
  catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}
