import { createHash, timingSafeEqual } from 'node:crypto'

function secretDigest(value) {
  return createHash('sha256').update(value).digest()
}

export function isAuthorizedBearerRequest(authorizationHeader, authorizationSecret) {
  if (typeof authorizationSecret !== 'string' || authorizationSecret.length === 0) return false
  if (typeof authorizationHeader !== 'string') return false

  const match = /^Bearer ([^\s]+)$/.exec(authorizationHeader)
  if (!match) return false

  return timingSafeEqual(secretDigest(match[1]), secretDigest(authorizationSecret))
}
