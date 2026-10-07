const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { transformSync } = require('esbuild')

function evaluate(filename, database) {
  const module = { exports: {} }
  const h3 = {
    createError: options => Object.assign(new Error(options.statusMessage), options),
    getRouterParam: event => event.resource,
    readBody: async event => event.body,
  }
  vm.runInNewContext(transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module,
    require: name => name === 'h3' ? h3
      : name === '../connection/dbconnect' ? database
      : name === './auth' ? { requireSession: () => ({ sub: 1 }) }
      : {},
  })
  return module.exports
}

async function run() {
  const env = { ...require('node:util').parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
  const connection = await require('mysql2/promise').createConnection({
    host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root', password: env.DB_PASSWORD,
    database: env.DB_NAME || 'pbsystem', dateStrings: true,
  })
  await connection.beginTransaction()
  try {
    const database = {
      execute: (...args) => connection.execute(...args),
      getConnection: async () => database,
      beginTransaction: () => connection.query('SAVEPOINT site_agency_test'),
      commit: () => connection.query('RELEASE SAVEPOINT site_agency_test'),
      rollback: () => connection.query('ROLLBACK TO SAVEPOINT site_agency_test'),
      release() {},
    }
    const organization = evaluate('server/utils/organizationCrud.ts', database)
    const [[client]] = await connection.execute("SELECT ClientID FROM client WHERE Status = 'Active' LIMIT 1")
    const [[region]] = await connection.execute("SELECT RegionID FROM region WHERE Status = 'Active' LIMIT 1")
    const [positions] = await connection.execute(`SELECT ap.AgencyID, ap.AgencyPositionID FROM agency_position ap
      INNER JOIN agency a ON a.AgencyID = ap.AgencyID WHERE ap.Status = 'Active' AND a.Status = 'Active'
      GROUP BY ap.AgencyID, ap.AgencyPositionID ORDER BY ap.AgencyID`)
    const first = positions[0], second = positions.find(row => row.AgencyID !== first?.AgencyID)
    assert.ok(client && region && first && second, 'Two active agencies with positions, an active client, and a region are required')
    const body = { ClientID: client.ClientID, RegionID: region.RegionID, SiteName: `SITE AGENCY TEST ${Date.now()}`, SiteAddress: '', Status: 'Active', AgencyIDs: [first.AgencyID, second.AgencyID] }
    await assert.rejects(organization.createOrganizationResource({ resource: 'site', body: { ...body, AgencyIDs: [] } }), error => error.statusCode === 400)
    const { id } = await organization.createOrganizationResource({ resource: 'site', body })
    let site = (await organization.listOrganizationResource({ resource: 'site' })).items.find(row => row.SiteID === id)
    assert.deepEqual([...site.AgencyIDs].sort(), [first.AgencyID, second.AgencyID].sort())
    await organization.updateOrganizationResource({ resource: 'site', body: { ...body, id, AgencyIDs: [first.AgencyID] } })
    site = (await organization.listOrganizationResource({ resource: 'site' })).items.find(row => row.SiteID === id)
    assert.deepEqual(Array.from(site.AgencyIDs), [first.AgencyID])
    const [[removed]] = await connection.execute('SELECT Status FROM site_agency WHERE SiteID = ? AND AgencyID = ?', [id, second.AgencyID])
    assert.equal(removed.Status, 'Inactive')
    const [[ratePair]] = await connection.execute(`SELECT pr.PayrollRateID, br.BillingRateID FROM payroll_rate pr
      INNER JOIN billing_rate br ON br.AgencyPositionID = pr.AgencyPositionID
      WHERE pr.AgencyPositionID = ? LIMIT 1`, [first.AgencyPositionID])
    if (ratePair) {
      await connection.execute("INSERT INTO site_rate (SiteID, PayrollRateID, BillingRateID, Status) VALUES (?, ?, ?, 'Active')", [id, ratePair.PayrollRateID, ratePair.BillingRateID])
      await assert.rejects(organization.updateOrganizationResource({ resource: 'site', body: { ...body, id, AgencyIDs: [second.AgencyID] } }), error => error.statusCode === 409)
    }
    console.log('Site agency create, list, and edit checks passed (rolled back).')
  } finally {
    await connection.rollback()
    await connection.end()
  }
}

run().catch(error => { console.error(error); process.exitCode = 1 })
