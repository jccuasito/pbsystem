import { createError, getQuery } from 'h3'
import pool from '../../connection/dbconnect'
import { requireSession } from '../../utils/auth'

function optionalAgencyId(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'agencyId must be a valid ID.' })
  return id
}

export default defineEventHandler(async (event) => {
  const session = requireSession(event); void session.sub
  const agencyId = optionalAgencyId(getQuery(event).agencyId)
  const [agenciesResult, clientsResult] = await Promise.all([
    pool.execute<any[]>("SELECT AgencyID, AgencyName FROM agency WHERE Status = 'Active' ORDER BY AgencyName"),
    pool.execute<any[]>(
      `SELECT DISTINCT c.ClientID, c.ClientName
       FROM client_rate cr
       INNER JOIN client c ON c.ClientID = cr.ClientID
       INNER JOIN payroll_rate pr ON pr.PayrollRateID = cr.PayrollRateID
       INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID
       INNER JOIN agency a ON a.AgencyID = ap.AgencyID
       WHERE cr.Status = 'Active' AND c.Status = 'Active' AND pr.Status = 'Active'
         AND ap.Status = 'Active' AND a.Status = 'Active'
         ${agencyId ? 'AND a.AgencyID = ?' : ''}
       ORDER BY c.ClientName`,
      agencyId ? [agencyId] : []
    )
  ])

  return { agencies: agenciesResult[0], clients: clientsResult[0] }
})
