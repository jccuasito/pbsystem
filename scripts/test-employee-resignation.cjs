const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{transformSync}=require('esbuild')
const fail=details=>Object.assign(new Error(details.statusMessage),details)
const moduleState={exports:{}}
vm.runInNewContext(transformSync(fs.readFileSync('server/utils/employeeResignation.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module:moduleState,require:()=>({createError:fail}),Date,Intl})
const {resignationDate,recordEmployeeResignation}=moduleState.exports
test('resignation dates use Manila today and reject malformed, future or pre-hire dates',()=>{
 const now=new Date('2026-11-14T16:30:00Z')
 assert.equal(resignationDate(undefined,'2020-01-01',now),'2026-11-15')
 assert.equal(resignationDate('2026-11-01','2020-01-01',now),'2026-11-01')
 for(const value of ['2026-02-30','2026-1-01','invalid',{},'2026-11-16','2019-12-31'])assert.throws(()=>resignationDate(value,'2020-01-01',now),e=>e.statusCode===400)
})
test('resignation is atomic, audited, retry-safe and never dates legacy Inactive records',{skip:process.env.EMPLOYEE_RESIGNATION_TEST_DATABASE!=='1'},async()=>{
 const env={...require('node:util').parseEnv(fs.readFileSync('.env','utf8')),...process.env}
 const c=await require('mysql2/promise').createConnection({host:env.DB_HOST||'127.0.0.1',port:Number(env.DB_PORT||3306),user:env.DB_USER||'root',password:env.DB_PASSWORD,database:env.DB_NAME||'pbsystem',dateStrings:true})
 try{
  // Connection-local shadow table: never mutate a persistent employee.
  await c.query('CREATE TEMPORARY TABLE employee(EmployeeID INT PRIMARY KEY,Status VARCHAR(20),DateHired DATE,ResignationDate DATE NULL,LastRehireDate DATE NULL,UpdatedBy INT) ENGINE=InnoDB')
  await c.query("INSERT INTO employee VALUES (1,'Active','2020-01-01',NULL,NULL,NULL),(2,'Inactive','2020-01-01',NULL,NULL,NULL),(3,'Active','2020-01-01',NULL,NULL,NULL)")
  const save=async(id,day)=>{await c.beginTransaction();try{const result=await recordEmployeeResignation(c,id,day,14);await c.commit();return result}catch(e){await c.rollback();throw e}}
  assert.equal((await save(1,'2026-11-01')).ResignationDate,'2026-11-01')
  const [[row]]=await c.query('SELECT * FROM employee WHERE EmployeeID=1')
  assert.equal(row.Status,'Inactive');assert.equal(row.ResignationDate,'2026-11-01');assert.equal(row.UpdatedBy,14)
  assert.equal((await save(1,'2026-11-02')).ResignationDate,'2026-11-01')
  assert.equal((await save(2,'2026-11-02')).ResignationDate,null)
  await assert.rejects(()=>save(3,'2019-01-01'),e=>e.statusCode===400)
  assert.equal((await c.query('SELECT Status FROM employee WHERE EmployeeID=3'))[0][0].Status,'Active')
  await assert.rejects(()=>save(99,'2026-11-01'),e=>e.statusCode===404)
 }finally{await c.end()}
})
