import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { BATCH_B_DEFINITIONS, BATCH_C_DEFINITIONS, DISCOVERY_HELP_TERMS } from '../help/discoveryHelp.js'
test('shared Research help preserves every Batch B/C glossary term without duplicate frozen-baseline definitions', () => {
  assert.equal(new Set(DISCOVERY_HELP_TERMS.map(x => x.term)).size, DISCOVERY_HELP_TERMS.length)
  for (const row of [...BATCH_B_DEFINITIONS, ...BATCH_C_DEFINITIONS]) {
    const help = DISCOVERY_HELP_TERMS.find(x => x.term === row.term)
    assert.ok(help, row.term)
    if (row.term !== 'Frozen baseline') assert.equal(help.definition, row.description)
    else assert.match(help.definition, /Batch B.*Batch C/)
  }
  const drawer=readFileSync(new URL('../help/SetupHelpDrawer.jsx',import.meta.url),'utf8')
  assert.match(drawer,/view === 'research'[\s\S]*QUICK_BACKTEST_TERMS, ...DISCOVERY_HELP_TERMS/)
})
test('B/C retain evidence gates and methodology details while moving only redundant glossary grids', () => {
 const page=readFileSync(new URL('./StrategyDiscoveryLab.jsx',import.meta.url),'utf8')
 assert.doesNotMatch(page,/title="Batch [BC] terms"/)
 assert.match(page,/title="Strategy Discovery terms"/)
 assert.match(page,/data-context-status=\{item.status\}/)
 assert.match(page,/\{batchBReadout.summary\}/)
 assert.match(page,/\{batchCReadout.summary\}/)
 assert.match(page,/gateEmptyObservations/)
 assert.match(page,/title="Batch B method"/)
 assert.match(page,/title="Batch C method"/)
})
