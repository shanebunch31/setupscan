import React from 'react'
import { TermHelp } from '../TermHelp.js'
import {
  EVIDENCE_RECORD_DATE, RESEARCH_EVIDENCE, RESEARCH_EVIDENCE_STATUSES,
  RESEARCH_PROCESS, RESEARCH_LIMITATIONS, evidenceDefinitions,
} from './researchEvidenceLibrary.js'

const h = React.createElement

export function ResearchEvidence({ onOpenHistory, onOpenShadow, metricDefinitions = [] }) {
  return h('div', { className: 'research-evidence-page' },
    h('header', { className: 'panel research-evidence-intro' },
      h('p', { className: 'eyebrow' }, 'ABOUT SETUPSCAN / RESEARCH EVIDENCE'),
      h('h1', null, 'How SetupScan researches strategies'),
      h('p', null, 'SetupScan is a trading research workspace. It tests ideas against historical evidence, challenges unstable findings and observes frozen candidates before considering any future promotion.'),
      h('p', { className: 'research-evidence-boundary' }, 'Research progress is not proof of future profitability. No study on this page automatically changes the scanner or Paper Trader.'),
      h('p', { className: 'research-evidence-caption' }, `Curated history — research record updated ${EVIDENCE_RECORD_DATE}, with completed-study notes from the roadmap. This is not a live results or worker-health dashboard.`),
      h('div', { className: 'research-evidence-actions' },
        h('a', { href: '#evidence-library' }, 'Explore the evidence'),
        h('button', { type: 'button', onClick: onOpenHistory }, 'Open technical Run History'))),
    h('section', { className: 'panel', 'aria-labelledby': 'evidence-process-heading' },
      h('h2', { id: 'evidence-process-heading' }, 'From question to evidence'),
      h('p', { className: 'research-evidence-caption' }, 'These are research steps, not confidence scores or a promise that every candidate will advance.'),
      h('ol', { className: 'research-evidence-process' }, RESEARCH_PROCESS.map(([title, text]) =>
        h('li', { key: title }, h('h3', null, title), h('p', null, text))))),
    h('section', { id: 'evidence-library', 'aria-labelledby': 'evidence-library-heading' },
      h('h2', { id: 'evidence-library-heading' }, 'Research Evidence library'),
      h('p', { className: 'research-evidence-caption' }, 'What was tested, what was learned, and what was deliberately not promoted. Status labels describe research decisions, not trading recommendations.'),
      h('div', { className: 'research-evidence-grid' }, RESEARCH_EVIDENCE.map(study =>
        h('article', { key: study.id, className: 'panel research-evidence-card', 'aria-labelledby': `evidence-${study.id}` },
          h('span', { className: `research-evidence-status evidence-status-${study.status}` }, RESEARCH_EVIDENCE_STATUSES[study.status]),
          h('h3', { id: `evidence-${study.id}` }, study.title),
          h('p', { className: 'research-evidence-question' }, study.question),
          h('p', null, h('strong', null, 'Finding: '), study.finding),
          h('div', { className: 'research-evidence-impact' }, h('strong', null, 'Did this change production?'), h('p', null, study.productionImpact)),
          study.forwardStatus ? h('p', { className: 'research-evidence-caption' }, study.forwardStatus) : null,
          h('details', { className: 'research-learning-details' },
            h('summary', null, `Study details — ${study.title}`),
            h('h4', null, 'What was tested'), h('p', null, study.tested),
            h('h4', null, 'What this means'), h('p', null, study.meaning),
            h('h4', null, 'Limitations'), h('ul', null, study.limitations.map(text => h('li', { key: text }, text))),
            h('h4', null, 'Methodology & technical evidence'),
            study.methodologyIds.length ? h('ul', null, study.methodologyIds.map(id => h('li', { key: id }, h('code', null, id))))
              : h('p', null, 'Multiple historical studies; no single methodology or saved run represents this summary.'),
            study.experimentIds.length ? h('p', null, 'Experiment: ', study.experimentIds.join(', ')) : null,
            study.candidateId ? h('p', null, 'Frozen candidate: ', h('code', null, study.candidateId)) : null,
            h('p', null, 'Technical run link unavailable — the curated source does not supply an exact saved Run ID. Use Run History to inspect records; a matching experiment name alone does not identify this evidence.'),
            h('h4', null, 'Curated sources'),
            h('ul', { className: 'research-evidence-sources' }, study.sources.map(source => h('li', { key: `${source.document}:${source.section}` }, h('code', null, source.document), ' · ', source.section))),
            study.forwardStatus ? h('button', { type: 'button', onClick: onOpenShadow }, 'Open separate Shadow Forward view') : null))))),
    h('section', { className: 'panel', 'aria-labelledby': 'evidence-limits-heading' },
      h('h2', { id: 'evidence-limits-heading' }, 'What this evidence cannot establish'),
      h('ul', { className: 'research-evidence-limits' }, RESEARCH_LIMITATIONS.map(text => h('li', { key: text }, text))),
      h('p', null, 'Scanner scoring and Qualified/Potential definitions remain unchanged. Setup Score is a rule score, not a probability of winning. This page does not enable live trading.')),
    h('details', { className: 'panel research-learning-details research-evidence-glossary' },
      h('summary', null, 'Research terms — plain-English definitions'),
      h('p', { className: 'research-evidence-caption' }, 'Metrics describe their stated historical sample; they do not establish future results.'),
      h('dl', { className: 'metrics-glossary-list' }, evidenceDefinitions(metricDefinitions).map(({ term, description }) =>
        h('div', { className: 'metrics-glossary-item', key: term },
          h('dt', null, term, ' ', h(TermHelp, { term, explanation: description })), h('dd', null, description))))))
}
