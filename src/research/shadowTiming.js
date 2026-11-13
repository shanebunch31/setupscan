// Frozen observation timing policies; changing a policy requires a new protocol.
export function shadowTiming(version) {
  if (version === 'shadow-forward-1') return { publicationGraceMs: 0, detectionWindowMs: 300000, continuityMs: 300000 }
  if (version === 'shadow-forward-2') return { publicationGraceMs: 600000, detectionWindowMs: 300000, continuityMs: 300000 }
  throw Object.assign(new Error('Unsupported Shadow protocol'), { shadowCode: 'INCOMPATIBLE_PROTOCOL' })
}
