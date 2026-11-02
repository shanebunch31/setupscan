export function paperOperationalStatus(operational, now = Date.now()) {
  if (!operational) return { healthy: false, label: 'Paper Observer health unavailable' }
  if (operational.worker === 'ALIVE' && Number.isFinite(Date.parse(operational.deadlineAt)) && now > Date.parse(operational.deadlineAt)) {
    return { ...operational, healthy: false, state: 'OVERDUE', label: 'Observer deadline passed · refresh needed to confirm current health' }
  }
  return operational
}

export function paperStatusForSnapshot(snapshot, operational, error, now = Date.now()) {
  // A legacy API can still serve history. Never upgrade that into live health.
  return {
    journal: error ? 'UNAVAILABLE' : snapshot ? 'AVAILABLE' : 'CHECKING',
    journalReadAt: snapshot?.refreshedAt ?? null,
    openPositions: !error && snapshot ? (snapshot.trades ?? []).filter(row => row.status === 'open').length : null,
    universe: snapshot?.symbolUniverse ?? null,
    checkpoints: Object.entries(snapshot?.observer?.processedCandles ?? {}).map(([symbol, timestamp]) => ({
      symbol, timestamp, enabled: snapshot?.symbolUniverse?.initialized ? snapshot.symbolUniverse.symbols.includes(symbol) : null,
      observationStatus: snapshot?.observer?.symbolResults?.[symbol]?.dataStatus ?? null,
      decisions: (snapshot?.observer?.decisionHistoryBySymbol?.[symbol] ?? []).slice(-20),
    })),
    ...paperOperationalStatus(operational, now),
  }
}
