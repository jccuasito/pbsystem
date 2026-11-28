import { activityFieldLabel, activityScopes, activitySubjectLabels, type ActivityAction, type ActivityItem } from '../../shared/utils/activityHistory'

export const activityActionLabels: Record<ActivityAction, string> = {
  Create: 'Added', Update: 'Edited', Delete: 'Deleted', Remove: 'Removed',
  Import: 'Imported', Process: 'Processed', Access: 'Account access',
}

const pageRecords: Record<string, string> = {
  'employees-list': 'an employee record', 'employees-status': 'an employee status',
  'employees-deployments': 'a deployment', 'employees-documents': 'an employee document',
  'employees-portal-accounts': 'a portal account', 'organization-agency': 'an agency',
  'organization-client': 'a client', 'organization-site': 'a site',
  'organization-position': 'a position', 'organization-region': 'a region',
  'organization-site-accounts': 'a site account', 'attendance-dtr': 'a DTR',
  'attendance-shift-code': 'a shift code', 'attendance-holiday-manager': 'a holiday',
  'rates-payroll': 'a payroll rate', 'rates-billing': 'a billing rate', 'rates-site': 'a site rate',
  'payroll-adjustments': 'a payroll adjustment', 'payroll-processing': 'payroll',
  'payroll-thirteenth-month': '13th-month pay', 'payslip': 'payslips', 'payslip-sites': 'site payslips',
  'billing-generate': 'a billing record', 'employee-loans-deductions': 'an employee account',
  'deductions-loans-catalog': 'a loan or deduction type', 'deductions-loans-cash-bonds': 'a refundable account',
  'deductions-loans-contributions': 'a contribution plan', 'settings': 'an account setting',
}

function joined(values: string[]) {
  return values.length < 2 ? values[0] || '' : `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`
}

// Presentation only: keep the original operation and references intact in the
// saved event. Never infer changed fields from merely submitted field names.
export function activitySentence(item: ActivityItem) {
  const subject = item.subjects?.[0]
  const kind = subject ? subject.kind === 'dtr' ? 'DTR' : (activitySubjectLabels[subject.kind] || 'record').toLowerCase() : ''
  const record = pageRecords[item.scope] || 'a record'
  const target = subject?.label || ''
  const op = item.operation.toLowerCase()
  const named = (verb: string) => target ? `${verb} ${kind}` : `${verb} ${record}`
  const forRecord = (verb: string) => target ? `${verb} for ${kind}` : `${verb} in ${activityScopes[item.scope]?.label || 'this page'}`
  const verb = ({Create:'added',Update:'updated',Delete:'deleted',Remove:'removed',Import:'imported',Process:'processed',Access:'changed'} as Record<ActivityAction,string>)[item.action]
  let text: string
  if (item.outcome === 'Accepted') text = forRecord(item.scope === 'payroll-processing' ? 'queued payroll' : 'submitted a request')
  else if (item.scope === 'employees-portal-accounts') {
    const accessVerb = /^deactivate\b/.test(op) ? 'deactivated' : /^activate\b/.test(op) ? 'activated'
      : /^issue-recovery\b/.test(op) ? 'issued recovery access' : /^reset\b/.test(op) ? 'reset' : /^revoke\b/.test(op) ? 'revoked' : 'updated'
    text = forRecord(/^issue-recovery\b/.test(op) ? 'issued portal recovery access' : `${accessVerb} portal access`)
  }
  else if (item.scope === 'employees-documents') text = forRecord(`${verb} an employee document`)
  else if (item.scope === 'employees-status') text = forRecord('updated attendance status')
  else if (item.scope === 'employees-deployments') text = forRecord(`${verb} a deployment`)
  else if (item.scope === 'deductions-loans-contributions' && subject?.kind !== 'agency-contribution') text = forRecord(`${verb} a contribution plan`)
  else if (item.scope === 'billing-generate' && /profiles/.test(op)) text = forRecord('saved billing settings')
  else if (item.scope === 'settings' && /upload-avatar/.test(op)) text = forRecord('updated the profile photo')
  else if (item.scope === 'settings' && /update-profile/.test(op)) text = forRecord('updated profile details')
  else if (/site-policy|client-policy/.test(op)) text = forRecord('updated policies')
  else if (/^(deactivate|deactivated)\b/.test(op)) text = named('deactivated')
  else if (/^activate\b/.test(op)) text = named('activated')
  else if (/permanent/.test(op) && item.action === 'Delete') text = named('permanently deleted')
  else if (/^rehire\b/.test(op)) text = named('rehired')
  else if (/^transfer\b/.test(op)) text = named('transferred')
  else if (/^(finalize|finalized)\b/.test(op)) text = forRecord('finalized payroll')
  else if (/^compute\b/.test(op)) text = forRecord('recalculated totals')
  else if (/^withdraw\b/.test(op)) text = forRecord('withdrew payslips')
  else if (/^post\b/.test(op) && item.scope.startsWith('payslip')) text = forRecord('published payslips')
  else if (/^issue-recovery\b/.test(op)) text = forRecord('issued account recovery access')
  else if (/^revoke\b/.test(op)) text = forRecord('revoked access')
  else if (/^reset\b/.test(op)) text = forRecord('reset account access')
  else if (/^refund\b/.test(op)) text = forRecord('recorded a refund')
  else if (item.action === 'Update' && item.changedFields != null) {
    if (!item.changedFields.length) text = named('saved')
    else {
      const fields = item.changedFields.slice(0, 3).map(key => key === 'AgencyName' ? 'name' : activityFieldLabel(key).toLowerCase())
      if (item.changedFields.length > 3) fields.push('other details')
      text = target ? `changed the ${joined(fields)} for ${kind}` : `changed the ${joined(fields)} on ${record}`
    }
  } else text = named(({Create:'added',Update:'updated',Delete:'deleted',Remove:'removed',Import:'imported records for',Process:'processed',Access:'changed access for'} as Record<ActivityAction,string>)[item.action])
  return {
    text, target,
    note: item.outcome === 'Accepted' ? 'Request received. Processing is not confirmed complete.'
      : item.action === 'Update' && item.changedFields?.length === 0 ? 'No tracked details changed.' : '',
  }
}
