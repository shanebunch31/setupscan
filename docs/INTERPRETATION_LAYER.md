# Interpretation Layer v1

`src/research/interpretation.js` exports `interpretResearchSummary(summary)`.
Pass the existing compact Research Run summary (`runId`, `datasetId`, revision/provenance and `synthesis`), or its schema-v1 synthesis directly. The module is a pure view-model: no clock, network, storage, experiment execution, qualification, ranking persistence or mutation. It is intentionally not wired into UI or saved payloads in this first pass.

## Output contract

- `schemaVersion: 1`, `status`, `headline`, `summary`.
- `coverage`: saved requested/evaluated/incomplete/unavailable IDs, missing requested IDs and coverage state.
- `evidenceStrength`: experiment-specific classification and per-evidence assessments with sample size, original label, rule basis and reference. Counts are not summed across overlapping evidence.
- `supportingPoints`, `cautionPoints`: `{ code, text, references }`; conflict cautions also retain source ID and observation.
- `unresolvedQuestions`: saved question strings, or `[]`. The layer does not invent questions.
- `discoveryCandidates`: detached saved metrics, sample assessment, direction, scoped summary and reference. These stay in identifier order, not a performance ranking.
- `comparisonScope`: matched Discovery comparisons, saved shared-family relationships, unranked references and cross-experiment pairs with no saved comparison contract.
- `provenance`: available run/dataset/code/EMA/adjustment identifiers and per-evidence experiment/strategy/methodology/metrics-key references. No native payloads or candle arrays are copied.

The contract contains plain data/text for later rendering. Render text as text; it is not HTML. Consumers must retain cautions and scope beside conclusions.

## Classification rules

Status precedence is conservative: unsupported/absent evidence or wholly unavailable coverage → `unavailable`; coverage gaps or contradictory header provenance → `incomplete`; saved conflicts → `mixed`. For one verified overall Discovery scope, expectancy signs describe `positive`, `negative`, `neutral`, or `mixed`; missing metrics/counts yield `unavailable`/`incomplete`, and insufficient samples yield `insufficient-evidence`. Other experiments remain scoped/neutral rather than becoming a combined performance result. A complete run is not automatically positive.

Saved context labels such as `insufficient-evidence`, `small-exploratory-sample`, `descriptive-only` and `stronger-descriptive-evidence` normalize to insufficient/exploratory/descriptive, retaining the original label. Direct and nested classifications already retained by the adapters are recognized. Unknown labels remain unknown.

For `strategy-discovery-2` only, protocol section 7 supplies the existing guideline: fewer than 100 recorded occurrences are insufficient/low-evidence for this interpretation, and 100+ supports exploratory consideration. A 200+ sample is not upgraded to descriptive or validated evidence. Zero samples do not turn zero-valued metrics into a result. No universal threshold, confidence score, statistical significance or qualification/promotion rule is created. Native period/cost checks omitted from compact synthesis are not reconstructed.

## Comparison guardrails

A highest-recorded-expectancy statement requires at least two distinct Discovery strategy IDs, their overall metrics keys, complete coverage, sufficient known samples, no saved conflicts or header provenance contradictions, and matching recorded run/dataset, symbols, timeframe, provider, EMA/adjustment contract, methodology, membership, date ranges, out-of-sample role and supported cost assumptions. Missing/legacy/ambiguous scope withholds ordering. Only the current known Discovery methodology gets this comparison treatment. Ties retain every tied strategy; a higher negative number remains negative evidence.

Saved evidence-family notes indicate shared construction, never independent confirmation or permission to rank experiments. Baseline, relative-value, volatility, context/regime and Discovery outputs are not pooled into a common score or cross-family ranking. Cost assumptions marked not modeled are not assumed zero. Experiment-specific period/cost detail and some legacy provenance may be absent; the module reports that limitation instead of fetching full records or changing saved semantics.
