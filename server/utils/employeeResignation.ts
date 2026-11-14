import { createError } from 'h3'

export function resignationDate(value: unknown, hired: string | null, now=new Date()) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
  const day=value===undefined || value===null || value==='' ? today : typeof value==='string' ? value.trim() : ''
  const parsed=new Date(`${day}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10)!==day) throw createError({statusCode:400,statusMessage:'Resignation date must be a valid date.'})
  if (day>today) throw createError({statusCode:400,statusMessage:'Resignation date cannot be in the future.'})
  if (hired && day<hired) throw createError({statusCode:400,statusMessage:'Resignation date cannot be before the date hired.'})
  return day
}

/** Caller owns the transaction. Uses the same employee row lock as daily status updates. */
export async function recordEmployeeResignation(connection: any, employeeId: number, value: unknown, actor: number) {
  const [[employee]]=await connection.execute(`SELECT EmployeeID, Status,
    DATE_FORMAT(DateHired, '%Y-%m-%d') AS DateHired,
    DATE_FORMAT(ResignationDate, '%Y-%m-%d') AS ResignationDate
    FROM employee WHERE EmployeeID = ? FOR UPDATE`,[employeeId])
  if (!employee) throw createError({statusCode:404,statusMessage:'Employee not found.'})
  // A retry never changes the original resignation date or dates a legacy record.
  if (employee.Status==='Inactive') return {success:true,Status:'Inactive',EmploymentStatus:'Resigned',ResignationDate:employee.ResignationDate||null}
  const day=resignationDate(value,employee.DateHired)
  await connection.execute("UPDATE employee SET Status = 'Inactive', ResignationDate = ?, UpdatedBy = ? WHERE EmployeeID = ?",[day,actor,employeeId])
  return {success:true,Status:'Inactive',EmploymentStatus:'Resigned',ResignationDate:day}
}
