const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path')
const {transformSync}=require('esbuild'),h3=require('h3')
function api(db,backup=async()=>null){
 const module={exports:{}}
 const req=name=>name==='h3'?{...h3,readBody:async e=>e.body,getQuery:e=>e.query||{},setHeader:()=>{}}
  :name==='node:crypto'?require(name):name.includes('dbconnect')?db
  :name==='./auth'?{requireSession:e=>{if(e.guest)throw h3.createError({statusCode:401});return{sub:e.userId||11}}}
  :name==='./settingsAccess'?{currentActor:async e=>({UserID:e.userId||11,UserType:e.role||'Viewer'}),accessForUser:async()=>rights}
  :name==='./employeePortalAuth'?{requireEmployeeSession:async e=>{if(e.guest)throw h3.createError({statusCode:401});return e.account||{AccountID:21,EmployeeID:1}}}
  :name.includes('databaseBackup')?{dailyBackupFailure:backup}:name.includes('requestCapacity')?{coalesceRead:(_,f)=>f()}:{}
 vm.runInThisContext('(function(module,require){'+transformSync(fs.readFileSync('server/utils/notificationCrud.ts','utf8'),{loader:'ts',format:'cjs'}).code+'})')(module,req)
 return module.exports
}
let rights={}
const all=()=>Object.fromEntries(['attendance','payroll','payslips','employees'].map(module=>[module,{canView:true,canEdit:true}]))
test('module and role restrictions happen before any source reads',async()=>{
 const calls=[],db={execute:async(sql,args)=>{calls.push({sql,args});return[[{Total:0}]]}}
 const service=api(db,async()=>{throw Error('Backup must be Admin only')})
 assert.deepEqual(await service.staffNotificationItems({UserID:1,UserType:'Viewer'},{},db),[])
 assert.equal(calls.length,0)
 await service.staffNotificationItems({UserID:1,UserType:'Supervisor'},{employees:{canView:true,canEdit:false}},db)
 assert.equal(calls.length,1);assert.match(calls[0].sql,/FROM license/);assert.doesNotMatch(calls[0].sql,/information_request/)
 calls.length=0
 await service.staffNotificationItems({UserID:1,UserType:'Viewer'},{payroll:{canView:true}},db)
 assert.equal(calls.length,1);assert.match(calls[0].sql,/Computed to Payroll/)
 for(const role of ['Supervisor','Encoder','Viewer']){
  calls.length=0
  const items=await service.staffNotificationItems({UserID:1,UserType:role},all(),db)
  assert.equal(items.some(item=>item.kind==='staff-account-setup'),false)
  assert.equal(calls.some(call=>/FROM `user` u/.test(call.sql)),false,'Only Admin may query pending staff registrations')
 }
})
test('notification bodies contain safe summaries and stable revisions, never backup diagnostics',async()=>{
 const db={execute:async()=>[[{Total:2,Latest:5,MissingPunches:1,ChangedAt:'2026-11-15T01:00:00.000Z',Fingerprint:123}]]}
 const service=api(db,async()=>({failedAt:'2026-11-15T01:00:00.000Z',error:'SQL password private/path'}))
 const items=await service.staffNotificationItems({UserID:1,UserType:'Admin'},all(),db,'2026-11-15')
 assert.equal(items.length,7)
 assert.doesNotMatch(JSON.stringify(items),/password|private\/path|SnapshotJson|GovernmentNumber|GrossPay|NetPay/)
 const again=await service.staffNotificationItems({UserID:1,UserType:'Admin'},all(),db,'2026-11-15')
 assert.deepEqual(items.map(i=>i.revision),again.map(i=>i.revision))
 assert.ok(items.every(i=>/^[a-f0-9]{64}$/.test(i.revision)))
})
test('staff and portal notifications require their own authenticated session',async()=>{
 const service=api({execute:()=>{throw Error('Must not query')}})
 for(const handler of ['listStaffNotifications','readStaffNotifications','listEmployeeNotifications','readEmployeeNotifications'])await assert.rejects(()=>service[handler]({guest:true}),e=>e.statusCode===401)
})

