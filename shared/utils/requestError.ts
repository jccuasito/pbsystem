const connectionMessage = 'Cannot connect to the server. Please check your connection and try again.'
const unavailableMessage = 'The service is temporarily unavailable. Please try again shortly.'

// This is a display boundary, not SQL injection protection. Never expose a
// FetchError.message: ofetch includes the URL, query string and HTTP details.
function safeApplicationMessage(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 600 || /[\r\n\u0000-\u001f\u007f]/.test(value)) return false
  return !/(?:^\[(?:GET|POST|PUT|PATCH|DELETE|HEAD)\]|\/api\/|https?:\/\/|[a-z]:[\\/]|node_modules|SQLSTATE|\bER_[A-Z_]+\b|\b(?:errno|sqlMessage)\b|sql syntax|unknown column|duplicate entry|\bselect\s+.+\s+from\b|\binsert\s+into\b|\bupdate\s+.+\s+set\b|\bdelete\s+from\b|\b(?:TypeError|ReferenceError|SyntaxError|ECONN\w*|ETIMEDOUT|ENOENT)\b|Cannot read properties|Failed to fetch|fetch failed|NetworkError|\bat\s+.+:\d+(?::\d+)?|<\/?[a-z][^>]*>)/i.test(value)
}

/** Keep expected application validation; replace transport and internal errors. */
export function requestErrorMessage(cause: unknown, fallback = 'The request could not be completed. Please try again.'): string {
  const error = cause as { status?: unknown; statusCode?: unknown; statusMessage?: unknown; message?: unknown; response?: { status?: unknown }; request?: unknown; name?: string; data?: { statusCode?: unknown; statusMessage?: unknown; message?: unknown } } | null
  const status = Number(error?.statusCode || error?.status || error?.response?.status || error?.data?.statusCode || 0)
  if ([408, 504].includes(status) || error?.name === 'TimeoutError') return 'The request timed out. Please try again.'
  if (status >= 500) return unavailableMessage
  // Structured 4xx messages are useful (field validation, conflicts, permissions).
  // Older application errors may contain data without a numeric status.
  const message = error?.data?.statusMessage ?? error?.data?.message ?? error?.statusMessage
  if ((status === 0 || status >= 400 && status < 500) && safeApplicationMessage(message)) return message.trim()
  if (status === 401) return 'Please sign in to continue.'
  if (status === 403) return 'You do not have permission to perform this action.'
  if (status === 429) return 'Too many requests. Please wait a moment before trying again.'
  if (error?.name === 'AbortError') return 'The request was cancelled.'
  if (!status && (error?.name === 'FetchError' || error?.name === 'TypeError' && /fetch|network/i.test(String(error.message)))) return connectionMessage
  // Local form/Excel checks throw plain Errors too. Keep their human-readable
  // validation messages, but never fall back to transport/runtime diagnostics.
  if (!status && !error?.response && !error?.request && safeApplicationMessage(error?.message)) return error.message.trim()
  return fallback
}
