export type AlertMessage = { title: string; message: string; tone: 'info' | 'success' | 'error' }

// Pure data: shared by Vue screens and server validation. Keep new alert copy here.
export const DTR_EMPLOYEE_ALREADY_ADDED = 'DTR_EMPLOYEE_ALREADY_ADDED'
export const alertMessages = {
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
}
