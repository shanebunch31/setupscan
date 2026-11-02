import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const result = await build({ configFile: false, logLevel: 'silent', build: {
  write: false, minify: false, lib: { entry: fileURLToPath(new URL('./ResearchLabsOverview.jsx', import.meta.url)), formats: ['es'] },
  rolldownOptions: { external: ['react'], output: { paths: { react: pathToFileURL(require.resolve('react')).href } } },
} })
const code = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk' && item.isEntry).code
const { ResearchLabsOverview } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const palette = [
  ['quick-backtest', 'Quick Backtest', 'cyan', '#28c7ff'],
  ['strategy-discovery', 'Strategy Discovery', 'green', '#18e6a5'],
  ['robustness', 'Strategy Resilience', 'violet', '#cf73ff'],
  ['relative-value', 'Relative Value', 'amber', '#ffac34'],
  ['signal-quality', 'Signal Quality / Expected Value', 'cyan', '#28c7ff'],
  ['frozen-score-holdout', 'Frozen Score Holdout', 'green', '#18e6a5'],
  ['yearly-regime', 'Yearly / Regime Stability', 'violet', '#cf73ff'],
  ['causal-regime', 'Causal Market-Regime Analysis', 'amber', '#ffac34'],
  ['walk-forward-regime', 'Walk-Forward Regime Validation', 'cyan-blue', '#27d7ff'],
  ['volatility-aware-variants', 'Volatility-Aware Variants', 'magenta', '#f06cff'],
]
function descendants(element, match) {
  if (!element || typeof element !== 'object') return []
  return [...(match(element) ? [element] : []), ...React.Children.toArray(element.props?.children).flatMap(child => descendants(child, match))]
}
const run = (id) => ({ runId: `run-${id}`, requestedExperiments: [id], requestedAt: '2026-11-01T12:00:00Z', symbols: ['SPY'], timeframe: '1Hour', status: 'completed' })

test('Recent Lab Results pills match actual launch-card ownership and exact shared accent tokens', () => {
  const opened = [], history = []
  const tree = ResearchLabsOverview({ runs: palette.map(([id]) => run(id)), onOpenLab: id => opened.push(id), onOpenHistory: id => history.push(id) })
  const chips = descendants(tree, node => node.type === 'span' && node.props.className?.startsWith('labs-overview-lab-chip'))
  const cards = descendants(tree, node => node.props?.className?.startsWith('labs-overview-card ') || node.props?.className?.startsWith('labs-overview-advanced-card '))
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  assert.equal(chips.length, palette.length)
  for (const [index, [id, title, tone, hex]] of palette.entries()) {
    assert.equal(chips[index].props.className, `labs-overview-lab-chip is-${tone}`)
    assert.equal(chips[index].props.children, title)
    const card = cards.find(node => descendants(node, child => child.type === 'h2' || child.type === 'h3').some(heading => heading.props.children === title))
    assert.ok(card, `launch card for ${id}`)
    assert.ok(card.props.className.includes(`is-${tone}`))
    descendants(card, node => node.type === 'button')[0].props.onClick()
    assert.equal(opened.at(-1), id)
    const sharedRule = `:is(.labs-overview-card, .labs-overview-advanced-card, .labs-overview-lab-chip).is-${tone}`
    const rule = css.slice(css.indexOf(sharedRule), css.indexOf('}', css.indexOf(sharedRule)))
    assert.ok(rule.includes(`--lab-accent: ${hex}`))
    assert.match(rule, /--lab-soft:/)
    assert.match(rule, /--lab-border:/)
  }
  assert.match(css, /\.labs-overview-lab-chip\s*\{[^}]*color: var\(--lab-accent,[^}]*border-color: var\(--lab-border,[^}]*background: var\(--lab-soft,/)
  assert.doesNotMatch(css, /\.labs-overview-advanced-card:nth-child/)
  assert.ok(renderToStaticMarkup(tree).includes('Recent Lab Results'))
})

test('Workbench-only and unknown IDs stay neutral, readable, and preserve result-detail navigation', () => {
  const ids = ['qualification-stack-condition-count', 'scanner-component-ablation', 'candidate-execution-resolution', 'scanner-score-redundancy-stability', 'joined-context', 'future-unknown-id']
  const clicked = []
  const tree = ResearchLabsOverview({ runs: ids.map(run), onOpenHistory: id => clicked.push(id) })
  const chips = descendants(tree, node => node.type === 'span' && node.props.className?.startsWith('labs-overview-lab-chip'))
  assert.equal(chips.length, ids.length)
  assert.ok(chips.every(chip => chip.props.className === 'labs-overview-lab-chip is-neutral'))
  assert.equal(chips[0].props.children, 'Qualification Stack / Condition Count')
  assert.equal(chips.at(-1).props.children, 'Other research experiment')
  assert.ok(chips.every((chip, index) => chip.props.children !== ids[index]))
  const details = descendants(tree, node => node.type === 'button' && node.props.className === 'labs-overview-row-view')
  assert.equal(details.length, ids.length)
  details[0].props.onClick()
  assert.deepEqual(clicked, ['run-' + ids[0]])
})
