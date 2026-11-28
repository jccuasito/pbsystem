import { randomUUID } from 'node:crypto'
import { getRequestURL, getMethod, getResponseStatus } from 'h3'
import { activityScopeForPath, type ActivityAction, type ActivitySubject } from '../../shared/utils/activityHistory'

type Details = { references: string[]; fields: string[]; counts: Record<string, number>; subjects?:ActivitySubject[]; changedFields?:string[] | null }
export type Entry = { key: string; scope: string; actorId: number; actorName: string; actorRole: string; action: ActivityAction; operation: string; outcome: 'Completed' | 'Accepted'; details: Details }
const methods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
// Deliberately store field NAMES only, never submitted values, free text,
// passwords, tokens, ID scans, payroll snapshots or attachment bytes.
const fields = new Set(('FirstName LastName MiddleName AgencyID ClientID SiteID SiteAccountID PositionID RegionID EmployeeID BatchID DepartmentID UserID Status UserType CanView CanEdit AgencyName AgencyAddress AgencyEmail AgencyContact ClientName SiteName SiteAccountName PositionName RegionName RegionCode ShiftCode ShiftName ShiftCodeID ShiftType TimeIn TimeOut RegularHours OTHours NightDiffHours LateHours UndertimeHours AttendanceStatus AttendanceDate StartDate EndDate PeriodStart PeriodEnd Amount RemainingBalance InstallmentAmount LoanTypeID DeductionTypeID ReleaseDate EffectiveDate Remarks Description Reason Notes Gender BirthDate ContactNumber Address Email EmployeeNo EmploymentStatus ResignationDate HireDate DateHired SalaryRate RegularRate OTRate NDRate Allowance PhotoDataUrl LogoData AttachmentDataUrl pdfData image fileName NDEnabled ComputeLate ComputeOT ComputeUndertime GraceMinutes ImportRows Rows employeeIds employeeId batchId billingId siteAccountId agencyId periodStart periodEnd year action type scope target revision confirmation permissions modules').split(' '))
const identifiers = new Set(['id','EmployeeID','BatchID','AgencyID','ClientID','SiteID','SiteAccountID','PositionID','RegionID','UserID','DepartmentID','LoanID','EmployeeLoanID','EmployeeDeductionID','DeductionTypeID','LoanTypeID','AttendanceID','DeploymentID','ShiftCodeID','PayrollID','BillingID','employeeId','batchId','billingId','siteAccountId','agencyId','archiveId','requestId','recordId','departmentId'])
const fieldNames = new Set([...fields].map(key => key.toLowerCase()))
const resultCounts = ['added','updated','skipped','blankRows','deleted','removed','changed','unchanged','payrollCount','imported','preservedEmployeeStatusDays','deletedAttendanceRows','removedDtrCreatedDeployments']
const actions: Record<string, ActivityAction> = { create:'Create', add:'Create', import:'Import', update:'Update', edit:'Update', set:'Update', reset:'Update', restore:'Update', reopen:'Update', delete:'Delete', remove:'Remove', withdraw:'Remove', finalize:'Process', approve:'Process', reject:'Process', cancel:'Process', post:'Process', release:'Process', refund:'Process', compute:'Process', rehire:'Process', transfer:'Process', issue:'Access', 'issue-recovery':'Access', revoke:'Access',activate:'Access',deactivate:'Update',pause:'Update',resume:'Update',save:'Update',classify:'Update','remove-import':'Remove','previous-payment':'Process','void-payment':'Process','reverse-refund':'Process' }
export function activityInput(body: Record<string, unknown> = {}) {
  const references: string[] = [], counts: Record<string, number> = {}, ids:Record<string,number>={}
  for (const [key, value] of Object.entries(body)) {
    if ((identifiers.has(key)||['sourceBatchId','targetBatchId','SourceBatchID','TargetBatchID','userId','clientId','siteId','positionId','regionId','shiftCodeId','AgencyPositionID','agencyPositionId','PayrollRateID','BillingRateID','SiteRateID','ClassificationID','CatalogItemID','AccountID','AgencyContributionID','RecurringDeductionID','AdjustmentID','RecordID'].includes(key)) && /^[1-9]\d{0,14}$/.test(String(value)) && Number.isSafeInteger(Number(value))) { references.push(`${key} #${value}`);ids[key]=Number(value) }
    if (['Rows','rows','employeeIds','EmployeeIDs','items','lines'].includes(key) && Array.isArray(value)) counts[`${key} submitted`] = value.length
  }
  const rawAction = typeof body.action === 'string' ? body.action.toLowerCase() : typeof body.Action === 'string' ? body.Action.toLowerCase() : typeof body.PlanAction === 'string' ? body.PlanAction.toLowerCase() : ''
  return { references: references.slice(0, 12), fields: Object.keys(body).filter(key => fieldNames.has(key.toLowerCase()) || identifiers.has(key)).slice(0, 40), counts,
    action: Object.hasOwn(actions, rawAction) ? actions[rawAction] : null, verb: Object.hasOwn(actions, rawAction) ? rawAction : null,
    ids,entryType:body.EntryType==='Loan'?'Loan':body.EntryType==='Deduction'?'Deduction':null, rateKind: body.resource === 'billing-rate' ? 'billing' : 'payroll', importRows: body.ImportRows === true }
}

