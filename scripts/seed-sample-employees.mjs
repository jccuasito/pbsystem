import mysql from 'mysql2/promise'

// Local test data only. Re-running fills each active agency to 50 employees
// without changing existing employees or creating deployments or attendance.
const targetPerAgency = 50
const firstNames = [
  'ADRIAN', 'ALYSSA', 'BENJAMIN', 'BIANCA', 'CHRISTIAN', 'CAMILLE',
  'DANIEL', 'DENISE', 'ELIJAH', 'ERICA', 'FRANCIS', 'FIONA',
  'GABRIEL', 'GISELLE', 'HENRY', 'HANNAH', 'IVAN', 'ISABELLE',
  'JEROME', 'JASMINE', 'KEVIN', 'KATRINA', 'LEONARDO', 'LARA',
]
const lastNames = [
  'AGUILAR', 'ALVAREZ', 'ANDRADE', 'AQUINO', 'BALTAZAR', 'BELTRAN',
  'CASTILLO', 'CORTEZ', 'CRUZ', 'DIAZ', 'DOMINGUEZ', 'ESTRADA',
  'FERNANDEZ', 'FLORES', 'GONZALES', 'HERRERA', 'LIM', 'MARTINEZ',
  'MORALES', 'PASCUAL', 'RAMIREZ', 'RIVERA', 'SANTIAGO', 'TORRES',
]

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'pbsystem',
})

try {
  await connection.beginTransaction()
  const [clearedNumbers] = await connection.execute(`
    UPDATE employee
    SET EmployeeNumber = NULL
    WHERE Nickname = 'SAMPLE DATA'
      AND EmployeeNumber REGEXP '^SMP-A[0-9]{2}-[0-9]{3}$'
  `)
  const [agencies] = await connection.execute("SELECT AgencyID, AgencyName FROM agency WHERE Status = 'Active' ORDER BY AgencyID")
  const [assignments] = await connection.execute(`
    SELECT ap.AgencyPositionID, ap.AgencyID, p.PositionName, COUNT(e.EmployeeID) AS EmployeeCount
    FROM agency_position ap
    INNER JOIN \`position\` p ON p.PositionID = ap.PositionID
    LEFT JOIN employee e ON e.AgencyPositionID = ap.AgencyPositionID
    WHERE ap.Status = 'Active' AND p.Status = 'Active'
    GROUP BY ap.AgencyPositionID, ap.AgencyID, p.PositionName
    ORDER BY ap.AgencyID, ap.AgencyPositionID
  `)
  const [employees] = await connection.execute(`
    SELECT e.FirstName, e.LastName, ap.AgencyID
    FROM employee e
    INNER JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
    FOR UPDATE
  `)
  const usedNames = new Set(employees.map(row => `${row.AgencyID}:${row.FirstName}:${row.LastName}`))
  const results = []

  for (const agency of agencies) {
    const agencyId = Number(agency.AgencyID)
    const positions = assignments.filter(row => Number(row.AgencyID) === agencyId).map(row => ({
      id: Number(row.AgencyPositionID),
      name: row.PositionName,
      count: Number(row.EmployeeCount),
    }))
    if (!positions.length) throw new Error(`${agency.AgencyName} has no active position assignment.`)

    let count = employees.filter(row => Number(row.AgencyID) === agencyId).length
    let added = 0
    let sequence = 1
    while (count < targetPerAgency) {
      const nameIndex = sequence - 1
      const firstName = firstNames[(nameIndex + agencyId * 5) % firstNames.length]
      const lastName = lastNames[(nameIndex * 7 + Math.floor(nameIndex / firstNames.length) + agencyId * 3) % lastNames.length]
      const nameKey = `${agencyId}:${firstName}:${lastName}`
      sequence++
      if (usedNames.has(nameKey)) continue
      const position = [...positions].sort((a, b) => a.count - b.count || a.id - b.id)[0]
      await connection.execute(
        "INSERT INTO employee (AgencyPositionID, FirstName, LastName, Nickname, Status) VALUES (?, ?, ?, 'SAMPLE DATA', 'Active')",
        [position.id, firstName, lastName],
      )
      usedNames.add(nameKey)
      position.count++
      count++
      added++
    }
    results.push({ agency: agency.AgencyName, total: count, added, positions: positions.map(({ name, count }) => ({ name, count })) })
  }

  await connection.commit()
  console.log(`Cleared ${clearedNumbers.affectedRows} sample employee numbers.`)
  console.log(JSON.stringify(results, null, 2))
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  await connection.end()
}
