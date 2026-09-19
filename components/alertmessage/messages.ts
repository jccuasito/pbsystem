export type AlertMessage = { title: string; message: string; tone: 'info' | 'success' | 'error' }

// Pure data: shared by Vue screens and server validation. Keep new alert copy here.
export const DTR_EMPLOYEE_ALREADY_ADDED = 'DTR_EMPLOYEE_ALREADY_ADDED'
export const DEPLOYMENT_ALREADY_EXISTS = 'DEPLOYMENT_ALREADY_EXISTS'
export const alertMessages = {
  deploymentPositionMismatch: (): AlertMessage => ({
    title: 'Position does not match',
    message: 'Select a client rate matching the agency and position saved in Employee List. Refresh the form if the employee position was recently changed.',
    tone: 'error',
  }),
  deploymentAlreadyExists: (name = 'This employee'): AlertMessage => ({
    title: 'Employee already deployed',
    message: `${name} already has a deployment covering these dates. No new deployment was added and the existing assignment was not changed. Check Deployment History, or use Transfer in Employee List to move the employee to another site.`,
    tone: 'info',
  }),
  dtrEmployeeAlreadyAdded: (name = 'This employee'): AlertMessage => ({
    title: 'Already added to this DTR',
    message: `${name} is already included in this DTR. No duplicate was added and the existing assignment was not changed. To update the employee, use their row in the DTR.`,
    tone: 'info',
  }),
  dtrEmployeeAdded: (name: string): AlertMessage => ({
    title: 'Employee added', message: `${name} has been added to this DTR.`, tone: 'success',
  }),
  dtrEmployeeAddFailed: (message?: string): AlertMessage => ({
    title: 'Unable to add employee', message: message || 'The employee could not be added. Please try again.', tone: 'error',
  }),
  employeePermanentDelete: (): AlertMessage => ({
    title: 'Are you sure you want to delete this employee?',
    message: 'All records and transactions related to this employee will be permanently deleted, including attendance, DTR/BTR entries, deployments, payroll, deductions, loans, billing details, and employee documents. This action cannot be undone.',
    tone: 'error',
  }),
}