test('actual notification queries, per-user read state, source validity and ownership',{skip:process.env.NOTIFICATIONS_TEST_DATABASE!=='1'},async()=>{
 const env={...require('node:util').parseEnv(fs.readFileSync('.env','utf8')),...process.env}
 const c=await require('mysql2/promise').createConnection({host:env.DB_HOST||'127.0.0.1',port:Number(env.DB_PORT||3306),user:env.DB_USER||'root',password:env.DB_PASSWORD,database:env.DB_NAME||'pbsystem',dateStrings:true})
 try{
  // Every mutated table shadows its persistent counterpart on this connection.
  const tables={
   user:'UserID INT PRIMARY KEY,Status VARCHAR(20),CreatedAt DATETIME',
   user_module_permission:'UserID INT,ModuleKey VARCHAR(30)',
   user_history:'UserID INT',
   employee:'EmployeeID INT PRIMARY KEY,Status VARCHAR(20)',
   attendance_dtr:'BatchID INT PRIMARY KEY,SiteID INT,PeriodStart DATE,PeriodEnd DATE,Status VARCHAR(30),CreatedAt DATETIME',
   attendance:'AttendanceID INT PRIMARY KEY,BatchID INT,TimeIn DATETIME NULL,TimeOut DATETIME NULL',
   payroll_processing_posting:'PayrollID INT,EmployeeID INT,BatchID INT,Status VARCHAR(20)',
   payroll:'PayrollID INT PRIMARY KEY,EmployeeID INT,DeploymentID INT,StartDate DATE,EndDate DATE,Status VARCHAR(20)',
   employee_deployment:'DeploymentID INT PRIMARY KEY,SiteID INT,DeploymentType VARCHAR(20)',
   attendance_dtr_employee:'BatchID INT,EmployeeID INT,AttendanceType VARCHAR(20)',
   payslip_publication:'PublicationID INT PRIMARY KEY,EmployeeID INT,GroupKey VARCHAR(150),Status VARCHAR(20),SnapshotJson LONGTEXT,PostedAt DATETIME',
   payslip_publication_source:'PublicationID INT,PayrollID INT',
   payslip_archive:'ArchiveID INT PRIMARY KEY,EmployeeID INT,Status VARCHAR(20),PostedAt DATETIME',
   employee_information_request:'RequestID INT PRIMARY KEY,EmployeeID INT,AccountID INT,Status VARCHAR(20)',
   employee_information_message:'MessageID INT PRIMARY KEY,RequestID INT,Sender VARCHAR(20),CreatedAt DATETIME',
   license:'LicenseID INT PRIMARY KEY,EmployeeID INT,ExpiryDate DATE NULL',
   clearance:'ClearanceID INT PRIMARY KEY,EmployeeID INT,ExpiryDate DATE NULL',
   staff_notification_read:'UserID INT,NotificationKey VARCHAR(100),Revision CHAR(64),ReadAt DATETIME,PRIMARY KEY(UserID,NotificationKey)',
   employee_notification_read:'AccountID INT,NotificationKey VARCHAR(100),Revision CHAR(64),ReadAt DATETIME,PRIMARY KEY(AccountID,NotificationKey)'
  }
  for(const [name,columns]of Object.entries(tables))await c.query('CREATE TEMPORARY TABLE `'+name+'` ('+columns+') ENGINE=InnoDB')
  await c.query("INSERT INTO user VALUES(100,'Inactive',NOW()),(200,'Inactive',NOW()),(300,'Inactive',NOW()),(400,'Active',NOW())")
  await c.query("INSERT INTO user_module_permission VALUES(200,'dashboard')")
  await c.query('INSERT INTO user_history VALUES(300)')
  await c.query("INSERT INTO employee VALUES(1,'Active'),(2,'Active'),(3,'Inactive')")
  await c.query("INSERT INTO attendance_dtr VALUES(1,1,CURDATE(),CURDATE(),'Draft',NOW()),(2,1,CURDATE(),CURDATE(),'Computed to Payroll',NOW()),(3,1,CURDATE(),CURDATE(),'Computed to Both',NOW())")
  await c.query('INSERT INTO attendance VALUES(1,1,NOW(),NULL)')
  await c.query("INSERT INTO employee_deployment VALUES(1,1,'Regular')")
  await c.query("INSERT INTO payroll VALUES(100,1,1,CURDATE(),CURDATE(),'Approved'),(101,1,1,CURDATE(),CURDATE(),'Released'),(200,2,1,CURDATE(),CURDATE(),'Approved')")
  await c.query("INSERT INTO payroll_processing_posting VALUES(100,1,3,'Active'),(101,1,3,'Active'),(200,2,3,'Active')")
  await c.query("INSERT INTO attendance_dtr_employee VALUES(3,1,'Regular'),(3,2,'Regular')")
  const [[date]]=await c.query("SELECT DATE_FORMAT(CURDATE(),'%Y-%m-%d') AS Day")
  const group=date.Day+':'+date.Day+':regular'
  await c.execute("INSERT INTO payslip_publication VALUES(1,1,?,'Posted',?,NOW()),(2,2,?,'Posted',?,NOW())",[group,JSON.stringify({cutoff:{payrollIds:[100]}}),group,JSON.stringify({cutoff:{payrollIds:[200]}})])
  await c.query('INSERT INTO payslip_publication_source VALUES(1,100),(2,200)')
  await c.query("INSERT INTO payslip_archive VALUES(1,1,'Posted',NOW()),(2,2,'Posted',NOW()),(3,1,'Withdrawn',NOW())")
  await c.query("INSERT INTO employee_information_request VALUES(1,1,21,'Pending'),(2,2,22,'Resolved')")
  await c.query("INSERT INTO employee_information_message VALUES(1,1,'Employee',NOW()),(2,2,'Staff',NOW())")
  await c.query('INSERT INTO license VALUES(1,1,DATE_ADD(CURDATE(),INTERVAL 10 DAY)),(2,1,NULL),(3,3,CURDATE())')
  await c.query('INSERT INTO clearance VALUES(1,2,DATE_ADD(CURDATE(),INTERVAL 31 DAY))')
  const connection={execute:(...args)=>c.execute(...args),beginTransaction:()=>c.beginTransaction(),commit:()=>c.commit(),rollback:()=>c.rollback(),release(){}}
  const db={execute:(...args)=>c.execute(...args),getConnection:async()=>connection}
  rights=all();const service=api(db)
  const admin=await service.listStaffNotifications({role:'Admin'})
  const setup=admin.items.find(item=>item.key==='staff-account-setup')
  assert.match(setup.message,/1 staff account/,'Excludes Active, configured and previously signed-in accounts')
  assert.deepEqual(setup.target,{view:'settings',section:'users'})
  await service.readStaffNotifications({role:'Admin',body:{items:[{key:setup.key,revision:setup.revision}]}})
  assert.equal((await service.listStaffNotifications({role:'Admin'})).items.find(item=>item.key===setup.key).read,true)
  await assert.rejects(()=>service.readStaffNotifications({role:'Supervisor',body:{items:[{key:setup.key,revision:setup.revision}]}}),e=>e.statusCode===409)
  await c.query("INSERT INTO user VALUES(101,'Inactive',NOW())")
  assert.equal((await service.listStaffNotifications({role:'Admin'})).items.find(item=>item.key===setup.key).read,false)
  await c.query("UPDATE user SET Status='Active' WHERE UserID IN (100,101)")
  assert.equal((await service.listStaffNotifications({role:'Admin'})).items.some(item=>item.key===setup.key),false)
  const first=await service.listStaffNotifications({role:'Supervisor'})
  assert.equal(first.items.length,5)
  assert.match(first.items.find(i=>i.kind==='dtr-review').message,/1 draft.*1 attendance/)
  assert.match(first.items.find(i=>i.kind==='payroll-review').message,/1 computed/)
  assert.match(first.items.find(i=>i.kind==='payslip-posting').message,/1 finalized/)
  assert.match(first.items.find(i=>i.kind==='document-expiry').message,/1 employee/)
  assert.equal(first.unreadCount,5)
  const marks=first.items.map(({key,revision})=>({key,revision}))
  await service.readStaffNotifications({role:'Supervisor',body:{items:marks}})
  assert.equal((await service.listStaffNotifications({role:'Supervisor'})).unreadCount,0)
  assert.equal((await service.listStaffNotifications({role:'Supervisor',userId:12})).unreadCount,5,'Read state belongs to each staff account')
  // The latest message from staff resolves the HR action, notifies only its owner.
  await c.query("INSERT INTO employee_information_message VALUES(3,1,'Staff',NOW())")
  const changed=await service.listStaffNotifications({role:'Supervisor'})
  assert.equal(changed.items.some(i=>i.kind==='portal-requests'),false)
  const own1=await service.listEmployeeNotifications({account:{EmployeeID:1,AccountID:21}})
  const own2=await service.listEmployeeNotifications({account:{EmployeeID:2,AccountID:22}})
  assert.deepEqual(own1.items.map(i=>i.key).sort(),['own-archive:1','own-request:1'])
  assert.deepEqual(own2.items.map(i=>i.key).sort(),['own-archive:2','own-payslip:2','own-request:2'])
  assert.doesNotMatch(JSON.stringify(own1),/GrossPay|NetPay|SnapshotJson|PayrollID|EmployeeID|AccountID|EmployeeName/)
  await service.readEmployeeNotifications({account:{EmployeeID:1,AccountID:21},body:{items:own1.items.map(({key,revision})=>({key,revision}))}})
  assert.equal((await service.listEmployeeNotifications({account:{EmployeeID:1,AccountID:21}})).unreadCount,0)
  assert.equal((await service.listEmployeeNotifications({account:{EmployeeID:2,AccountID:22}})).unreadCount,3)
  await assert.rejects(()=>service.readEmployeeNotifications({account:{EmployeeID:1,AccountID:21},body:{items:[{key:own2.items[0].key,revision:own2.items[0].revision}]}}),e=>e.statusCode===409)
  await assert.rejects(()=>service.listEmployeeNotifications({query:{employeeId:2}}),e=>e.statusCode===400)
  await assert.rejects(()=>service.readStaffNotifications({role:'Supervisor',body:{items:marks}}),e=>e.statusCode===409,'A resolved or changed source cannot be marked from stale data')
  // Complete the exact source set, then invalidate it by cancelling a source.
  await c.query('INSERT INTO payslip_publication_source VALUES(1,101)')
  await c.execute('UPDATE payslip_publication SET SnapshotJson=? WHERE PublicationID=1',[JSON.stringify({cutoff:{payrollIds:[100,101]}})])
  assert.equal((await service.listEmployeeNotifications({account:{EmployeeID:1,AccountID:21}})).items.some(i=>i.key==='own-payslip:1'),true)
  await c.query("UPDATE payroll SET Status='Cancelled' WHERE PayrollID=101")
  assert.equal((await service.listEmployeeNotifications({account:{EmployeeID:1,AccountID:21}})).items.some(i=>i.key==='own-payslip:1'),false)
  // A changed source reopens its alert; a completed source disappears.
  await c.query("INSERT INTO attendance_dtr VALUES(4,1,CURDATE(),CURDATE(),'Draft',NOW())")
  assert.equal((await service.listStaffNotifications({role:'Supervisor'})).items.find(i=>i.kind==='dtr-review').read,false)
  await c.query("UPDATE attendance_dtr SET Status='Submitted' WHERE Status='Draft'")
  assert.equal((await service.listStaffNotifications({role:'Supervisor'})).items.some(i=>i.kind==='dtr-review'),false)
  for(const body of [{items:[]},{items:[marks[0]],userId:99},{items:[marks[0],marks[0]]},{items:[{key:'x',revision:'invalid'}]}])await assert.rejects(()=>service.readStaffNotifications({body}),e=>e.statusCode===400||e.statusCode===409)
 }finally{await c.end();rights={}}
})

