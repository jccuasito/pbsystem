import { profileImageResponse } from '../../../utils/profileImageResponse'

export default defineEventHandler(event => profileImageResponse(event, 'avatars'))
