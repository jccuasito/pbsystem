import { createError } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'

export const MODULES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'employees', label: 'Employees' },
  { key: 'organization', label: 'Organization' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'payroll', label: 'Payroll processing & history' },
  { key: 'payslips', label: 'Payslips' },
  { key: 'billing', label: 'Billing' },
  { key: 'deductions', label: 'Deductions & loans' },
  { key: 'rates', label: 'Rates' },
  { key: 'reports', label: 'Reports' }
] as const
export type ModuleKey = typeof MODULES[number]['key']

export function defaultAccess(role: string) {
  return { canView: true, canEdit: role !== 'Viewer' }
}

export async function currentActor(event: any) {
  const session = requireSession(event)
  const [rows] = await pool.execute<any[]>('SELECT UserID, UserType, Status FROM `user` WHERE UserID = ? LIMIT 1', [session.sub])
  const actor = rows[0]
  if (!actor || actor.Status !== 'Active') throw createError({ statusCode: 401, statusMessage: 'Please sign in again.' })
  return actor as { UserID: number; UserType: string; Status: string }
}

export async function requireAdmin(event: any) {
  const actor = await currentActor(event)
  if (actor.UserType !== 'Admin') throw createError({ statusCode: 403, statusMessage: 'Administrator access is required.' })
  return actor
}

export async function accessForUser(userId: number, role: string) {
  if (role === 'Admin') return Object.fromEntries(MODULES.map(item => [item.key, { canView: true, canEdit: true }]))
  const [rows] = await pool.execute<any[]>('SELECT ModuleKey, CanView, CanEdit FROM user_module_permission WHERE UserID = ?', [userId])
  const overrides = new Map(rows.map(row => [row.ModuleKey, row]))
  return Object.fromEntries(MODULES.map(item => {
    const row = overrides.get(item.key) as any
    return [item.key, row ? { canView: Boolean(row.CanView), canEdit: Boolean(row.CanEdit) } : defaultAccess(role)]
  }))
}

export function moduleForPath(path: string): ModuleKey | null {
  const matches = (root: string) => path === root || path.startsWith(`${root}/`)
  if (matches('/api/dashboard')) return 'dashboard'
  if (matches('/api/employees')) return 'employees'
  if (matches('/api/organization')) return 'organization'
  if (matches('/api/attendance')) return 'attendance'
  if (matches('/api/rates')) return 'rates'
  if (matches('/api/deductions-loans')) return 'deductions'
  // Legacy account/request aliases follow their new Employee Management owner.
  if (matches('/api/payroll/payslips/account') || matches('/api/payroll/payslips/requests')) return 'employees'
  if (path.startsWith('/api/payroll/payslips')) return 'payslips'
  if (matches('/api/payroll')) return 'payroll'
  return null
}
