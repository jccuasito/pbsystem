import {getRequestURL,getMethod} from 'h3'
import {invalidateLookupCache} from '../utils/lookupCache'

export default defineNitroPlugin(app=>{
  // Await invalidation before acknowledging a metadata write. Cross-process
  // readers check the database epoch; they never rely on local memory alone.
  app.hooks.hook('beforeResponse',async event=>{
    const path=getRequestURL(event).pathname
    if(event.context.securityActor&&!['GET','HEAD','OPTIONS'].includes(getMethod(event))&&
      (path.startsWith('/api/organization/')||path==='/api/settings/backups/restore'))await invalidateLookupCache()
  })
})
