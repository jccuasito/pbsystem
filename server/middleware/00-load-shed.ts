import { getRequestURL } from 'h3'
import { admitApiRequest } from '../utils/requestCapacity'

export default defineEventHandler(event => {
  const path = getRequestURL(event).pathname
  if (path.toLowerCase().startsWith('/api/')) admitApiRequest(event, path)
})
