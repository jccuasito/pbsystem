import { setHeader } from 'h3'
import { appendActivity, registerActivityRecorder } from '../utils/activityHistory'
import { activityCandidate } from '../utils/activityHistoryPolicy'
import { finishActivitySubjects } from '../utils/activitySubject'

export default defineNitroPlugin(app => {
  registerActivityRecorder()
  app.hooks.hook('error', (_error, context) => { if (context.event) context.event.context.activityFailed = true })
  app.hooks.hook('beforeResponse', async (event, response) => {
    if (event.context.activityRecorded) return
    if(!activityCandidate(event,response))return
    await finishActivitySubjects(event,response)
    const entry = activityCandidate(event, response)
    if (!entry) return
    event.context.activityRecorded = true
    const saved = await appendActivity(entry)
    // A completed business mutation must not become a false failure that
    // invites duplicate financial submissions if the supplemental log fails.
    setHeader(event, 'X-Activity-History', saved ? 'recorded' : 'unavailable')
  })
})
