import { listPayrollProgress } from '../../utils/payrollProgress'
import { getQuery } from 'h3'
import { requireSession } from '../../utils/auth'
import { coalesceRead } from '../../utils/requestCapacity'

export default defineEventHandler(event => {
  const session = requireSession(event)
  void session.sub
  const query = getQuery(event)
  return coalesceRead(`dashboard:payroll-progress:${String(query.periodStart || '')}:${String(query.periodEnd || '')}`, () => listPayrollProgress(event))
})
