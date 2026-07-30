import { clearSession } from '../../utils/auth'
export default defineEventHandler((event) => { clearSession(event); return { message: 'Signed out.' } })
