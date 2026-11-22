import { createError } from 'h3'

/** Check before inserting payroll/receipt rows: a packet failure would close
 * the DB connection instead of returning a useful validation response. */
export async function payrollSnapshotJson(connection: any, snapshot: unknown) {
  const json = JSON.stringify(snapshot)
  const [[config]] = await connection.execute('SELECT @@max_allowed_packet AS MaxPacketBytes')
  // Reserve space for SQL and the other prepared-statement parameters.
  const budget = Math.max(0, Number(config.MaxPacketBytes) - 65536)
  if (Buffer.byteLength(json, 'utf8') > budget) {
    throw createError({ statusCode: 413, statusMessage: 'Payroll details exceed the database transfer limit. No payroll was posted. Contact your administrator before trying again.' })
  }
  return json
}