test('scheduled backup failure stores only status/time and clears after a verified daily record',async()=>{
 const directory=path.resolve('.data/notification-tests/backup-'+Date.now())
 assert.ok(directory.startsWith(path.resolve('.data/notification-tests')+path.sep))
 const previousDir=process.env.DB_BACKUP_DIR,previousBin=process.env.MYSQLDUMP_BIN
 process.env.DB_BACKUP_DIR=directory;process.env.MYSQLDUMP_BIN=process.execPath
 try{
  const backup=await import('../server/utils/databaseBackup.mjs')
  await assert.rejects(()=>backup.ensureDailyDatabaseBackup())
  const failure=await backup.dailyBackupFailure();assert.ok(failure.failedAt)
  const saved=JSON.parse(fs.readFileSync(path.join(directory,'daily-status.json'),'utf8'))
  assert.deepEqual(Object.keys(saved).sort(),['failedAt','status'])
  const name='pbsystem-20261115-000000-12345678.sql'
  fs.writeFileSync(path.join(directory,name),'-- synthetic daily backup for isolated test\n')
  fs.writeFileSync(path.join(directory,name+'.json'),JSON.stringify({name,kind:'daily',localDay:backup.localDay(),createdAt:new Date().toISOString()}))
  assert.equal(await backup.ensureDailyDatabaseBackup(),null)
  assert.equal(await backup.dailyBackupFailure(),null)
 }finally{
  if(previousDir===undefined)delete process.env.DB_BACKUP_DIR;else process.env.DB_BACKUP_DIR=previousDir
  if(previousBin===undefined)delete process.env.MYSQLDUMP_BIN;else process.env.MYSQLDUMP_BIN=previousBin
  fs.rmSync(directory,{recursive:true,force:true})
 }
})
