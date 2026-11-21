// node --env-file=.env --test scripts/test-server-list-pagination.cjs
const {test}=require('node:test'),assert=require('node:assert/strict'),mysql=require('mysql2/promise')
const {readOnlyApi,event,localConfig}=require('./helpers/read-only-api-fixture.cjs')
test('local directories page before enrichment, search all rows and preserve legacy callers',async()=>{
 const db=await mysql.createConnection(localConfig()),queries=[]
 try{
  await db.query('SET SESSION TRANSACTION READ ONLY')
  const api=await readOnlyApi(db,queries)
  const specs=[
   ...Object.entries({site:'SiteID',client:'ClientID',agency:'AgencyID',position:'PositionID',region:'RegionID','site-account':'SiteAccountID'}).map(([resource,id])=>({resource,id,load:api.listOrganizationResource})),
   ...Object.entries({'payroll-rate':'PayrollRateID','billing-rate':'BillingRateID','site-rate':'SiteRateID'}).map(([resource,id])=>({resource,id,load:api.listRateResource})),
   {resource:'dtr',id:'BatchID',load:api.listDtrs},
  ]
  for(const spec of specs){
   const legacy=await spec.load(event(spec.resource)),actual=[]
   for(let page=1;;page++){
    const start=queries.length,result=await spec.load(event(spec.resource,{page:String(page),pageSize:'2',includeLookups:'0'}))
    assert.ok(result.items.length<=2,spec.resource+' bounded response')
    assert.equal(result.pagination.total,legacy.items.length);assert.equal(result.pagination.page,page)
    assert.ok(queries.slice(start).some(query=>/LIMIT \? OFFSET \?/i.test(query.sql)),spec.resource+' database limit')
    actual.push(...result.items);if(page>=result.pagination.pages)break
   }
   assert.deepEqual(actual.map(row=>Number(row[spec.id])).sort((a,b)=>a-b),legacy.items.map(row=>Number(row[spec.id])).sort((a,b)=>a-b),spec.resource+' no missing or duplicate records')
   if(spec.resource==='site-rate')for(const row of actual){const old=legacy.items.find(item=>item.SiteRateID===row.SiteRateID);assert.equal(String(row.PayrollRegularRate),String(old.PayrollRegularRate));assert.equal(String(row.BillingRegularRate),String(old.BillingRegularRate))}
   if(spec.resource==='dtr')for(const row of actual){const old=legacy.items.find(item=>item.BatchID===row.BatchID);for(const key of ['PeopleCount','RegularHours','OTHours','NightDiffHours'])assert.equal(String(row[key]),String(old[key]))}
   for(const page of ['0','-1','NaN','1.5','1000001'])await assert.rejects(spec.load(event(spec.resource,{page})),error=>error.statusCode===400)
   await assert.rejects(spec.load(event(spec.resource,{page:'1',pageSize:'101'})),error=>error.statusCode===400)
   const beyond=await spec.load(event(spec.resource,{page:'99999',pageSize:'2',includeLookups:'0'}));assert.equal(beyond.pagination.page,beyond.pagination.pages)
   const injection=await spec.load(event(spec.resource,{page:'1',search:"%' OR 1=1 --",includeLookups:'0'}));assert.equal(injection.items.length,0)
   await assert.rejects(spec.load({context:{params:{resource:spec.resource}},query:{page:'1'}}),error=>error.statusCode===401)
  }
  const sites=await api.listOrganizationResource(event('site'))
  for(const site of sites.items){
   const found=await api.listOrganizationResource(event('site',{page:'1',pageSize:'1',search:site.SiteName,includeLookups:'0'}));assert.ok(found.pagination.total>=1)
   for(const agencyId of site.AgencyIDs){const filtered=await api.listOrganizationResource(event('site',{page:'1',agencyId:String(agencyId),includeLookups:'0'}));assert.ok(filtered.items.every(row=>row.AgencyIDs.includes(agencyId)))}
  }
  for(const kind of ['payroll-rate','billing-rate']){
   const groups=await api.listRateResource(event(kind,{page:'1',pageSize:'100',view:'groups',includeLookups:'0'})),legacy=await api.listRateResource(event(kind))
   for(const group of groups.items){
    assert.equal(group.items.length,0,'Group overview contains no full position records')
    const result=await api.listRateResource(event(kind,{page:'1',pageSize:'2',groupAgencyId:String(group.AgencyID),groupRegionId:group.RegionID==null?'all':String(group.RegionID),includeLookups:'0'}))
    assert.equal(result.pagination.total,Number(group.RateCount))
    for(const row of result.items){
     const id=kind==='payroll-rate'?'PayrollRateID':'BillingRateID',old=legacy.items.find(item=>item[id]===row[id]);assert.deepEqual(row.CurrentRate,old.CurrentRate);assert.deepEqual(row.Versions,old.Versions)
     const single=await api.listRateResource(event(kind,{view:'record',id:String(row[id])}));assert.deepEqual(single.item.CurrentRate,row.CurrentRate)
     if(row.Status==='Active'){
      const choices=await api.listRateResource(event(kind,{view:'copy-choices',agencyId:String(group.AgencyID),regionId:group.RegionID==null?'':String(group.RegionID)}));assert.ok(choices.items.some(choice=>choice[id]===row[id]))
     }
    }
   }
  }
  const links=await api.listRateResource(event('site-rate'))
  for(const link of links.items){
   const choices=await api.listRateResource(event('site-rate',{view:'choices',siteId:String(link.SiteID),agencyPositionId:String(link.AgencyPositionID),regionId:String(link.RegionID)}))
   assert.ok(choices.payrollRates.every(rate=>Number(rate.AgencyPositionID)===Number(link.AgencyPositionID)&&Number(rate.RegionID)===Number(link.RegionID)))
   assert.ok(choices.existingLinks.some(row=>row.SiteRateID===link.SiteRateID)||link.Status!=='Active')
  }
  console.log('Local SELECT checks passed; no schema or business records changed.')
 }finally{await db.end()}
})
