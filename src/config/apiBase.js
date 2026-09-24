// Single source of truth for the API base URL used by all frontend fetch calls.
// VITE_API_BASE_URL overrides everything (set this in Vercel for production).
// Falls back to the Render API in production builds, and to the local dev proxy otherwise.
const env = import.meta.env ?? {}
const productionFallback = 'https://setupscan-api.onrender.com'

export const API_BASE_URL = env.VITE_API_BASE_URL || (env.PROD ? productionFallback : '')

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`
}
