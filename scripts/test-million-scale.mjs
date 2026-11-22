import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { millionRuntime } from './helpers/million-runtime.mjs'
import { millionSites, millionPeriod, resourceCheck } from './helpers/million-fixture.mjs'
import { dayRecord, rates } from './helpers/scale-fixture.mjs'

const phase = process.argv[2]
const cursorFor = (id,kind) => Buffer.from(JSON.stringify({kind,values:[`WORKER ${String(id).padStart(6,'0')}`,'SYNTHETIC',kind==='employee'?`MILLION-${String(id).padStart(6,'0')}`:null,id]})).toString('base64url')
const summary = rows => {
  const sorted = rows.map(r => r.ms).sort((a, b) => a - b)
  return { requests: rows.length, statuses: rows.reduce((s, r) => (s[r.status] = (s[r.status] || 0) + 1, s), {}),
    p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1), bytes: rows.reduce((s, r) => s + r.bytes, 0) }
}
function expected(id) {
  const site = millionSites[Math.floor((id - 1) / 2000)], pos = (id - 1) % 3 + 1
  let gross = 10000, deductions = 7500
  for (let day = 1; day <= 15; day++) {
    const r = dayRecord(id, day, 0), p = rates(pos, site.region, day >= 8)
    for (const [field, price] of [['RegularHours', 'RegularRate'], ['OTHours', 'OTRate'], ['NightDiffHours', 'NightDiffRate'], ['RestDayHours', 'RestDayRate']]) gross += Math.round(r[field] * p[price] * 100)
    deductions += Math.round(r.LateHours * p.RegularRate * 100) + Math.round(r.UndertimeHours * p.RegularRate * 100)
  }
  deductions += (id % 3 === 0 && id % 30 !== 0 ? 50000 : 0) + (id % 4 === 0 ? 12500 : 0) + (id % 5 === 0 ? 5000 : 0)
  return { gross, deductions, net: gross - deductions }
}
await millionRuntime(phase, async ({ db, request, parallel, note, rows, portal, folder }) => {
  if (phase === 'packet-guard') {
    const [[before]] = await db.execute("SELECT COUNT(*) AS n FROM payroll_processing_posting WHERE BatchID=2 AND Status='Active'")
    assert.equal(Number(before.n), 0)
    await request('/api/payroll/processing/2', { action: 'finalize' }, { status: [413] })
    const [[after]] = await db.execute("SELECT COUNT(*) AS n FROM payroll_processing_posting WHERE BatchID=2 AND Status='Active'")
    assert.equal(Number(after.n), 0)
    note('Oversized payroll rejected with 413 before posting; transaction remains usable')
  } else if (phase === 'preview-bounded') {
    for (const page of [1, 2, 25]) {
      const result = await request(`/api/payroll/processing?page=${page}&pageSize=25&periodStart=${millionPeriod.start}&periodEnd=${millionPeriod.end}`)
      assert.equal(result.pagination.pageSize, 1); assert.equal(result.items.length, 1)
      assert.equal(result.items[0].employees.length, 2000)
    }
    note('Large-roster payroll previews bound 25 requested sites to one 2,000-person site; pages remain stable')
  } else if (phase === 'preview-baseline') {
    const [batches] = await db.execute("SELECT BatchID FROM attendance_dtr WHERE BatchID<=25 AND Status='Draft' ORDER BY BatchID")
    await parallel(batches, 2, batch => request(`/api/attendance/dtr/${batch.BatchID}/compute`, { target: 'payroll' }))
    const before = rows.length
    await request(`/api/payroll/processing?page=1&pageSize=25&periodStart=${millionPeriod.start}&periodEnd=${millionPeriod.end}`, undefined, { capture: true, timeout: 60000 })
    note('Default payroll preview with 25 sites / 50,000 employees', summary(rows.slice(before)))
  } else if (phase === 'batch-preflight') {
    const [[config]] = await db.execute('SELECT @@global.max_allowed_packet AS maxPacket')
    const [[batch]] = await db.execute('SELECT Status FROM attendance_dtr WHERE BatchID=1')
    if (batch.Status === 'Draft') await request('/api/attendance/dtr/1/compute', { target: 'payroll' })
    const before = rows.length
    await request(`/api/payroll/processing?page=1&pageSize=1&periodStart=${millionPeriod.start}&periodEnd=${millionPeriod.end}`)
    note('Single 2,000-person site preview and database packet limit', { ...summary(rows.slice(before)), maxPacket: Number(config.maxPacket) })
    await request('/api/payroll/processing/1', { action: 'finalize' })
    const [payrolls] = await db.execute("SELECT p.EmployeeID,p.GrossPay,p.TotalDeduction,p.NetPay FROM payroll p JOIN payroll_processing_posting pp ON pp.PayrollID=p.PayrollID WHERE pp.BatchID=1 AND pp.Status='Active'")
    assert.equal(payrolls.length, 2000)
    for (const row of payrolls) { const value=expected(Number(row.EmployeeID)); for (const [column,key] of [['GrossPay','gross'],['TotalDeduction','deductions'],['NetPay','net']]) assert.equal(Math.round(Number(row[column])*100),value[key]) }
    note('Single 2,000-person site can finalize')
  } else if (phase === 'directory') {
    for (const [table, count] of [['employee', 1_000_000], ['agency', 4], ['site', 500], ['client', 150], ['attendance', 15_000_000], ['employee_portal_account', 1_000_000], ['employee_portal_session', 1_000_000]]) {
      const [[row]] = await db.execute(`SELECT COUNT(*) AS n FROM \`${table}\``); assert.equal(Number(row.n), count)
    }
    for (const page of [1, 2]) {
      const result = await request(`/api/employees?page=${page}&pageSize=25&includeLookups=0`)
      assert.equal(result.pagination.total, 1_000_000); assert.equal(result.items.length, 25)
    }
    await request('/api/employees?page=40000&pageSize=25&includeLookups=0',undefined,{status:[400]})
    const deep = await request(`/api/employees?page=2&pageSize=25&includeLookups=0&after=${cursorFor(990000,'employee')}`)
    assert.equal(deep.items[0].EmployeeID,990001);assert.equal(deep.items.length,25)
    const result = await request('/api/employees?page=1&search=EMP-1000000&includeLookups=0')
    assert.equal(result.items.length, 1); assert.equal(result.items[0].EmployeeID, 1_000_000)
    const other = await request('/api/employees?page=1&agencyId=4&positionId=2&includeLookups=0')
    const [[count]] = await db.execute('SELECT COUNT(*) AS n FROM employee e JOIN agency_position ap ON ap.AgencyPositionID=e.AgencyPositionID WHERE ap.AgencyID=4 AND ap.PositionID=2')
    assert.equal(other.pagination.total, Number(count.n))
    await request('/api/employees',undefined,{status:[413]})
    const query='page=1&pageSize=1&batchId=1&status=Approved&periodStart=2026-09-01&periodEnd=2026-09-15&includeLookups=0'
    const detailed=await request('/api/payroll/processing?'+query)
    const compact=await request('/api/payroll/processing?'+query+'&includeEmployees=0')
    assert.equal(Object.hasOwn(compact.items[0],'employees'),false)
    for(const key of ['peopleCount','gross','deductions','netPreview'])assert.equal(Number(compact.items[0][key]),Number(detailed.items[0][key]))
    note('Frozen payroll summary equals detailed amounts without returning employee breakdowns')
    note('One million employee directory/count/deep cursor/ID search/agency-position checks pass; oversized numeric offset rejected')
  } else if (phase === 'payroll' || phase === 'pilot') {
    const [[storage]]=await db.query('SELECT @@datadir AS directory')
    if(phase==='payroll'){
      const [targets]=await db.execute("SELECT d.BatchID,d.Status FROM attendance_dtr d WHERE NOT EXISTS(SELECT 1 FROM payroll_processing_posting p WHERE p.BatchID=d.BatchID AND p.Status='Active') ORDER BY d.BatchID LIMIT 2")
      if(targets.length===2){
        for(const target of targets)if(target.Status==='Draft')await request(`/api/attendance/dtr/${target.BatchID}/compute`,{target:'payroll'})
        let failure;const writers=[]
        await db.beginTransaction()
        try{
          await db.execute('SELECT BatchID FROM attendance_dtr WHERE BatchID IN (?,?) FOR UPDATE',targets.map(t=>t.BatchID))
          for(const target of targets)writers.push(request(`/api/payroll/processing/${target.BatchID}`,{action:'finalize'}).then(value=>({value}),error=>({error})))
          let busy=false
          for(let i=0;i<40;i++){
            const health=await request('/api/settings/health');if(health.requests.heavy===2){busy=true;break}
            await new Promise(r=>setTimeout(r,100))
          }
          assert.ok(busy,'Both controlled financial requests must occupy their execution slots')
          const frozen=await request('/api/payroll/processing?page=1&pageSize=1&batchId=1&status=Approved&includeEmployees=0&periodStart=2026-09-01&periodEnd=2026-09-15')
          assert.equal(frozen.items[0].detailsLoaded,false)
          note('Frozen finalized payroll summary remains available with both financial execution slots occupied')
        }catch(error){failure=error}
        finally{
          await db.rollback()
          const outcomes=await Promise.all(writers);failure||=outcomes.find(r=>r.error)?.error
        }
        if(failure)throw failure
      }
    }
    const samples=[],sampleErrors=[];let completedSites=0
    // Workflow GETs can meet the intentionally saturated admission limit. Keep
    // every 503 measurement, then retry only the read after its cooldown. Never
    // automatically repeat a financial POST with an uncertain outcome.
    async function workflowRead(route,options={}){
      for(let attempt=0;attempt<6;attempt++){
        const response=await request(route,undefined,{...options,capture:true})
        if(response.status===200)return response.result
        if(response.status!==503||attempt===5)throw Error(`Workflow read failed: ${response.status} ${route}`)
        note('Workflow GET delayed by admission backpressure',{route,attempt:attempt+1})
        await new Promise(resolve=>setTimeout(resolve,3000))
      }
    }
    const limit = phase === 'pilot' ? 2 : 500
    const [batches] = await db.execute('SELECT BatchID,Status FROM attendance_dtr WHERE BatchID<=? ORDER BY BatchID', [limit])
    await parallel(batches, 2, async batch => {
      await Promise.all(samples)
      if(sampleErrors.length)throw sampleErrors[0]
      resourceCheck(storage.directory)
      const [[done]] = await db.execute("SELECT COUNT(*) AS n FROM payroll_processing_posting WHERE BatchID=? AND Status='Active'", [batch.BatchID])
      if (!Number(done.n)) {
        if (batch.Status === 'Draft') await request(`/api/attendance/dtr/${batch.BatchID}/compute`, { target: 'payroll' }, { staff: (batch.BatchID - 1) % 100 + 1 })
        await request(`/api/payroll/processing/${batch.BatchID}`, { action: 'finalize' }, { staff: (batch.BatchID - 1) % 100 + 1 })
      }
      const [payroll] = await db.execute("SELECT p.EmployeeID,p.GrossPay,p.TotalDeduction,p.NetPay FROM payroll p JOIN payroll_processing_posting pp ON pp.PayrollID=p.PayrollID WHERE pp.BatchID=? AND pp.Status='Active'", [batch.BatchID])
      assert.equal(payroll.length, 2000)
      for (const row of payroll) { const value = expected(Number(row.EmployeeID)); for (const [column, key] of [['GrossPay', 'gross'], ['TotalDeduction', 'deductions'], ['NetPay', 'net']]) assert.equal(Math.round(Number(row[column]) * 100), value[key], `Employee ${row.EmployeeID} ${column}`) }
      const [lines] = await db.execute(`SELECT p.EmployeeID,p.NetPay,
        (SELECT COALESCE(SUM(d.Amount),0) FROM payroll_detail d WHERE d.PayrollID=p.PayrollID)
        -(SELECT COALESCE(SUM(d.Amount),0) FROM payroll_deduction d WHERE d.PayrollID=p.PayrollID) AS LineNet
        FROM payroll p JOIN payroll_processing_posting pp ON pp.PayrollID=p.PayrollID WHERE pp.BatchID=? AND pp.Status='Active'`,[batch.BatchID])
      for(const line of lines)assert.equal(Math.round(Number(line.LineNet)*100),Math.round(Number(line.NetPay)*100))
      const low=(Number(batch.BatchID)-1)*2000+1,high=Number(batch.BatchID)*2000
      const [balances]=await db.execute("SELECT 'Loan' AS kind,EmployeeID,RemainingBalance FROM employee_loan WHERE EmployeeID BETWEEN ? AND ? UNION ALL SELECT 'Deduction',EmployeeID,RemainingBalance FROM employee_deduction WHERE EmployeeID BETWEEN ? AND ?",[low,high,low,high])
      for(const balance of balances)assert.equal(Number(balance.RemainingBalance),balance.kind==='Loan'?(Number(balance.EmployeeID)%30===0?6000:5500):875)
      const roster = await workflowRead('/api/payroll/payslips/sites?batchId=' + batch.BatchID)
      const employeeIds = payroll.map(p => Number(p.EmployeeID))
      if(!roster.items.every(person=>person.cutoffs.length&&person.cutoffs.every(cutoff=>cutoff.publicationStatus==='Posted')))
        await request('/api/payroll/payslips/sites', { batchId: batch.BatchID, employeeIds, action: 'post', reviewToken: roster.reviewToken }, { staff: (batch.BatchID - 1) % 100 + 1 })
      const own = await workflowRead('/api/employee-portal/payslips', { cookie: portal(employeeIds[0]) })
      assert.equal(own.payslips.length, 1); assert.equal(own.payslips[0].employee.EmployeeID, employeeIds[0])
      note('Finalized and posted verified site', { batch: batch.BatchID, employees: 2000 })
      completedSites++
      if(phase==='payroll'&&[50,250,450].includes(completedSites)){
        const milestone=completedSites,begin=rows.length
        const sample=parallel(Array.from({length:200},(_,i)=>i),200,async i=>{
          if(i<100)await request(`/api/employees?page=2&pageSize=25&includeLookups=0&after=${cursorFor((i*7919)%950000+1000,'employee')}`,undefined,{staff:i+1,capture:true,discardResult:true,timeout:60000})
          else{const id=((i-100)*37)%4000+1;const response=await request('/api/employee-portal/payslips',undefined,{cookie:portal(id),capture:true,timeout:60000});if(response.status===200)for(const slip of response.result.payslips)assert.equal(Number(slip.employee.EmployeeID),id)}
        }).then(()=>note('100 staff readers plus 100 portal readers while payroll/payslip workers run',{milestone,...summary(rows.slice(begin))})).catch(error=>sampleErrors.push(error))
        samples.push(sample)
      }
    })
    await Promise.all(samples);if(sampleErrors.length)throw sampleErrors[0]
    if(phase==='payroll'){
      const [[counts]]=await db.execute("SELECT (SELECT COUNT(*) FROM payroll WHERE Status='Approved') AS payrolls,(SELECT COUNT(*) FROM payslip_publication WHERE Status='Posted') AS payslips,(SELECT COUNT(*) FROM employee_account_transaction WHERE Status='Posted') AS receipts")
      assert.equal(Number(counts.payrolls),1_000_000);assert.equal(Number(counts.payslips),1_000_000);assert.equal(Number(counts.receipts),550000)
      note('All one million payrolls, posted payslips and 550,000 deduction receipts verified',counts)
    }
  } else if (phase === 'burst') {
    const [ready]=await db.execute('SELECT BatchID,Status FROM attendance_dtr WHERE BatchID BETWEEN 3 AND 102 ORDER BY BatchID')
    await parallel(ready,2,async batch=>{
      if(batch.Status==='Draft')await request(`/api/attendance/dtr/${batch.BatchID}/compute`,{target:'payroll'},{staff:(batch.BatchID-1)%100+1})
    })
    note('All 100 distinct target DTRs prepared before simultaneous finalization submissions')
    const begin = rows.length
    const writers=parallel(Array.from({ length: 100 }, (_, i) => i), 100, i =>
      request(`/api/payroll/processing/${i + 3}`, { action: 'finalize' }, { staff: i + 1, capture: true }))
    const frozenRead=(async()=>{
      await new Promise(r=>setTimeout(r,300))
      const health=await request('/api/settings/health')
      assert.equal(health.requests.heavy,2,'Both financial execution slots must be occupied')
      const result=await request('/api/payroll/processing?page=1&pageSize=1&batchId=1&status=Approved&includeEmployees=0&periodStart=2026-09-01&periodEnd=2026-09-15')
      assert.equal(result.items[0].detailsLoaded,false)
      note('Frozen payroll summary remains readable while both financial slots are busy')
    })()
    const outcomes=await Promise.allSettled([writers,frozenRead]);for(const result of outcomes)if(result.status==='rejected')throw result.reason
    const submitted=rows.slice(begin).filter(r=>r.method==='POST')
    note('100 distinct staff sessions submit simultaneous payroll finalizations; busy responses are backpressure', summary(submitted))
    assert.ok(submitted.every(r => [200, 409, 503].includes(r.status)), 'Unexpected burst failure')
    await request('/api/employee-portal/payslips', undefined, { cookie: portal(1) })
  } else if (phase === 'mixed') {
    const finish = Date.now() + 60000, begin = rows.length
    const workers = parallel([5, 6], 2, async id => {
      const [[batch]] = await db.execute('SELECT Status FROM attendance_dtr WHERE BatchID=?', [id])
      const [[posting]] = await db.execute("SELECT COUNT(*) AS n FROM payroll_processing_posting WHERE BatchID=? AND Status='Active'", [id])
      if (!Number(posting.n)) {
        if (batch.Status === 'Draft') await request(`/api/attendance/dtr/${id}/compute`, { target: 'payroll' }, { staff: id })
        await request(`/api/payroll/processing/${id}`, { action: 'finalize' }, { staff: id })
      }
      const roster = await request('/api/payroll/payslips/sites?batchId=' + id)
      await request('/api/payroll/payslips/sites', { batchId: id, employeeIds: Array.from({ length: 2000 }, (_, i) => (id - 1) * 2000 + i + 1), action: 'post', reviewToken: roster.reviewToken }, { staff: id })
    })
    const readers = parallel(Array.from({ length: 98 }, (_, i) => i), 98, async i => {
      while (Date.now() < finish) {
        const staffMode = i % 2 === 0
        await request(staffMode ? `/api/employees?page=${i + 1}&pageSize=25&includeLookups=0` : '/api/employee-portal/payslips', undefined,
          staffMode ? { staff: i + 3, capture: true, timeout: 60000 } : { cookie: portal((i * 37) % 4000 + 1), capture: true, timeout: 60000 })
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    })
    const outcomes = await Promise.allSettled([workers, readers])
    for (const result of outcomes) if (result.status === 'rejected') throw result.reason
    note('98 distinct readers plus two real payroll/payslip writers on a one-million-employee database', summary(rows.slice(begin)))
  } else if (phase === 'staff-load' || phase === 'portal-load') {
    const [[posted]] = await db.execute("SELECT COUNT(*) AS n FROM payslip_publication WHERE Status='Posted'")
    const portalPopulation = Number(posted.n) === 1_000_000 ? 1_000_000 : 4000
    for (const users of [1, 10, 25, 50, 100]) {
      const begin = rows.length
      await parallel(Array.from({ length: users }, (_, i) => i), users, async i => {
        for (let round = 0; round < 2; round++) {
          if (phase === 'portal-load') {
            const id = (i * 7919 + round * 104729) % portalPopulation + 1
            await request('/employee-portal',undefined,{cookie:portal(id),capture:true,timeout:60000})
            const identity=await request('/api/employee-portal/me',undefined,{cookie:portal(id),capture:true,timeout:60000})
            if(identity.status===200)assert.equal(Number(identity.result.account.EmployeeID),id)
            const response = await request('/api/employee-portal/payslips', undefined, { cookie: portal(id), capture: true, timeout: 60000 })
            if (response.status === 200) {assert.equal(response.result.payslips.length,1);for (const slip of response.result.payslips) assert.equal(Number(slip.employee.EmployeeID), id, 'Employee must only see own payslip')}
          } else {
            const anchor=(i*7919+round*104729)%950000+1000
            const routes = [`/api/employees?page=2&pageSize=25&includeLookups=0&after=${cursorFor(anchor,'employee')}`, '/api/organization/site?page=1&pageSize=25&includeLookups=0', '/api/organization/client?page=1&pageSize=25&includeLookups=0', '/api/attendance/dtr?page=1&pageSize=25&includeLookups=0', `/api/deductions-loans/employee-records?page=2&pageSize=25&after=${cursorFor(anchor,'account')}`, '/api/rates/site-rate?page=1&pageSize=25&includeLookups=0', '/api/payroll/processing?page=1&pageSize=25&includeLookups=0&includeEmployees=0&periodStart=2026-09-01&periodEnd=2026-09-15', '/api/payroll/payslips/sites?page=1&periodStart=2026-09-01&periodEnd=2026-09-15', '/api/payroll/payslips/sites?groupBy=account&page=1&periodStart=2026-09-01&periodEnd=2026-09-15', '/api/billing/drafts']
            for (const route of routes) {
              const response=await request(route,undefined,{staff:i+1,capture:true,discardResult:true,timeout:60000})
              if(response.status===0||(response.status>=500&&response.status!==503))throw Error(`Stopped staff ramp on unexpected ${response.status}: ${route}`)
            }
          }
        }
      })
      note(`${phase} concurrent users ${users}`, summary(rows.slice(begin)))
      const health = await request('/api/settings/health', undefined, { capture: true, timeout: 10000 })
      await writeFile(path.join(folder, `million-${phase}-${users}-health.json`), JSON.stringify(health, null, 2))
      if (health.status !== 200) throw Error('Local test server unresponsive; stopped ramp')
      if (health.result.memoryMb > 1100) throw Error('Stopped ramp: isolated test app RSS exceeds 1.1 GB budget')
    }
  } else if (phase === 'preview') {
    for (const size of [1, 2, 5, 25]) {
      const before = rows.length
      await request(`/api/payroll/processing?page=1&pageSize=${size}&periodStart=${millionPeriod.start}&periodEnd=${millionPeriod.end}`, undefined, { capture: true, timeout: 60000 })
      note(`Payroll preview page size ${size}`, summary(rows.slice(before)))
      const health = await request('/api/settings/health', undefined, { capture: true, timeout: 10000 })
      if (health.status !== 200 || health.result.memoryMb > 1100) throw Error('Stopped oversized preview: app health/memory budget exceeded')
    }
  } else throw Error('Unknown million test phase')
})
