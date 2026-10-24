import { createError, getRouterParam, readBody } from 'h3'
import { registerEmployee, loginEmployee, logoutEmployee, updateEmployeeAccount, recoverEmployeeAccount } from '../../../utils/employeePortalAuth'
export default defineEventHandler(async(event)=>{
  const action=getRouterParam(event,'action')
  if(action==='logout')return logoutEmployee(event)
  const handlers={signup:registerEmployee,login:loginEmployee,profile:updateEmployeeAccount,recovery:recoverEmployeeAccount}
  if(!Object.hasOwn(handlers,action||''))throw createError({statusCode:404,statusMessage:'Portal action not found.'})
  return handlers[action as keyof typeof handlers](event,await readBody(event))
})
