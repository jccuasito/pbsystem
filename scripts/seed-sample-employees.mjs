import mysql from 'mysql2/promise'

// Local test data only. Re-running fills each active agency to 50 employees
// and repairs duplicate sample names without touching non-sample employees.
const targetPerAgency = 50
const dryRun = process.argv.includes('--dry-run')
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
const normalizedName = (firstName, lastName) =>
  `${String(firstName || '').trim().toUpperCase()}\u001f${String(lastName || '').trim().toUpperCase()}`

function unusedName(usedNames, start) {
  const combinations = firstNames.length * lastNames.length
  for (let offset = 0; offset < combinations; offset++) {
    const index = (start + offset) % combinations
    const firstName = firstNames[index % firstNames.length]
    const lastName = lastNames[Math.floor(index / firstNames.length)]
    if (!usedNames.has(normalizedName(firstName, lastName))) return { firstName, lastName }
  }
  throw new Error('The sample name pool has no unused first/last-name combinations.')
}

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
    SELECT e.EmployeeID, e.FirstName, e.LastName, e.Nickname, ap.AgencyID
    FROM employee e
    INNER JOIN agency_position ap ON ap.AgencyPositionID = e.AgencyPositionID
    ORDER BY e.EmployeeID
    FOR UPDATE
  `)
  // Reserve every real employee's name first, then keep the first occurrence
  // of each sample name. Only marked sample rows may be renamed.
  const usedNames = new Set(employees.filter(row => row.Nickname !== 'SAMPLE DATA')
    .map(row => normalizedName(row.FirstName, row.LastName)))
  const duplicateSamples = []
  for (const employee of employees.filter(row => row.Nickname === 'SAMPLE DATA')) {
    const key = normalizedName(employee.FirstName, employee.LastName)
    if (usedNames.has(key)) duplicateSamples.push(employee)
    else usedNames.add(key)
  }
  for (const employee of duplicateSamples) {
    const { firstName, lastName } = unusedName(usedNames, Number(employee.EmployeeID) * 37)
    await connection.execute(
      "UPDATE employee SET FirstName = ?, LastName = ? WHERE EmployeeID = ? AND Nickname = 'SAMPLE DATA'",
      [firstName, lastName, employee.EmployeeID],
    )
    usedNames.add(normalizedName(firstName, lastName))
  }
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
      const { firstName, lastName } = unusedName(usedNames, agencyId * 97 + sequence * 37)
      sequence++
      const position = [...positions].sort((a, b) => a.count - b.count || a.id - b.id)[0]
      await connection.execute(
        "INSERT INTO employee (AgencyPositionID, FirstName, LastName, Nickname, Status) VALUES (?, ?, ?, 'SAMPLE DATA', 'Active')",
        [position.id, firstName, lastName],
      )
      usedNames.add(normalizedName(firstName, lastName))
      position.count++
      count++
      added++
    }
    results.push({ agency: agency.AgencyName, total: count, added, positions: positions.map(({ name, count }) => ({ name, count })) })
  }

  const [duplicateNames] = await connection.execute(`
    SELECT UPPER(TRIM(FirstName)) AS FirstName, UPPER(TRIM(LastName)) AS LastName,
      COUNT(*) AS NameCount, SUM(Nickname = 'SAMPLE DATA') AS SampleCount
    FROM employee
    GROUP BY UPPER(TRIM(FirstName)), UPPER(TRIM(LastName))
    HAVING COUNT(*) > 1
  `)
  if (duplicateNames.some(row => Number(row.SampleCount) > 0)) {
    throw new Error('Sample employee names are still duplicated; no changes were committed.')
  }

  if (dryRun) await connection.rollback()
  else await connection.commit()
  console.log(`${dryRun ? 'Would clear' : 'Cleared'} ${clearedNumbers.affectedRows} sample employee numbers.`)
  console.log(`${dryRun ? 'Would rename' : 'Renamed'} ${duplicateSamples.length} duplicate sample employees.`)
  console.log(`Remaining repeated first/last names outside sample data: ${duplicateNames.length}.`)
  console.log(JSON.stringify(results, null, 2))
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  await connection.end()
}
