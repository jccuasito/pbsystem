import { completeApiRequest } from '../utils/requestCapacity'

export default defineNitroPlugin(nitroApp => {
  nitroApp.hooks.hook('afterResponse', event => { completeApiRequest(event) })
  // Nitro's custom error renderer may send a handled response without running
  // afterResponse. Its request-error hook runs after the handler has unwound.
  nitroApp.hooks.hook('error', (_error, context) => {
    if (context.event && context.tags?.includes('request') && !context.tags.includes('response')) completeApiRequest(context.event)
  })
})
