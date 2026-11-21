// Direct-handler local integration harness; installs no HTTP auth bypass.
// Every database operation is checked, so tests cannot change business data.
const fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild')
async function readOnlyApi(db,record=[]){
 const root=path.resolve(__dirname,'../..'),output=path.join(root,'.data/server-list-tests/api.cjs')
 fs.mkdirSync(path.dirname(output),{recursive:true})
 globalThis.readTestDb={execute:async(sql,params=[])=>{
  if(!/^\s*SELECT\b/i.test(sql))throw Error('Read-only fixture rejected a non-SELECT query')
  const start=performance.now(),result=await db.execute(sql,params)
  record.push({sql,params,ms:performance.now()-start});return result
 }}
 await build({stdin:{contents:"export * from '../../server/utils/organizationCrud';export * from '../../server/utils/rateCrud';export {listDtrs} from '../../server/utils/dtrCrud';",resolveDir:path.dirname(output),loader:'ts'},outfile:output,bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'read-only-handlers',setup(b){
  b.onResolve({filter:/connection\/dbconnect$/},()=>({path:'db',namespace:'qa'}))
  b.onResolve({filter:/^h3$/},()=>({path:'h3',namespace:'qa'}))
  b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:args.path==='db'?'export default globalThis.readTestDb;':`export * from ${JSON.stringify(require.resolve('h3'))};export const getQuery=event=>event.query||{};export const getRouterParam=(event,key)=>event.context.params[key];export const setHeader=()=>{};`,resolveDir:root,loader:'js'}))
  b.onLoad({filter:/[\\/]auth\.ts$/},args=>({contents:fs.readFileSync(args.path,'utf8').split('export function requireSession')[0]+`export function requireSession(event){if(!event.context?.testSession)throw Object.assign(Error('Fixture session required'),{statusCode:401});return event.context.testSession}`,loader:'ts',resolveDir:path.dirname(args.path)}))
 }}]})
 delete require.cache[require.resolve(output)];return require(output)
}
function event(resource,query={}){return{context:{testSession:{sub:1,userType:'Viewer'},params:{resource}},query}}
function localConfig(){
 if(!['localhost','127.0.0.1','::1'].includes(process.env.DB_HOST||'127.0.0.1'))throw Error('This check only reads a loopback database.')
 if(!process.env.DB_NAME)throw Error('Load the local .env before running this check.')
 return{host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME}
}
module.exports={readOnlyApi,event,localConfig}
