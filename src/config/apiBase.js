// Single source of truth for the API base URL used by all frontend fetch calls.
// VITE_API_BASE_URL overrides everything (set this in Vercel for production).
// Local development uses the SetupScan API server on port 3001.

const env = import.meta.env ?? {}

const productionFallback = 'https://setupscan-api.onrender.com'
const developmentFallback = 'http://localhost:3001'

export const API_BASE_URL =
  env.VITE_API_BASE_URL ||
  (env.PROD ? productionFallback : developmentFallback)

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`
}