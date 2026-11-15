export type NotificationKind = 'dtr-review' | 'payroll-review' | 'payslip-posting' | 'portal-requests' | 'document-expiry' | 'backup-failed' | 'staff-account-setup' | 'own-payslip' | 'own-request'
export type NotificationTarget = { view: string; section?: 'backups' | 'requests' | 'users' }
export type SystemNotification = {
  key: string; revision: string; kind: NotificationKind; title: string; message: string
  severity: 'info' | 'warning' | 'danger'; updatedAt: string | null; target: NotificationTarget; read: boolean
}
export type NotificationFeed = { items: SystemNotification[]; unreadCount: number; generatedAt: string }

// Notifications supply page identifiers, never arbitrary URLs or HTML.
export function validNotificationTarget(target: NotificationTarget, portal = false) {
  return portal ? ['payslips','information'].includes(target?.view)
    : ['attendance-dtr','payroll-processing','payslip-sites','employees-portal-accounts','employees-documents','settings'].includes(target?.view)
}
