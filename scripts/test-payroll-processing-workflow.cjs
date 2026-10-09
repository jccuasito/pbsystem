const { test } = require('node:test')
const assert = require('node:assert/strict')

test('compute, approve, reject, and audit a temporary DTR', {
  skip: process.env.PAYROLL_WORKFLOW_TEST_DATABASE !== '1',
}, async () => {
  const mysql = require('mysql2/promise')
  const jwt = require('jsonwebtoken')
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'pbsystem', timezone: 'Z',
  })
  let batchId = null
  const base = process.env.PAYROLL_WORKFLOW_TEST_URL || 'http://localhost:3100'
  try {
    const [[owner]] = await connection.execute("SELECT UserID, Email, UserType FROM user WHERE UserType = 'Admin' AND Status = 'Active' LIMIT 1")
    const [[site]] = await connection.execute('SELECT AgencyID, ClientID, SiteID FROM attendance_dtr LIMIT 1')
    assert.ok(owner && site, 'An active admin and a DTR site are needed for this database check')
    const cookie = 'pbs_session=' + jwt.sign({ sub: owner.UserID, email: owner.Email, userType: owner.UserType },
      process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'pbsystem', audience: 'pbsystem-web' })
    const request = async (path, body) => {
      const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
        headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined })
      const value = await response.json()
      assert.equal(response.status, 200, value.statusMessage || value.message || JSON.stringify(value))
      return value
    }
    const [insert] = await connection.execute(`INSERT INTO attendance_dtr
      (AgencyID, ClientID, SiteID, PeriodStart, PeriodEnd, Status, CreatedBy)
      VALUES (?, ?, ?, '2099-01-01', '2099-01-15', 'Draft', ?)`,
    [site.AgencyID, site.ClientID, site.SiteID, owner.UserID])
    batchId = insert.insertId
    assert.equal((await request(`/api/attendance/dtr/${batchId}/compute`, { target: 'payroll' })).status, 'Computed to Payroll')
    assert.equal((await request(`/api/attendance/dtr/${batchId}/compute`, { target: 'billing' })).status, 'Computed to Both')
    assert.equal((await request(`/api/payroll/processing/${batchId}`, { action: 'approve' })).reviewStatus, 'Approved')
    const approved = await request('/api/payroll/processing?periodStart=2099-01-01&periodEnd=2099-01-15')
    assert.equal(approved.sites[0].ReviewStatus, 'Approved')
    assert.deepEqual(approved.sites[0].history.map(entry => entry.Action), ['Approve Payroll', 'Compute Billing', 'Compute Payroll'])
    assert.equal(approved.sites[0].history[0].ActorRole, 'Admin')
    assert.equal((await request(`/api/payroll/processing/${batchId}`, { action: 'reject', reason: 'Correct the DTR hours.' })).dtrStatus, 'Draft')
    const rejected = await request('/api/payroll/processing?periodStart=2099-01-01&periodEnd=2099-01-15')
    assert.equal(rejected.sites[0].ReviewStatus, 'Rejected')
    assert.equal(rejected.sites[0].history[0].Action, 'Reject Payroll')
    const [[row]] = await connection.execute('SELECT Status FROM attendance_dtr WHERE BatchID = ?', [batchId])
    assert.equal(row.Status, 'Draft')
    assert.equal((await request(`/api/attendance/dtr/${batchId}/compute`, { target: 'payroll' })).status, 'Computed to Payroll')
    const recomputed = await request('/api/payroll/processing?periodStart=2099-01-01&periodEnd=2099-01-15')
    assert.equal(recomputed.sites[0].ReviewStatus, 'Pending')
    assert.equal(recomputed.sites[0].history.length, 5)
  } finally {
    if (batchId) {
      await connection.execute('DELETE FROM dtr_workflow_event WHERE BatchID = ?', [batchId])
      await connection.execute('DELETE FROM payroll_processing_review WHERE BatchID = ?', [batchId])
      await connection.execute('DELETE FROM attendance_dtr WHERE BatchID = ?', [batchId])
    }
    await connection.end()
  }
})
