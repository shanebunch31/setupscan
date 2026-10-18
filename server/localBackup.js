import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_LOCAL_BACKUP_FILES = [
  { relativePath: 'server/data/paper-trades.json', required: false },
]

const EXCLUDED_PATH_PART = /(^|[\\/])(?:node_modules|dist|build|coverage|cache|tmp|temp)(?:[\\/]|$)/i

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function portableRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function canonicalPath(candidate) {
  const absolute = path.resolve(candidate)
  let existing = absolute
  const suffix = []
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) throw new Error('Could not resolve the backup destination path safely.')
    suffix.unshift(path.basename(existing))
    existing = parent
  }
  const realExisting = fs.realpathSync(existing)
  return path.resolve(realExisting, ...suffix)
}

function validateRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error('Backup source paths must be non-empty relative paths.')
  }
  const normalized = path.normalize(relativePath)
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`) || normalized === '.') {
    throw new Error('Backup source paths must stay inside the project.')
  }
  const segments = normalized.split(/[\\/]/)
  const containsSecretLikeName = segments.some((segment) =>
    segment.toLowerCase().startsWith('.env') || /secret|credential|token|private/i.test(segment) || /\.(?:pem|key)$/i.test(segment),
  )
  if (containsSecretLikeName || EXCLUDED_PATH_PART.test(normalized)) {
    throw new Error(`The requested backup source is excluded for safety: ${relativePath}`)
  }
  return normalized
}

function statSignature(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`
}

function readStableSource(sourcePath, relativePath) {
  const linkStat = fs.lstatSync(sourcePath)
  if (!linkStat.isFile() || linkStat.isSymbolicLink()) {
    throw new Error(`Backup source is not a regular file: ${relativePath}`)
  }
  const before = fs.statSync(sourcePath)
  const bytes = fs.readFileSync(sourcePath)
  const after = fs.statSync(sourcePath)
  if (statSignature(before) !== statSignature(after) || bytes.length !== after.size) {
    throw new Error(`Backup source changed while being read: ${relativePath}`)
  }
  return { bytes, signature: statSignature(after), checksum: sha256(bytes) }
}

function validateJson(relativePath, bytes) {
  if (!relativePath.toLowerCase().endsWith('.json')) return 'not-applicable'
  try {
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '')
    JSON.parse(text)
    return 'valid'
  } catch {
    throw new Error(`Backup source contains invalid JSON: ${relativePath}`)
  }
}

function safeTimestamp(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('Backup timestamp must be a valid date.')
  }
  return date.toISOString()
}

/**
 * Copies explicitly selected local persistent files into a new, non-overwriting
 * backup directory. File bytes are preserved exactly; the manifest contains
 * metadata and checksums only, never file contents.
 */
export function createLocalBackup({
  sourceRoot = process.cwd(),
  destinationRoot = path.join(os.homedir(), 'SetupScanBackups'),
  files = DEFAULT_LOCAL_BACKUP_FILES,
  now = new Date(),
} = {}) {
  const sourceBase = fs.realpathSync(sourceRoot)
  const destinationBase = canonicalPath(destinationRoot)
  if (isWithin(sourceBase, destinationBase)) {
    throw new Error('Backup destination must be outside the project repository.')
  }

  const createdAt = safeTimestamp(now)
  const skippedSources = []
  const candidates = []

  for (const entry of files) {
    const relativePath = validateRelativePath(entry?.relativePath)
    const sourcePath = path.resolve(sourceBase, relativePath)
    if (!isWithin(sourceBase, sourcePath)) {
      throw new Error(`Backup source path escapes the project: ${relativePath}`)
    }
    if (!fs.existsSync(sourcePath)) {
      if (entry.required) throw new Error(`Required backup source is missing: ${relativePath}`)
      skippedSources.push({ sourcePath: portableRelativePath(relativePath), reason: 'not-present' })
      continue
    }
    const realSourcePath = fs.realpathSync(sourcePath)
    if (!isWithin(sourceBase, realSourcePath)) {
      throw new Error(`Backup source resolves outside the project: ${relativePath}`)
    }
    const source = readStableSource(realSourcePath, relativePath)
    const jsonSyntax = validateJson(relativePath, source.bytes)
    candidates.push({ relativePath, sourcePath: realSourcePath, ...source, jsonSyntax })
  }

  if (candidates.length === 0) {
    throw new Error('No eligible local data files were found; no backup was created.')
  }

  fs.mkdirSync(destinationBase, { recursive: true, mode: 0o700 })
  const resolvedDestinationBase = fs.realpathSync(destinationBase)
  if (isWithin(sourceBase, resolvedDestinationBase)) {
    throw new Error('Backup destination resolves inside the project repository.')
  }

  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const backupDirectory = path.join(resolvedDestinationBase, `setupscan-${stamp}-${randomUUID()}`)
  fs.mkdirSync(backupDirectory, { mode: 0o700 })
  const manifest = {
    manifestVersion: 1,
    createdAt,
    status: 'complete',
    files: [],
    skippedSources,
  }
  const manifestPath = path.join(backupDirectory, 'manifest.json')

  try {
    for (const candidate of candidates) {
      const backupRelativePath = path.join('files', candidate.relativePath)
      const backupPath = path.join(backupDirectory, backupRelativePath)
      fs.mkdirSync(path.dirname(backupPath), { recursive: true })
      fs.writeFileSync(backupPath, candidate.bytes, { flag: 'wx', mode: 0o600 })

      const copiedBytes = fs.readFileSync(backupPath)
      const currentSource = readStableSource(candidate.sourcePath, candidate.relativePath)
      const checksumMatches = sha256(copiedBytes) === candidate.checksum &&
        currentSource.checksum === candidate.checksum
      if (!checksumMatches) {
        throw new Error(`Backup integrity check failed for ${candidate.relativePath}`)
      }
      if (currentSource.signature !== candidate.signature) {
        throw new Error(`Backup source changed during copy: ${candidate.relativePath}`)
      }

      manifest.files.push({
        sourcePath: portableRelativePath(candidate.relativePath),
        backupPath: portableRelativePath(path.relative(backupDirectory, backupPath)),
        sizeBytes: copiedBytes.length,
        sha256: candidate.checksum,
        validation: {
          status: 'passed',
          checksumMatches: true,
          sourceStable: true,
          jsonSyntax: candidate.jsonSyntax,
        },
      })
    }
  } catch (error) {
    manifest.status = 'failed'
    manifest.failure = error.message
    try {
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    } catch {
      // Preserve the original failure; the partial directory remains available for inspection.
    }
    throw new Error(`${error.message}. A partial backup, if any, was left at ${backupDirectory}`)
  }

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  return { backupDirectory, manifestPath, manifest }
}
