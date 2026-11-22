const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{transformSync}=require('esbuild')
const target={exports:{}}
vm.runInNewContext(transformSync(fs.readFileSync('server/utils/employeeCursor.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module:target,Buffer,require:()=>({createError:body=>Object.assign(new Error(body.statusMessage),body)})})
const {employeeCursor,employeeAfter}=target.exports
test('cursor values stay bound, reject malformed data and cannot cross directory kinds',()=>{
 const row={LastName:"x') OR 1=1 --",FirstName:'A',EmployeeNumber:null,EmployeeID:7},params=[]
 const cursor=employeeCursor(row,'employee'),sql=employeeAfter(cursor,'employee',params)
 assert.ok(!sql.includes(row.LastName));assert.ok(params.includes(row.LastName));assert.match(sql,/EmployeeNumber IS NOT NULL/)
 assert.throws(()=>employeeAfter(cursor,'account',[]),e=>e.statusCode===400)
 for(const value of ['%%%','x'.repeat(2049),Buffer.from(JSON.stringify({kind:'employee',values:['a','b',null,-1]})).toString('base64url')])assert.throws(()=>employeeAfter(value,'employee',[]),e=>e.statusCode===400)
})
test('real MySQL continuation preserves nullable/case-equivalent names and duplicate-name ID ties',{skip:!process.env.MILLION_CURSOR_DATABASE},async()=>{
 const database=process.env.MILLION_CURSOR_DATABASE
 assert.match(database,/^pbsystem_scale_\d{14}_[a-f0-9]{4}$/)
 assert.notEqual(database,process.env.DB_NAME)
 assert.ok(['localhost','127.0.0.1','::1'].includes(process.env.DB_HOST||'127.0.0.1'))
 const db=await require('mysql2/promise').createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database})
 try{
  const [[marker]]=await db.execute('SELECT Marker FROM scale_test_manifest');assert.equal(marker.Marker,'SYNTHETIC_ONLY_MILLION_4_500_150_V1')
  await db.query('CREATE TEMPORARY TABLE employee_cursor_fixture(EmployeeID INT PRIMARY KEY,LastName VARCHAR(100),FirstName VARCHAR(100),MiddleName VARCHAR(100),EmployeeNumber VARCHAR(100)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
  for(const values of [[1,null,'A',null,null],[2,'SAME','A',null,null],[3,'same','a',null,null],[4,'SAME','A','M',''],[5,'SAME','A','M','001'],[6,'SAME','B',null,null],[7,'Z','A',null,'x']])await db.execute('INSERT INTO employee_cursor_fixture VALUES(?,?,?,?,?)',values)
  for(const kind of ['employee','account']){
   const order=kind==='employee'?'e.LastName,e.FirstName,e.EmployeeNumber,e.EmployeeID':'e.LastName,e.FirstName,e.MiddleName,e.EmployeeID'
   const [full]=await db.query('SELECT * FROM employee_cursor_fixture e ORDER BY '+order)
   const loaded=[];let cursor
   for(let i=0;i<10;i++){
    const params=[],where=employeeAfter(cursor,kind,params)
    const [page]=await db.execute('SELECT * FROM employee_cursor_fixture e'+(where?' WHERE '+where:'')+' ORDER BY '+order+' LIMIT 2',params)
    if(!page.length)break
    loaded.push(...page.map(r=>r.EmployeeID));cursor=employeeCursor(page.at(-1),kind)
   }
   assert.deepEqual(loaded,full.map(r=>r.EmployeeID));assert.equal(new Set(loaded).size,7)
  }
 }finally{await db.end()}
})