export function activityCandidate(event: any, response: any): Entry | null {
  const actor = event.context?.securityActor, method = getMethod(event), status = getResponseStatus(event)
  if (!actor || !methods.has(method) || event.context.activityFailed || status < 200 || status >= 300 || response?.body?.success === false) return null
  const path = getRequestURL(event).pathname.replace(/\/+$/, '')
  let scope = activityScopeForPath(path)
  if (!scope) return null
  const input = event.context.activityInput || activityInput()
  if (path === '/api/rates/versions' && input.rateKind === 'billing') scope = 'rates-billing'
  const references = [...input.references], counts = { ...input.counts }
  const parts = path.split('/').filter(Boolean)
  for (const part of parts) if (/^[1-9]\d{0,14}$/.test(part)) references.unshift(`Record #${part}`)
  const body = response?.body
  if (body && typeof body === 'object') {
    for (const key of identifiers) {
      const value = body[key]
      if (/^[1-9]\d{0,14}$/.test(String(value)) && Number.isSafeInteger(Number(value))) references.push(`${key} #${value}`)
    }
    for (const key of resultCounts) if (Number.isSafeInteger(body[key]) && body[key] >= 0) counts[key] = body[key]
  }
  let action: ActivityAction = method === 'DELETE' ? 'Delete' : method === 'PUT' || method === 'PATCH' ? 'Update' : 'Create'
  if (input.action) action = input.action
  if (/\/(records|site-policy|site-shifts|status\/attendance)$/.test(path)) action = 'Update'
  if (input.importRows || /\/(import|bulk)$/.test(path)) action = 'Import'
  if (/\/(compute|btr|apply-shift|rehire|transfer|refund)$/.test(path)) action = method === 'DELETE' ? 'Remove' : 'Process'
  if (path === '/api/payroll/jobs') action = 'Process'
  if (path === '/api/auth/upload-avatar' || path === '/api/auth/update-profile') action = 'Update'
  const resource = parts.filter(part => !/^\d+$/.test(part)).slice(2).join(' / ').slice(0, 110)
  return { key: randomUUID(), scope, actorId: actor.UserID, actorName: [actor.FirstName, actor.LastName].filter(Boolean).join(' ').trim().slice(0, 200) || `User #${actor.UserID}`,
    actorRole: actor.UserType, action:event.context.activityAction||action, operation: (event.context.activityOperation||`${input.verb || action.toLowerCase()} ${resource}`).slice(0, 160),
    outcome: status === 202 ? 'Accepted' : 'Completed', details: { references: [...new Set(references)].slice(0, 12), fields: input.fields, counts,
      subjects:event.context.activitySubjects||[],changedFields:event.context.activityChangedFields??null } }
}

