const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),{transformSync}=require('esbuild')
function evaluate(file,deps={}){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code,{module,require:name=>{if(!(name in deps))throw Error('Unmapped dependency '+name);return deps[name]},console,Date});return module.exports}
const fields=evaluate('shared/utils/rateFields.ts'),shared=evaluate('shared/utils/regionalRates.ts',{'./rateFields':fields}),keys=shared.regionalAmountKeys
const amounts=(rate,allowance=0)=>Object.fromEntries(keys.map(key=>[key,key==='Allowance'?allowance:rate]))
test('regional date selection uses effective versions and custom zero remains explicit',()=>{
 const base={EffectiveDate:'2025-01-01',...amounts(80)},versions=[{EffectiveDate:'2028-01-01',...amounts(120)},{EffectiveDate:'2026-01-01',...amounts(90)}]
 assert.equal(shared.regionalAtDate(base,versions,'2024-12-31'),null);assert.equal(shared.regionalAtDate(base,versions,'2026-11-02').RegularRate,90)
 assert.equal(shared.regionalAmounts(base,{Allowance:0,RegularRate:100}).Allowance,0);assert.equal(shared.regionalAmounts(base,{RegularRate:100}).OTRate,80)
 assert.equal(shared.rateDate(new Date('2026-09-26T00:00:00Z')),'2026-09-26')
})
test('regional APIs preserve source history, effective inheritance, custom fields and transaction rollback in isolated temporary tables',{skip:process.env.REGIONAL_RATE_TEST_DATABASE!=='1'},async()=>{
 const env={...require('node:util').parseEnv(fs.readFileSync('.env','utf8')),...process.env},mysql=require('mysql2/promise'),db=await mysql.createConnection({host:env.DB_HOST||'127.0.0.1',port:Number(env.DB_PORT||3306),user:env.DB_USER||'root',password:env.DB_PASSWORD,database:env.DB_NAME||'pbsystem',dateStrings:true})
 const tables=['payroll_region_rate','payroll_region_rate_version','payroll_rate','payroll_rate_version'];const fingerprint=async()=>{const data=[];for(const table of tables){const [rows]=await db.query('SELECT * FROM `'+table+'` ORDER BY 1');data.push(rows)}return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')};const before=await fingerprint()
 let inject=false
 const wrapper={execute:async(sql,params)=>{if(inject&&sql.startsWith('UPDATE payroll_rate SET'))throw Error('Injected failure');return db.execute(sql,params)},beginTransaction:()=>db.beginTransaction(),commit:()=>db.commit(),rollback:()=>db.rollback(),release(){}}
 const pool={execute:(...args)=>wrapper.execute(...args),getConnection:async()=>wrapper}
 const h3={createError:options=>Object.assign(new Error(options.statusMessage),options),readBody:async event=>event.body,setHeader(){}}
 const api=evaluate('server/utils/regionalRateCrud.ts',{h3,'../connection/dbconnect':pool,'./auth':{requireSession:event=>{if(!event.session)throw Object.assign(Error('Unauthorized'),{statusCode:401});return event.session}},'./rateVersions':{todayInPhilippines:()=> '2026-11-02'},'../../shared/utils/regionalRates':shared})
 const event=body=>({body,session:{sub:1,userType:'Admin'},context:{moduleCanEdit:true}})
 try{
  for(const table of tables){const [[definition]]=await db.query('SHOW CREATE TABLE `'+table+'`');const sql=definition['Create Table'].split('\n').filter(line=>!line.trimStart().startsWith('CONSTRAINT ')).join('\n').replace('CREATE TABLE','CREATE TEMPORARY TABLE').replace(/,\n\)/,'\n)');await db.query(sql)}
  for(const [table,definition] of Object.entries({agency:'AgencyID INT PRIMARY KEY, AgencyName VARCHAR(100), Status VARCHAR(20)',region:'RegionID INT PRIMARY KEY, RegionCode VARCHAR(10), RegionName VARCHAR(100), Status VARCHAR(20)',position:'PositionID INT PRIMARY KEY, PositionName VARCHAR(100), Status VARCHAR(20)',agency_position:'AgencyPositionID INT PRIMARY KEY, AgencyID INT, PositionID INT, Status VARCHAR(20)'}))await db.query('CREATE TEMPORARY TABLE `'+table+'` ('+definition+') ENGINE=InnoDB')
  await db.query("INSERT INTO agency VALUES(90001,'Test Agency','Active')");await db.query("INSERT INTO region VALUES(90001,'13','NCR','Active')");await db.query("INSERT INTO `position` VALUES(90001,'Guard','Active'),(90002,'ADC','Active'),(90003,'OIC','Active')");await db.query("INSERT INTO agency_position VALUES(90001,90001,90001,'Active'),(90002,90001,90002,'Active'),(90003,90001,90003,'Active')")
  async function position(id,rate,allowance){await db.execute(`INSERT INTO payroll_rate(PayrollRateID,AgencyPositionID,RegionID,EffectiveDate,${keys.join(',')},Status) VALUES(${Array(keys.length+5).fill('?').join(',')})`,[id,id,90001,'2025-01-01',...keys.map(key=>amounts(rate,allowance)[key]),'Active']);await db.execute(`INSERT INTO payroll_rate_version(PayrollRateID,EffectiveDate,${keys.join(',')},Reason) VALUES(${Array(keys.length+3).fill('?').join(',')})`,[id,'2026-01-01',...keys.map(key=>amounts(rate+10,allowance)[key]),'Initial wage update'])}
  await position(90001,80,0);await position(90002,95,500);await db.query('UPDATE payroll_rate SET EffectiveDate=NULL WHERE PayrollRateID=90002')
  await assert.rejects(api.listRegionalRates({}),error=>error.statusCode===401)
  await assert.rejects(api.createRegionalRate({...event({}),session:{sub:1,userType:'Viewer'}}),error=>error.statusCode===403)
  const created=await api.createRegionalRate(event({AgencyID:90001,RegionID:90001,SourcePayrollRateID:90001}));assert.equal(created.linkedPositions,2)
  let listed=await api.listRegionalRates(event({})),parent=listed.items[0];assert.equal(parent.CurrentRate.RegularRate,'90.00');assert.equal(parent.Versions.length,1);assert.equal(parent.EffectiveDate,'2025-01-01')
  const [[adc]]=await db.query('SELECT * FROM payroll_rate WHERE PayrollRateID=90002');assert.equal(shared.regionalOverrides(adc.RegionOverridesJson).Allowance,500);assert.equal(adc.EffectiveDate,null);assert.equal(adc.RegularRate,'95.00')
  await api.updateRegionalRate(event({id:created.id,mode:'version',Revision:1,EffectiveDate:'2027-01-01',...amounts(110)}))
  await db.beginTransaction();const inserted=await api.insertRegionalPosition(wrapper,{AgencyPositionID:90003,RegionID:90001,RegionRateID:created.id,RegionalRevision:2,RegionOverrides:{Allowance:750}});await db.commit()
  const [[oic]]=await db.execute('SELECT * FROM payroll_rate WHERE PayrollRateID=?',[inserted]);assert.equal(oic.EffectiveDate,'2026-01-01');assert.equal(oic.RegularRate,'90.00');assert.equal(oic.Allowance,'750.00')
  await db.beginTransaction();await api.changeRegionalPosition(wrapper,{id:inserted,EffectiveDate:'2026-12-01',RegionOverrides:{Allowance:800}},'version');await db.commit()
  await api.updateRegionalRate(event({id:created.id,mode:'current',Revision:2,...amounts(100)}))
  let [future]=await db.execute('SELECT * FROM payroll_rate_version WHERE PayrollRateID=? ORDER BY EffectiveDate',[inserted]);assert.equal(future[0].EffectiveDate,'2026-12-01');assert.equal(future[0].RegularRate,'100.00');assert.equal(future[1].EffectiveDate,'2027-01-01');assert.equal(future[1].RegularRate,'110.00');assert.equal(future[1].Allowance,'800.00');assert.equal(future[1].IsRegionalVersion,1)
  await db.beginTransaction();await api.changeRegionalPosition(wrapper,{id:90002,RegionalRevision:3,RegionOverrides:{RegularRate:105,Allowance:0}},'current');await db.commit()
  await api.updateRegionalRate(event({id:created.id,mode:'version',Revision:3,EffectiveDate:'2028-01-01',...amounts(120)}))
  const [[adcFuture]]=await db.query("SELECT * FROM payroll_rate_version WHERE PayrollRateID=90002 AND EffectiveDate='2028-01-01'");assert.equal(adcFuture.RegularRate,'105.00');assert.equal(adcFuture.Allowance,'0.00')
  await assert.rejects(api.updateRegionalRate(event({id:created.id,mode:'current',Revision:1,...amounts(130)})),error=>error.statusCode===409)
  inject=true;await assert.rejects(api.updateRegionalRate(event({id:created.id,mode:'current',Revision:4,...amounts(130)})),/Injected failure/);inject=false
  listed=await api.listRegionalRates(event({}));assert.equal(listed.items[0].Revision,4);assert.equal(listed.items[0].CurrentRate.RegularRate,'100.00')
  await assert.rejects(api.updateRegionalRate(event({id:created.id,mode:'version',Revision:4,EffectiveDate:'2027-01-01',...amounts(130)})),error=>error.statusCode===409)
 }finally{
  for(const table of ['agency_position','position','region','agency',...tables].reverse())await db.query('DROP TEMPORARY TABLE IF EXISTS `'+table+'`')
  assert.equal(await fingerprint(),before,'Live payroll and regional data must be unchanged');await db.end()
 }
})
