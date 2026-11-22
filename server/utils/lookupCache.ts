import pool from '../connection/dbconnect'
import {coalesceRead} from './requestCapacity'

// Server-only metadata cache. No sessions, employee profiles, payroll previews,
// payslips or financial results belong here. Browser responses remain no-store.
const entries=new Map<string,{json:string;expires:number;bytes:number}>()
let bytes=0
const ttl=30_000,maximumBytes=8*1024*1024,maximumEntry=512*1024
const metrics={hits:0,misses:0,bypasses:0,invalidations:0}
function remove(key:string){const entry=entries.get(key);if(entry)bytes-=entry.bytes;entries.delete(key)}
export function lookupCacheMetrics(){return{...metrics,entries:entries.size,bytes,ttlMs:ttl}}
export async function invalidateLookupCache(){
  entries.clear();bytes=0;metrics.invalidations++
  try{await pool.execute('UPDATE system_runtime SET CacheEpoch=UUID() WHERE RuntimeID=1')}
  catch{console.warn('[lookup-cache] Invalidation unavailable; metadata expires within 30 seconds.')}
}
export async function cachedLookup<T>(key:string,read:()=>Promise<T>):Promise<T>{
  let epoch:string
  try{
    epoch=await coalesceRead('lookup-cache-epoch',async()=>{
      const [[row]]=await pool.execute<any[]>('SELECT CacheEpoch FROM system_runtime WHERE RuntimeID=1')
      if(!row)throw Error('Cache schema unavailable')
      return String(row.CacheEpoch)
    })
  }catch{metrics.bypasses++;return read()}
  const identity=epoch+':'+key,now=Date.now()
  for(const [name,entry]of entries)if(entry.expires<=now)remove(name)
  const existing=entries.get(identity)
  if(existing){metrics.hits++;return JSON.parse(existing.json)}
  metrics.misses++
  // Store serialized values; callers cannot mutate another caller's metadata.
  const json=await coalesceRead('lookup-cache:'+identity,async()=>{
    const value=JSON.stringify(await read()),size=Buffer.byteLength(value)
    if(size<=maximumEntry){
      while(entries.size>=128||bytes+size>maximumBytes)remove(entries.keys().next().value!)
      remove(identity);entries.set(identity,{json:value,bytes:size,expires:Date.now()+ttl});bytes+=size
    }
    return value
  })
  return JSON.parse(json)
}
