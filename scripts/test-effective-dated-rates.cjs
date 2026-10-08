const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { buildSync, transformSync } = require('esbuild')

const bundled = buildSync({ entryPoints: ['server/utils/rateVersions.ts'], bundle: true, platform: 'node', format: 'cjs', write: false })
const moduleRef = { exports: {} }
vm.runInNewContext(bundled.outputFiles[0].text, { module: moduleRef, exports: moduleRef.exports, require })
const { dateOnly, effectiveAmountSql, snapshotAtDate, todayInPhilippines } = moduleRef.exports

test('rate snapshots select the latest applicable version without changing older dates', () => {
  const base = { RegularRate: 70 }
  const versions = [
    { EffectiveDate: '2026-10-15', RegularRate: 75 },
    { EffectiveDate: '2026-11-01', RegularRate: 80 },
  ]
  assert.equal(snapshotAtDate(base, versions, '2026-10-14').RegularRate, 70)
  assert.equal(snapshotAtDate(base, versions, '2026-10-15').RegularRate, 75)
  assert.equal(snapshotAtDate(base, versions, '2026-11-01').RegularRate, 80)
  assert.match(todayInPhilippines(), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(dateOnly('2026-10-15T00:00:00.000Z'), '2026-10-15')
})

test('a September 25 increase splits a September 16-30 cutoff by work date', () => {
  const oldRate = { EffectiveDate: '2026-01-01', RegularRate: 70 }
  const changes = [{ EffectiveDate: '2026-09-25', RegularRate: 80 }]
  for (let day = 16; day <= 30; day++) {
    const date = `2026-09-${String(day).padStart(2, '0')}`
    assert.equal(snapshotAtDate(oldRate, changes, date).RegularRate, day < 25 ? 70 : 80, date)
  }
})

test('every linked site resolves the new rate on its effective date', { skip: process.env.RATE_VERSION_TEST_DATABASE !== '1' }, async () => {
  const mysql = require('mysql2/promise')
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'pbsystem',
  })
  try {
    await connection.beginTransaction()
    const [[link]] = await connection.execute(`SELECT sr.SiteRateID, sr.PayrollRateID, sr.BillingRateID FROM site_rate sr
      INNER JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID AND pr.Status = 'Active'
      INNER JOIN billing_rate br ON br.BillingRateID = sr.BillingRateID AND br.Status = 'Active'
      WHERE sr.Status = 'Active' LIMIT 1`)
    assert.ok(link, 'A linked site rate is needed for this database check')
    const wrapped = {
      execute: (...args) => connection.execute(...args),
      beginTransaction: () => connection.query('SAVEPOINT rate_version_test'),
      commit: () => connection.query('RELEASE SAVEPOINT rate_version_test'),
      rollback: () => connection.query('ROLLBACK TO SAVEPOINT rate_version_test'),
      release() {},
    }
    const crudModule = { exports: {} }
    vm.runInNewContext(transformSync(fs.readFileSync('server/utils/rateVersionCrud.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
      module: crudModule, exports: crudModule.exports,
      require: name => ({
        h3: { createError: options => Object.assign(new Error(options.statusMessage), options), readBody: async event => event.body },
        '../connection/dbconnect': { getConnection: async () => wrapped },
        './auth': { requireSession: () => ({ sub: 1 }) },
        './rateVersions': moduleRef.exports,
      })[name] || {},
    })
    for (const kind of ['payroll-rate', 'billing-rate']) {
      const payroll = kind === 'payroll-rate'
      const table = payroll ? 'payroll_rate' : 'billing_rate'
      const versionTable = payroll ? 'payroll_rate_version' : 'billing_rate_version'
      const id = payroll ? 'PayrollRateID' : 'BillingRateID'
      const rateId = link[id]
      const [[base]] = await connection.execute(`SELECT RegularRate FROM ${table} WHERE ${id} = ?`, [rateId])
      const newRate = Number(base.RegularRate) + 123.45
      await connection.execute(`INSERT INTO ${versionTable} (${id}, EffectiveDate, RegularRate) VALUES (?, ?, ?)`, [rateId, '2400-01-01', newRate])
      const sql = effectiveAmountSql(kind, 'r', 'RegularRate', 'DATE(?)')
      const [[before]] = await connection.execute(`SELECT ${sql} AS Amount FROM ${table} r WHERE r.${id} = ?`, ['2399-12-31', rateId])
      const [[after]] = await connection.execute(`SELECT ${sql} AS Amount FROM ${table} r WHERE r.${id} = ?`, ['2400-01-01', rateId])
      assert.notEqual(Number(before.Amount), newRate)
      assert.equal(Number(after.Amount), newRate)
      const [[saved]] = await connection.execute(`SELECT RegularRate FROM ${table} WHERE ${id} = ?`, [rateId])
      assert.equal(Number(saved.RegularRate), Number(base.RegularRate), 'The original rate must stay unchanged')
      const created = await crudModule.exports.createRateVersion({ body: { resource: kind, id: rateId, EffectiveDate: '2401-01-01', RegularRate: newRate + 10 } })
      assert.ok(created.id > 0)
      assert.ok(created.linkedSites >= 1)
      const [[newVersion]] = await connection.execute(`SELECT RegularRate FROM ${versionTable} WHERE ${id} = ? AND EffectiveDate = ?`, [rateId, '2401-01-01'])
      assert.equal(Number(newVersion.RegularRate), newRate + 10)
      await assert.rejects(crudModule.exports.createRateVersion({ body: { resource: kind, id: rateId, EffectiveDate: '2400-01-01', RegularRate: 999 } }), error => error.statusCode === 409)
    }
    const [[sameLink]] = await connection.execute('SELECT PayrollRateID, BillingRateID FROM site_rate WHERE SiteRateID = ?', [link.SiteRateID])
    assert.equal(sameLink.PayrollRateID, link.PayrollRateID)
    assert.equal(sameLink.BillingRateID, link.BillingRateID)
  } finally {
    await connection.rollback()
    await connection.end()
  }
})
