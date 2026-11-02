import fs from 'node:fs'
import path from 'node:path'
import { createLocalPaperUniverseStore } from './localPaperUniverseStore.js'

export function createPaperStore(filePath) {
  function validate(state) {
    // A present but structurally corrupt file must not become a fresh journal.
    // Missing files alone retain the development first-run behavior below.
    if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.trades)) {
      throw Object.assign(new Error('Invalid local paper journal: expected an object with a trades array; restore a verified copy before resuming.'), { code: 'PAPER_STATE_INVALID' })
    }
    return state
  }
  function load() {
    try {
      return validate(JSON.parse(fs.readFileSync(filePath, 'utf8')))
    } catch (error) {
      if (error.code === 'ENOENT') return { trades: [] }
      throw error
    }
  }

  function save(state) {
    validate(state)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const temporaryPath = `${filePath}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2))
    fs.renameSync(temporaryPath, filePath)
  }

  return { load, read: load, save, ...createLocalPaperUniverseStore(`${filePath}.symbols.json`) }
}
