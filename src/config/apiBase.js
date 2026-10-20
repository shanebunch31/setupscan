// Single source of truth for the API base URL used by all frontend fetch calls.
// VITE_API_BASE_URL overrides everything (set this in Vercel for production).
// Local development uses Vite's `/api` proxy so the browser stays on its
// current dev-server origin even when Vite selects a different port.

const env = import.meta.env ?? {}

const productionFallback = 'https://setupscan-api.onrender.com'

export function resolveApiBase(environment = {}) {
  if (environment.VITE_API_BASE_URL) return environment.VITE_API_BASE_URL
  return environment.PROD ? productionFallback : ''
}

export const API_BASE_URL = resolveApiBase(env)

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`
}
