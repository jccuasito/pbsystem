const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{transformSync}=require('esbuild')
test('profile measurements persist, omitted values survive, and transaction rollback restores them', {skip:process.env.EMPLOYEE_PROFILE_TEST_DATABASE!=='1'}, async()=>{
 const db=await require('mysql2/promise').createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'pbsystem'})
 try{
  for(const table of ['employee_profile','bank']){
   const [[schema]]=await db.query('SHOW CREATE TABLE '+table)
   await db.query(schema['Create Table'].replace(/^CREATE TABLE/,'CREATE TEMPORARY TABLE').split('\n').filter(line=>!/^\s*CONSTRAINT/.test(line)).join('\n').replace(/,\s*\n\)/g,'\n)'))
  }
  const module={exports:{}}
  const source=fs.readFileSync('server/utils/employeeCrud.ts','utf8')+'\nmodule.exports.saveProfile=savePayrollDisbursement;'
  vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{module,require:name=>name==='h3'?{createError:d=>Object.assign(new Error(d.statusMessage),d)}:{}})
  const body={PaymentMethod:'Cash',PaymentMethodEffectiveDate:'2026-10-01',Height:'165.25',Weight:'60.5'}
  await db.beginTransaction();await module.exports.saveProfile(db,1,body);await db.commit()
  let [[row]]=await db.execute('SELECT Height,Weight FROM employee_profile WHERE EmployeeID=?',[1])
  assert.equal(Number(row.Height),165.25);assert.equal(Number(row.Weight),60.5)
  await db.beginTransaction();await module.exports.saveProfile(db,1,{PaymentMethod:'Cash',PaymentMethodEffectiveDate:'2026-10-01',Weight:''});await db.commit()
  ;[[row]]=await db.execute('SELECT Height,Weight FROM employee_profile WHERE EmployeeID=?',[1])
  assert.equal(Number(row.Height),165.25);assert.equal(row.Weight,null)
  await db.beginTransaction();await module.exports.saveProfile(db,1,{...body,Height:180});await db.rollback()
  ;[[row]]=await db.execute('SELECT Height,Weight FROM employee_profile WHERE EmployeeID=?',[1])
  assert.equal(Number(row.Height),165.25);assert.equal(row.Weight,null)
 }finally{await db.end()}
})
