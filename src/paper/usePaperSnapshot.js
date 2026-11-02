import { useCallback, useEffect, useState } from 'react'
import { apiUrl } from '../config/apiBase.js'
import { paperStatusForSnapshot } from './paperOperationalStatus.js'

// Both screens use the same server-owned status. Refreshes never start a worker.
export function usePaperSnapshot() {
  const [snapshot, setSnapshot] = useState(null)
  const [operational, setOperational] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [clock, setClock] = useState(Date.now)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    let active = true
    let timer
    let requestController
    let inFlight = false
    async function read() {
      if (inFlight || !active) return
      inFlight = true
      clearTimeout(timer)
      setOperational(null)
      setLoading(true)
      requestController = new AbortController()
      // A browser request timeout is not an observer-staleness threshold.
      const timeout = setTimeout(() => requestController.abort(), 15000)
      let delay = 60000 // Existing dashboard refresh cadence if the server is unavailable.
      try {
        const response = await fetch(apiUrl('/api/paper-trading'), { signal: requestController.signal, cache: 'no-store' })
        const data = await response.json()
        if (!active) return
        setOperational(data.operational ?? null)
        delay = data.operational?.pollIntervalMs || data.refreshIntervalMs || delay
        if (!response.ok) throw new Error('Paper journal unavailable')
        setSnapshot(data)
        setError(null)
      } catch {
        if (active) setError('Paper journal unavailable; any displayed history is the last loaded snapshot.')
      } finally {
        clearTimeout(timeout)
        inFlight = false
        if (active) { setLoading(false); timer = setTimeout(read, delay) }
      }
    }
    const resume = () => { if (document.visibilityState === 'visible') read() }
    read()
    document.addEventListener('visibilitychange', resume)
    return () => { active = false; clearTimeout(timer); requestController?.abort(); document.removeEventListener('visibilitychange', resume) }
  }, [revision])
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer) }, [])
  return { snapshot, operational: paperStatusForSnapshot(snapshot, operational, error, clock), error, loading, refresh }
}
