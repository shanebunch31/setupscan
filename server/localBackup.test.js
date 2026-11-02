import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createPaperStore } from './paperStore.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createLocalBackup } from './localBackup.js'

function tempDirectories() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'setupscan-backup-test-'))
  const sourceRoot = path.join(parent, 'project')
  const destinationRoot = path.join(parent, 'outside-backups')
  fs.mkdirSync(sourceRoot)
  return { parent, sourceRoot, destinationRoot }
}

test('local backup preserves file bytes and validates manifest checksums and JSON', () => {
  const { parent, sourceRoot, destinationRoot } = tempDirectories()
  try {
    const relativePath = 'server/data/paper-trades.json'
    const sourcePath = path.join(sourceRoot, relativePath)
    const bytes = Buffer.from('{\n  "trades": [],\n  "note": "preserve spacing"\n}\n')
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
    fs.writeFileSync(sourcePath, bytes)

    const result = createLocalBackup({ sourceRoot, destinationRoot, now: new Date('2026-10-17T12:34:56.000Z') })
    const file = result.manifest.files[0]

    assert.equal(result.manifest.status, 'complete')
    assert.equal(file.sourcePath, relativePath)
    assert.equal(file.sizeBytes, bytes.length)
    assert.equal(file.sha256.length, 64)
    assert.equal(file.validation.status, 'passed')
    assert.equal(file.validation.checksumMatches, true)
    assert.equal(file.validation.sourceStable, true)
    assert.equal(file.validation.jsonSyntax, 'valid')
    assert.deepEqual(fs.readFileSync(path.join(result.backupDirectory, file.backupPath)), bytes)
    assert.deepEqual(fs.readFileSync(sourcePath), bytes)
    assert.equal(JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')).files[0].sha256, file.sha256)
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test('missing required sources fail without creating a backup directory', () => {
  const { parent, sourceRoot, destinationRoot } = tempDirectories()
  try {
    assert.throws(() => createLocalBackup({
      sourceRoot,
      destinationRoot,
      files: [{ relativePath: 'server/data/paper-trades.json', required: true }],
    }), /Required backup source is missing/)
    assert.equal(fs.existsSync(destinationRoot), false)
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test('invalid JSON fails before any backup is created', () => {
  const { parent, sourceRoot, destinationRoot } = tempDirectories()
  try {
    const sourcePath = path.join(sourceRoot, 'journal.json')
    fs.writeFileSync(sourcePath, '{ invalid json')
    assert.throws(() => createLocalBackup({
      sourceRoot,
      destinationRoot,
      files: [{ relativePath: 'journal.json', required: true }],
    }), /invalid JSON/)
    assert.equal(fs.existsSync(destinationRoot), false)
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test('optional missing files are reported, while present files are backed up', () => {
  const { parent, sourceRoot, destinationRoot } = tempDirectories()
  try {
    fs.writeFileSync(path.join(sourceRoot, 'available.json'), '{"ok":true}')
    const result = createLocalBackup({
      sourceRoot,
      destinationRoot,
      files: [
        { relativePath: 'missing.json', required: false },
        { relativePath: 'available.json', required: true },
      ],
    })
    assert.deepEqual(result.manifest.skippedSources, [{ sourcePath: 'missing.json', reason: 'not-present' }])
    assert.equal(result.manifest.files.length, 1)
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test('repeated backup runs create distinct timestamped directories without overwriting', () => {
  const { parent, sourceRoot, destinationRoot } = tempDirectories()
  try {
    fs.writeFileSync(path.join(sourceRoot, 'journal.json'), '{"trades":[]}')
    const options = {
      sourceRoot,
      destinationRoot,
      files: [{ relativePath: 'journal.json', required: true }],
      now: new Date('2026-10-17T12:34:56.000Z'),
    }
    const first = createLocalBackup(options)
    const second = createLocalBackup(options)
    assert.notEqual(first.backupDirectory, second.backupDirectory)
    assert.equal(fs.existsSync(first.manifestPath), true)
    assert.equal(fs.existsSync(second.manifestPath), true)
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test('backup refuses destinations inside the project and reports filesystem failures', () => {
  const { parent, sourceRoot, destinationRoot } = tempDirectories()
  try {
    fs.writeFileSync(path.join(sourceRoot, 'journal.json'), '{"trades":[]}')
    assert.throws(() => createLocalBackup({
      sourceRoot,
      destinationRoot: path.join(sourceRoot, 'backups'),
      files: [{ relativePath: 'journal.json', required: true }],
    }), /outside the project repository/)

    const blockedDestination = path.join(parent, 'destination-is-a-file')
    fs.writeFileSync(blockedDestination, 'block')
    assert.throws(() => createLocalBackup({
      sourceRoot,
      destinationRoot: blockedDestination,
      files: [{ relativePath: 'journal.json', required: true }],
    }), /EEXIST|ENOTDIR|already exists|not a directory/i)
    assert.equal(fs.readFileSync(path.join(sourceRoot, 'journal.json'), 'utf8'), '{"trades":[]}')
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test('backup source filters reject credentials, repository outputs, and path traversal', () => {
  const { parent, sourceRoot, destinationRoot } = tempDirectories()
  try {
    for (const relativePath of ['.env', 'credentials/token.json', 'dist/data.json', '../outside.json']) {
      assert.throws(() => createLocalBackup({
        sourceRoot,
        destinationRoot,
        files: [{ relativePath, required: true }],
      }))
    }
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test('default backup and isolated restore preserve journal plus authoritative empty universe byte-for-byte', () => {
  const { parent, sourceRoot, destinationRoot } = tempDirectories()
  try {
    const journal = Buffer.from('{"trades":[{"symbol":"SPY","status":"open","stopPrice":101}],"observer":{"processedCandles":{"SPY":"2026-10-30T16:00:00Z"}}}\n')
    const universe = Buffer.from('{ "initialized": true, "symbols": [] }\n')
    const journalRelative = 'server/data/paper-trades.json'
    fs.mkdirSync(path.join(sourceRoot, 'server/data'), { recursive: true })
    fs.writeFileSync(path.join(sourceRoot, journalRelative), journal)
    fs.writeFileSync(path.join(sourceRoot, journalRelative + '.symbols.json'), universe)
    fs.writeFileSync(path.join(sourceRoot, journalRelative + '.symbols.json.tmp'), '{partial')
    const result = createLocalBackup({ sourceRoot, destinationRoot })
    assert.deepEqual(result.manifest.files.map((entry) => entry.sourcePath), [journalRelative, journalRelative + '.symbols.json'])
    const restoreRoot = path.join(parent, 'isolated-restore')
    for (const entry of result.manifest.files) {
      const bytes = fs.readFileSync(path.join(result.backupDirectory, entry.backupPath))
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256)
      const target = path.join(restoreRoot, entry.sourcePath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, bytes, { flag: 'wx' })
    }
    const restored = createPaperStore(path.join(restoreRoot, journalRelative))
    assert.deepEqual(restored.load(), JSON.parse(journal))
    assert.deepEqual(restored.ensureObserverSymbols(() => { throw Error('restored empty universe must not seed') }), [])
    assert.deepEqual(fs.readFileSync(path.join(sourceRoot, journalRelative)), journal)
    assert.deepEqual(fs.readFileSync(path.join(sourceRoot, journalRelative + '.symbols.json')), universe)
  } finally { fs.rmSync(parent, { recursive: true, force: true }) }
})

test('universe-only development state is backed up and missing journal is reported explicitly', () => {
  const { parent, sourceRoot, destinationRoot } = tempDirectories()
  try {
    const store = createPaperStore(path.join(sourceRoot, 'server/data/paper-trades.json'))
    store.setObserverSymbols([])
    const result = createLocalBackup({ sourceRoot, destinationRoot })
    assert.equal(result.manifest.status, 'complete')
    assert.deepEqual(result.manifest.skippedSources, [{ sourcePath: 'server/data/paper-trades.json', reason: 'not-present' }])
    assert.equal(result.manifest.files[0].sourcePath, 'server/data/paper-trades.json.symbols.json')
    assert.equal(fs.existsSync(path.join(sourceRoot, 'server/data/paper-trades.json')), false)
  } finally { fs.rmSync(parent, { recursive: true, force: true }) }
})

test('corrupt universe JSON prevents a successful default backup without modifying either source', () => {
  const { parent, sourceRoot, destinationRoot } = tempDirectories()
  try {
    const store = createPaperStore(path.join(sourceRoot, 'server/data/paper-trades.json'))
    store.save({ trades: [{ id: 'retained-history' }] })
    const journal = fs.readFileSync(path.join(sourceRoot, 'server/data/paper-trades.json'))
    fs.writeFileSync(path.join(sourceRoot, 'server/data/paper-trades.json.symbols.json'), '{broken')
    assert.throws(() => createLocalBackup({ sourceRoot, destinationRoot }), /invalid JSON/)
    assert.equal(fs.existsSync(destinationRoot), false)
    assert.deepEqual(fs.readFileSync(path.join(sourceRoot, 'server/data/paper-trades.json')), journal)
    assert.equal(fs.readFileSync(path.join(sourceRoot, 'server/data/paper-trades.json.symbols.json'), 'utf8'), '{broken')
  } finally { fs.rmSync(parent, { recursive: true, force: true }) }
})
