export function operationalCheckState({ warnings = [], loading = false } = {}) {
  if (warnings.length) return { tone: 'warning', title: 'Needs Attention' }
  if (loading) return { tone: 'checking', title: 'Checking Systems' }
  return { tone: 'healthy', title: 'All Systems Normal' }
}
