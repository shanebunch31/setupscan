#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalBackup } from '../server/localBackup.js'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

function usage() {
  console.log('Usage: node scripts/backup-local-data.js [--destination <directory>]')
  console.log('The destination must be outside the SetupScan repository.')
}

if (args.includes('--help') || args.includes('-h')) {
  usage()
} else {
  let destinationRoot
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--destination' || !args[index + 1]) {
      console.error('Unknown or incomplete backup option.')
      usage()
      process.exitCode = 2
      break
    }
    if (destinationRoot !== undefined) {
      console.error('Specify the backup destination only once.')
      process.exitCode = 2
      break
    }
    destinationRoot = path.resolve(args[index + 1])
    index += 1
  }

  if (process.exitCode !== 2) {
    try {
      const result = createLocalBackup({ sourceRoot: repositoryRoot, ...(destinationRoot ? { destinationRoot } : {}) })
      console.log(`Local backup completed: ${result.backupDirectory}`)
      console.log(`Manifest: ${result.manifestPath}`)
      for (const file of result.manifest.files) {
        console.log(`${file.sourcePath} | ${file.sizeBytes} bytes | SHA-256 ${file.sha256} | ${file.validation.status}`)
      }
      for (const skipped of result.manifest.skippedSources) {
        console.log(`${skipped.sourcePath} | skipped (${skipped.reason})`)
      }
    } catch (error) {
      console.error(`Local backup failed: ${error.message}`)
      process.exitCode = 1
    }
  }
}
