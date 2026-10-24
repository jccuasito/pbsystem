import { requireEmployeeSession } from '../../utils/employeePortalAuth'
export default defineEventHandler(async(event)=>({account:await requireEmployeeSession(event)}))
