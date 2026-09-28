export function resolveBuildRevision(gitCommitSha, readGitSha = () => null) {
  if (typeof gitCommitSha === 'string' && gitCommitSha.trim()) return gitCommitSha.trim()
  try {
    const revision = readGitSha()
    return typeof revision === 'string' && revision.trim() ? revision.trim() : null
  } catch {
    return null
  }
}

export function buildRevisionDefine(revision) {
  return { 'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(revision ?? null) }
}
