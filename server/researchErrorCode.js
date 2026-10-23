// Only known operational codes leave the server. Never expose driver messages,
// nested causes, connection details, or arbitrary upstream response bodies.
const operationalCodes = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'EPIPE', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UND_ERR_CONNECT_TIMEOUT',
  'MISSING_ALPACA_ENV', 'ALPACA_REQUEST_FAILED',
])

export function researchErrorCode(error) {
  for (const code of [error?.code, error?.cause?.code]) {
    if (operationalCodes.has(code)) return code
    // PostgreSQL SQLSTATE: five uppercase alphanumeric characters.
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
  }
  return null
}
