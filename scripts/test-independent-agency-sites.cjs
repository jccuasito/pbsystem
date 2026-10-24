const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{transformSync}=require('esbuild')
function organization(db){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync('server/utils/organizationCrud.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module,require:name=>name==='h3'?{createError:d=>Object.assign(new Error(d.statusMessage),d),getRouterParam:e=>e.resource,readBody:async e=>e.body}:name.endsWith('/auth')?{requireSession:()=>({sub:1,userType:'Admin'})}:name.includes('dbconnect')?db:{}});return module.exports}
test('site split, history preservation, independent edits/status and rollback use temporary tables',{skip:process.env.SITE_ACCOUNTS_TEST_DATABASE!=='1'},async()=>{
 const db=await require('mysql2/promise').createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'pbsystem'})
 const {splitAgencySites}=await import('../server/utils/splitAgencySites.mjs')
 try{
  const policy=['NDEnabled','DayShiftNDEnabled','NDStartTime','NDEndTime','AutoBreakEnabled','DefaultBreakMinutes','RelieverPositionOverrideEnabled','AutoWDOEnabled','SundayWDOOTEnabled','GraceMinutes','LateAfterMinutes','ComputeLate','ComputeUndertime','ComputeOT','ComputeHoliday','ComputeRestDay','Status','CreatedAt']
  for(const sql of [
   'CREATE TEMPORARY TABLE site(SiteID INT AUTO_INCREMENT PRIMARY KEY,ClientID INT,RegionID INT,SiteName VARCHAR(150),SiteAddress VARCHAR(255),LogoData BLOB,LogoMimeType VARCHAR(50),Status VARCHAR(20),SiteAccountID INT)',
   'CREATE TEMPORARY TABLE site_agency(SiteID INT,AgencyID INT,Status VARCHAR(20),SiteAccountID INT,PRIMARY KEY(SiteID,AgencyID))',
   'CREATE TEMPORARY TABLE agency(AgencyID INT PRIMARY KEY,Status VARCHAR(20),AgencyName VARCHAR(100))',
   'CREATE TEMPORARY TABLE site_account(SiteAccountID INT PRIMARY KEY,SiteAccountName VARCHAR(150),Status VARCHAR(20))',
   'CREATE TEMPORARY TABLE payroll_rate(PayrollRateID INT PRIMARY KEY,AgencyPositionID INT)',
   'CREATE TEMPORARY TABLE agency_position(AgencyPositionID INT PRIMARY KEY,AgencyID INT)',
   'CREATE TEMPORARY TABLE site_rate(SiteRateID INT PRIMARY KEY,SiteID INT,PayrollRateID INT,Status VARCHAR(20))',
   'CREATE TEMPORARY TABLE shift_code(ShiftCodeID INT PRIMARY KEY,AgencyID INT)',
   'CREATE TEMPORARY TABLE site_shift(SiteShiftID INT PRIMARY KEY,SiteID INT,ShiftCodeID INT)',
   'CREATE TEMPORARY TABLE employee_deployment(DeploymentID INT PRIMARY KEY,SiteID INT,SiteRateID INT,SiteShiftID INT)',
   'CREATE TEMPORARY TABLE attendance_dtr(BatchID INT PRIMARY KEY,SiteID INT,AgencyID INT)',
   'CREATE TEMPORARY TABLE billing_detail(SiteID INT)',
   'CREATE TEMPORARY TABLE site_special_holiday(SiteSpecialHolidayID INT AUTO_INCREMENT PRIMARY KEY,SiteID INT,HolidayID INT,CreatedAt DATETIME,UpdatedAt DATETIME)',
   `CREATE TEMPORARY TABLE site_policy(SitePolicyID INT AUTO_INCREMENT PRIMARY KEY,SiteID INT,${policy.map(key=>key+' VARCHAR(50) NULL').join(',')})`,
  ])await db.query(sql)
  await db.query("INSERT INTO site(ClientID,RegionID,SiteName,Status) VALUES(1,1,'Example shared site','Inactive')")
  await db.query("INSERT INTO site(SiteID,SiteName,Status) VALUES(99,'Unrelated site','Inactive')");await db.query("INSERT INTO site_agency VALUES(1,1,'Active',11),(1,2,'Active',12),(99,1,'Active',11)")
  await db.query("INSERT INTO agency VALUES(1,'Active','A'),(2,'Active','B')")
  await db.query("INSERT INTO site_account VALUES(11,'Group A','Active'),(12,'Group B','Active')")
  await db.query('INSERT INTO agency_position VALUES(1,1),(2,2)');await db.query('INSERT INTO payroll_rate VALUES(1,1),(2,2)')
  await db.query("INSERT INTO site_rate VALUES(101,1,1,'Active'),(102,1,2,'Active')")
  await db.query('INSERT INTO shift_code VALUES(1,1),(2,2)');await db.query('INSERT INTO site_shift VALUES(201,1,1),(202,1,2)')
  await db.query('INSERT INTO employee_deployment VALUES(301,1,101,201),(302,1,102,202)');await db.query('INSERT INTO attendance_dtr VALUES(401,1,1),(402,1,2)')
  await db.query("INSERT INTO site_policy(SiteID,AutoBreakEnabled) VALUES(1,'1')");await db.query('INSERT INTO site_special_holiday(SiteID,HolidayID) VALUES(1,55)')
  const [originalLinks]=await db.query('SELECT * FROM site_agency')
  let writes=0
  const fail={beginTransaction:()=>db.beginTransaction(),commit:()=>db.commit(),rollback:()=>db.rollback(),execute:async(sql,args)=>{if(sql.startsWith('UPDATE attendance_dtr')&&++writes===1)throw new Error('Synthetic split failure');return db.execute(sql,args)}}
  await assert.rejects(()=>splitAgencySites(fail,{siteIds:[1],restoreSiteIds:[1]}),/Synthetic split failure/)
  const [[count]]=await db.query('SELECT COUNT(*) AS total FROM site');assert.equal(count.total,2)
  const [rolledBack]=await db.query('SELECT * FROM site_agency');assert.deepEqual(rolledBack,originalLinks)
  const changes=await splitAgencySites(db,{siteIds:[1],restoreSiteIds:[1]});assert.equal(changes.length,1)
  const clone=changes[0].siteId
  const [sites]=await db.query('SELECT SiteID,Status FROM site WHERE SiteID<>99');assert.equal(sites.length,2);const [[unrelated]]=await db.query('SELECT Status FROM site WHERE SiteID=99');assert.equal(unrelated.Status,'Inactive','Scoped restoration cannot activate another site');assert.ok(sites.every(row=>row.Status==='Active'))
  for(const [table,key,first,second] of [['site_rate','SiteRateID',101,102],['site_shift','SiteShiftID',201,202],['employee_deployment','DeploymentID',301,302],['attendance_dtr','BatchID',401,402]]){
   const [rows]=await db.query('SELECT '+key+',SiteID FROM '+table+' ORDER BY '+key);assert.equal(rows[0][key],first);assert.equal(rows[0].SiteID,1);assert.equal(rows[1][key],second);assert.equal(rows[1].SiteID,clone)
  }
  assert.equal((await splitAgencySites(db,{siteIds:[1]})).length,0,'Rerun does not duplicate sites')
  await db.query('ALTER TABLE site_agency ADD UNIQUE KEY uq_site_single_agency(SiteID)')
  await assert.rejects(()=>db.execute("INSERT INTO site_agency VALUES(1,3,'Active',11)"),e=>e.code==='ER_DUP_ENTRY')
  const connection={execute:(...args)=>db.execute(...args),beginTransaction:()=>db.beginTransaction(),commit:()=>db.commit(),rollback:()=>db.rollback(),release(){}}
  const org=organization({...connection,getConnection:async()=>connection})
  const body={id:clone,ClientID:1,RegionID:1,SiteName:'Independent B',SiteAddress:'B only',Status:'Active',AgencyIDs:[2],SiteAccountID:12}
  await org.deleteOrganizationResource({resource:'site',body:{id:clone}})
  let [[other]]=await db.query('SELECT Status,SiteName FROM site WHERE SiteID=1');assert.equal(other.Status,'Active');assert.equal(other.SiteName,'Example shared site')
  await org.updateOrganizationResource({resource:'site',body});[[other]]=await db.query('SELECT SiteName FROM site WHERE SiteID=1');assert.equal(other.SiteName,'Example shared site')
  await assert.rejects(()=>org.updateOrganizationResource({resource:'site',body:{...body,AgencyIDs:[1]}}),e=>e.statusCode===409)
  await assert.rejects(()=>org.createOrganizationResource({resource:'site',body:{...body,AgencyIDs:[1,2]}}),e=>e.statusCode===400)
  await db.execute("UPDATE site_policy SET AutoBreakEnabled='0' WHERE SiteID=?",[clone]);const [[policyA]]=await db.query('SELECT AutoBreakEnabled FROM site_policy WHERE SiteID=1');assert.equal(policyA.AutoBreakEnabled,'1')
 }finally{await db.end()}
})
