import fs from 'node:fs'
import path from 'node:path'
import { createLocalPaperUniverseStore } from './localPaperUniverseStore.js'

export function createPaperStore(filePath) {
  function load() {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return { trades: [] }
      throw error
    }
  }

  function save(state) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const temporaryPath = `${filePath}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2))
    fs.renameSync(temporaryPath, filePath)
  }

  return { load, read: load, save, ...createLocalPaperUniverseStore(`${filePath}.symbols.json`) }
}
