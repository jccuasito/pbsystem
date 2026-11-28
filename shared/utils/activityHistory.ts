// Stable page identifiers shared by the shell and the server. Never accept a
// client-supplied page name as the authority for a recorded operation.
export const activityScopes: Record<string, { label: string; module: string }> = {
  'employees-list': { label: 'Employee list', module: 'employees' },
  'employees-status': { label: 'Employee status', module: 'employees' },
  'employees-deployments': { label: 'Deployment history', module: 'employees' },
  'employees-documents': { label: 'Employee documents', module: 'employees' },
  'employees-portal-accounts': { label: 'Portal accounts', module: 'employees' },
  'organization-agency': { label: 'Agencies', module: 'organization' },
  'organization-position': { label: 'Positions', module: 'organization' },
  'organization-client': { label: 'Clients', module: 'organization' },
  'organization-site': { label: 'Sites & policies', module: 'organization' },
  'organization-site-accounts': { label: 'Site accounts', module: 'organization' },
  'organization-region': { label: 'Regions', module: 'organization' },
  'attendance-dtr': { label: 'Daily time records', module: 'attendance' },
  'attendance-dtr-reliever': { label: 'Reliever DTR', module: 'attendance' },
  'attendance-shift-code': { label: 'Shift codes', module: 'organization' },
  'attendance-holiday-manager': { label: 'Holidays', module: 'attendance' },
  'rates-payroll': { label: 'Payroll rates', module: 'rates' },
  'rates-billing': { label: 'Billing rates', module: 'rates' },
  'rates-site': { label: 'Site rates', module: 'rates' },
  'payroll-processing': { label: 'Payroll processing', module: 'payroll' },
  'payroll-adjustments': { label: 'Payroll adjustments', module: 'payroll' },
  'payroll-thirteenth-month': { label: '13th-month pay', module: 'payroll' },
  'payslip': { label: 'Payslips', module: 'payslips' },
  'payslip-sites': { label: 'Site payslips', module: 'payslips' },
  'billing-generate': { label: 'Billing', module: 'billing' },
  'deductions-loans-catalog': { label: 'Deduction & loan catalog', module: 'deductions' },
  'employee-loans-deductions': { label: 'Employee accounts', module: 'deductions' },
  'deductions-loans-cash-bonds': { label: 'Cash bonds', module: 'deductions' },
  'deductions-loans-contributions': { label: 'Contributions', module: 'deductions' },
  'settings': { label: 'Account & settings', module: 'settings' },
}

export const activityActions = ['Create', 'Update', 'Delete', 'Remove', 'Import', 'Process', 'Access'] as const
export type ActivityAction = typeof activityActions[number]
export type ActivitySubject = {kind:string;id:string;label:string;previousLabel?:string}
export const activitySubjectLabels:Record<string,string>={agency:'Agency',client:'Client',site:'Site','site-account':'Site account',position:'Position',region:'Region','shift-code':'Shift code','agency-position':'Agency position',employee:'Employee',department:'Department',user:'User',holiday:'Holiday',dtr:'DTR','payroll-rate':'Payroll rate','billing-rate':'Billing rate','site-rate':'Site rate',classification:'Classification','loan-type':'Loan type','deduction-type':'Deduction type',billing:'Billing','cash-account':'Refundable account','agency-contribution':'Contribution plan',recurring:'Recurring deduction',adjustment:'Adjustment','loan-record':'Loan account','deduction-record':'Deduction account'}
export function activityFieldLabel(key:string){return ({AgencyName:'Agency name',AgencyAddress:'Address',AgencyEmail:'Email',AgencyContact:'Contact number',LogoData:'Logo'} as Record<string,string>)[key]||key.replace(/([a-z])([A-Z])/g,'$1 $2')}
export type ActivityItem = {
  id: string; at: string; scope: string; actorId: number; actorName: string; actorRole: string
  action: ActivityAction; operation: string; outcome: 'Completed' | 'Accepted'
  references: string[]; fields: string[]; counts: Record<string, number>
  subjects?:ActivitySubject[]; changedFields?:string[] | null
}
export type ActivityFeed = { period: 'recent' | 'archive'; asOf: string; cutoff: string; items: ActivityItem[]; nextCursor: string | null; visibility: 'Team' | 'Own'; cachedSeconds: number }

export function historyScopeForView(view: string) {
  if (view === 'attendance-dtr-reliever') return 'attendance-dtr'
  if (Object.hasOwn(activityScopes, view)) return view
  return ({ 'payroll-history': 'payroll-processing', 'payroll-summary': 'payroll-processing',
    'billing-history': 'billing-generate', 'deductions-loans-transactions': 'employee-loans-deductions' } as Record<string, string>)[view] || 'all'
}

export function activityScopeForPath(path: string): string | null {
  if (/^\/api\/auth\/(update-profile|upload-avatar|account)$/.test(path) || path.startsWith('/api/settings/')) return 'settings'
  if (path.startsWith('/api/employees/portal-accounts') || /^\/api\/payroll\/payslips\/(account|requests)(\/|$)/.test(path)) return 'employees-portal-accounts'
  if (path.startsWith('/api/employees/documents')) return path.endsWith('/recognize') ? null : 'employees-documents'
  if (path.startsWith('/api/employees/status/')) return 'employees-status'
  if (path.startsWith('/api/employees/deployments')) return 'employees-deployments'
  if (/^\/api\/employees(?:\/\d+(?:\/(?:transfer|rehire|position-changes|permanent))?|\/site-shifts)?$/.test(path)) return 'employees-list'
  if (path.startsWith('/api/organization/')) {
    const resource = path.split('/')[3]!
    return ({ agency: 'organization-agency', position: 'organization-position', positions: 'organization-position', 'agency-position': 'organization-position',
      client: 'organization-client', 'client-policy': 'organization-client', site: 'organization-site', 'site-policy': 'organization-site',
      'site-shift': 'organization-site', 'site-account': 'organization-site-accounts', region: 'organization-region', 'shift-code': 'attendance-shift-code' } as Record<string, string>)[resource] || null
  }
  if (path.startsWith('/api/attendance/dtr/')) return 'attendance-dtr'
  if (path === '/api/attendance/dtr') return 'attendance-dtr'
  if (path.startsWith('/api/attendance/holidays')) return 'attendance-holiday-manager'
  if (path.startsWith('/api/rates/')) return path.includes('billing') ? 'rates-billing' : path.includes('site-rate') ? 'rates-site' : 'rates-payroll'
  if (path.startsWith('/api/payroll/payslips/sites')) return 'payslip-sites'
  if (path.startsWith('/api/payroll/payslips')) return 'payslip'
  if (path.startsWith('/api/payroll/adjustments')) return 'payroll-adjustments'
  if (path.startsWith('/api/payroll/thirteenth-month')) return 'payroll-thirteenth-month'
  if (path.startsWith('/api/payroll/processing') || path.startsWith('/api/payroll/jobs')) return 'payroll-processing'
  if (path.startsWith('/api/billing/')) return 'billing-generate'
  if (path.startsWith('/api/deductions-loans/')) {
    if (path.includes('/cash-bonds')) return 'deductions-loans-cash-bonds'
    if (path.includes('/agency-contributions')) return 'deductions-loans-contributions'
    if (/\/(classification|loan-type|deduction-type)$/.test(path)) return 'deductions-loans-catalog'
    return 'employee-loans-deductions'
  }
  return null
}
