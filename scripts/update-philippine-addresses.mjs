import { mkdir, writeFile, rename } from 'node:fs/promises'
import crypto from 'node:crypto'
const repository='bendlikeabamboo/barangay'
const commitResponse=await fetch(`https://api.github.com/repos/${repository}/commits/main`,{headers:{'User-Agent':'pbsystem-address-reference'},signal:AbortSignal.timeout(30000)})
if(!commitResponse.ok)throw Error('Could not resolve address reference revision; existing snapshot retained.')
const {sha}=await commitResponse.json()
if(!/^[a-f0-9]{40}$/.test(sha))throw Error('Invalid address reference revision.')
const source=`https://raw.githubusercontent.com/${repository}/${sha}/barangay/data/barangay_flat.json`
const response=await fetch(source,{signal:AbortSignal.timeout(60000)})
if(!response.ok)throw Error('Address reference download failed; existing snapshot retained.')
const records=await response.json()
if(!Array.isArray(records))throw Error('Unexpected address dataset.')
const byCode=new Map(records.map(r=>[r.psgc_id,r]))
function ancestor(record,types){
  let parent=record
  for(let count=0;parent&&count<8;count++){
    if(types.includes(parent.type))return parent
    parent=byCode.get(parent.parent_psgc_id)
  }
  return null
}
const cityTypes=['highly_urbanized_city','independent_component_city','component_city','municipality']
const regions=records.filter(r=>r.type==='region').map(r=>({code:r.psgc_id,name:r.name}))
const provinces=records.filter(r=>['province','special_geographic_area'].includes(r.type)).map(r=>({code:r.psgc_id,name:r.name,region:ancestor(r,['region'])?.psgc_id}))
const cities=records.filter(r=>cityTypes.includes(r.type)).map(r=>({code:r.psgc_id,name:r.name,region:ancestor(r,['region'])?.psgc_id,province:ancestor(r,['province','special_geographic_area'])?.psgc_id||null}))
const barangays=records.filter(r=>r.type==='barangay').map(r=>({code:r.psgc_id,name:r.name,city:ancestor(r,cityTypes)?.psgc_id}))
for(const [level,rows] of Object.entries({regions,provinces,cities,barangays})) {
  if(new Set(rows.map(r=>r.code)).size!==rows.length || rows.some(r=>!/^\d{10}$/.test(r.code)||!r.name||('region'in r&&!r.region)||('city'in r&&!r.city))) throw Error(`Invalid or ambiguous parent references in ${level}; existing snapshot retained.`)
}
if(regions.length<18||provinces.length<82||cities.length<1640||barangays.length<42000) throw Error('Address reference appears incomplete; existing snapshot retained.')
const licenseResponse=await fetch(`https://raw.githubusercontent.com/${repository}/${sha}/LICENSE`)
if(!licenseResponse.ok)throw Error('Address data license unavailable; existing snapshot retained.')
const license=await licenseResponse.text()
const snapshot={source,revision:sha,officialReference:'https://psa.gov.ph/classification/psgc/index',retrievedAt:new Date().toISOString(),regions,provinces,cities,barangays}
const output=JSON.stringify(snapshot)
await mkdir('server/assets/addresses',{recursive:true})
await writeFile('server/assets/addresses/philippines.json.pending',output+'\n','utf8')
await writeFile('server/assets/addresses/LICENSE.txt',license,'utf8')
await rename('server/assets/addresses/philippines.json.pending','server/assets/addresses/philippines.json')
console.log(JSON.stringify({regions:regions.length,provinces:provinces.length,cities:cities.length,barangays:barangays.length,bytes:Buffer.byteLength(output),sha256:crypto.createHash('sha256').update(output).digest('hex')}))
