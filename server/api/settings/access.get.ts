import { accessForUser, currentActor, MODULES } from '../../utils/settingsAccess'
import { requireSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  void session.sub
  const actor = await currentActor(event)
  return { role: actor.UserType, isAdmin: actor.UserType === 'Admin', modules: MODULES, access: await accessForUser(actor.UserID, actor.UserType) }
})
