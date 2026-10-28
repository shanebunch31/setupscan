import React, {
  useEffect,
  useState,
} from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CircleHelp,
  ShieldCheck,
  Target,
} from 'lucide-react'
import { apiUrl } from '../config/apiBase.js'
import { MarketStatus } from '../MarketStatus.js'
import { formatMarketTime } from '../marketTime.js'
import { listResearchRuns } from '../research/researchRunHistory.js'
import { getResearchExperiment } from '../research/registry.js'
import './morningBrief.css'

const BRIEF_VISIT_STORAGE_KEY =
  'setupscan:last-morning-brief-visit'

export function MorningBrief({
  currentTime,
  results = [],
  scanLoading = false,
  scanUnavailable = [],
  scanDataQuality = [],
  onOpenSetup = () => {},
  onOpenPaper = () => {},
  onOpenResearch = () => {},
}) {
  const [researchRuns, setResearchRuns] =
    useState([])
  const [
    researchLoading,
    setResearchLoading,
  ] = useState(true)
  const [
    researchError,
    setResearchError,
  ] = useState(null)

  const [
    paperSnapshot,
    setPaperSnapshot,
  ] = useState(null)
  const [
    paperLoading,
    setPaperLoading,
  ] = useState(true)
  const [paperError, setPaperError] =
    useState(null)

  const [previousVisit] = useState(() => {
    if (typeof window === 'undefined') {
      return null
    }

    try {
      return window.localStorage.getItem(
        BRIEF_VISIT_STORAGE_KEY,
      )
    } catch {
      return null
    }
  })

  useEffect(() => {
    let active = true

    setResearchLoading(true)
    setPaperLoading(true)

    listResearchRuns({
      limit: 6,
      offset: 0,
    })
      .then((response) => {
        if (!active) return

        setResearchRuns(
          Array.isArray(response?.runs)
            ? response.runs
            : [],
        )

        setResearchError(null)
      })
      .catch((error) => {
        if (!active) return
        setResearchError(error.message)
      })
      .finally(() => {
        if (active) {
          setResearchLoading(false)
        }
      })

    fetch(apiUrl('/api/paper-trading'))
      .then((response) =>
        response
          .json()
          .then((data) => ({
            response,
            data,
          })),
      )
      .then(({ response, data }) => {
        if (!response.ok) {
          throw new Error(
            data?.error ??
              'Paper journal unavailable',
          )
        }

        if (!active) return

        setPaperSnapshot(data)
        setPaperError(null)
      })
      .catch((error) => {
        if (!active) return
        setPaperError(error.message)
      })
      .finally(() => {
        if (active) {
          setPaperLoading(false)
        }
      })

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          BRIEF_VISIT_STORAGE_KEY,
          new Date().toISOString(),
        )
      } catch {
        // Brief still works if local storage
        // is unavailable.
      }
    }

    return () => {
      active = false
    }
  }, [])

  const eligibleSetups = [...results]
    .filter(
      (item) =>
        item.qualifiedSetup === true ||
        item.potentialSetup === true,
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return left.symbol.localeCompare(
        right.symbol,
      )
    })

  const strongestSetups =
    eligibleSetups.slice(0, 4)

  const openPaperTrades = Array.isArray(
    paperSnapshot?.trades,
  )
    ? paperSnapshot.trades.filter(
        (trade) => trade.status === 'open',
      )
    : []

  const openPaperSymbols = [
    ...new Set(
      openPaperTrades
        .map((trade) => trade.symbol)
        .filter(Boolean),
    ),
  ]

  const dataHealth =
    scanLoading
      ? 'Checking'
      : scanUnavailable.length ||
          scanDataQuality.length
        ? 'Partial'
        : results.length
          ? 'Healthy'
          : 'Unavailable'

  const previousVisitMs =
    previousVisit == null
      ? NaN
      : Date.parse(previousVisit)

  const isNewResearchRun = (run) => {
    const runTime = Date.parse(
      run?.requestedAt,
    )

    return (
      Number.isFinite(previousVisitMs) &&
      Number.isFinite(runTime) &&
      runTime > previousVisitMs
    )
  }

  const newResearchCount =
    researchRuns.filter(
      isNewResearchRun,
    ).length

  const attentionItems = []

  if (scanUnavailable.length) {
    attentionItems.push(
      `Scanner data unavailable or incomplete: ${scanUnavailable.join(', ')}`,
    )
  }

  scanDataQuality
    .slice(0, 3)
    .forEach((message) =>
      attentionItems.push(message),
    )

  if (scanDataQuality.length > 3) {
    attentionItems.push(
      `${scanDataQuality.length - 3} additional scanner data-quality notice${scanDataQuality.length - 3 === 1 ? '' : 's'} available on the Scan page.`,
    )
  }

  if (paperError) {
    attentionItems.push(
      `Paper journal: ${paperError}`,
    )
  }

  if (researchError) {
    attentionItems.push(
      `Research history: ${researchError}`,
    )
  }

  return (
    <section className="morning-brief">
      <header className="morning-brief-header">
        <div>
          <p className="eyebrow">
            SETUPSCAN DAILY OPERATIONS
          </p>

          <h1>Morning Brief</h1>

          <p>
            What SetupScan sees, what research
            changed, and what needs your
            attention.
          </p>
        </div>

        <div className="morning-brief-header-status">
          <MarketStatus now={currentTime} />

          <small>
            Evidence first. No automatic
            strategy promotion or live trading.
          </small>
        </div>
      </header>

      <div className="brief-summary-grid">
        <article className="brief-summary-card">
          <div className="brief-summary-icon">
            <Activity size={20} />
          </div>

          <div>
            <span>Market</span>

            <strong>
              <MarketStatus
                now={currentTime}
              />
            </strong>

            <small>
              Latest completed 1-hour snapshots
              are shown in the top bar.
            </small>
          </div>
        </article>

        <article className="brief-summary-card">
          <div className="brief-summary-icon">
            <ShieldCheck size={20} />
          </div>

          <div>
            <span>Scanner Data</span>

            <strong>{dataHealth}</strong>

            <small>
              {scanLoading
                ? 'Checking scanner data.'
                : `${results.length} evaluated · ${scanUnavailable.length} unavailable`}
            </small>
          </div>
        </article>

        <article className="brief-summary-card">
          <div className="brief-summary-icon">
            <CircleHelp size={20} />
          </div>

          <div>
            <span>Open Paper Positions</span>

            <strong>
              {paperLoading
                ? '—'
                : paperError
                  ? 'Unavailable'
                  : openPaperTrades.length}
            </strong>

            <small>
              {openPaperSymbols.length
                ? openPaperSymbols.join(' · ')
                : paperLoading
                  ? 'Checking the persisted paper journal.'
                  : 'No open paper positions.'}
            </small>
          </div>
        </article>

        <article className="brief-summary-card">
          <div className="brief-summary-icon">
            <Target size={20} />
          </div>

          <div>
            <span>Current Setups</span>

            <strong>
              {scanLoading
                ? '—'
                : eligibleSetups.length}
            </strong>

            <small>
              Qualified + Potential setups from
              the current rule-based scanner.
            </small>
          </div>
        </article>
      </div>

      <div className="brief-main-grid">
        <section className="brief-panel">
          <div className="brief-panel-heading">
            <div>
              <p className="eyebrow">
                CURRENT SCANNER
              </p>

              <h2>
                Strongest Current Setups
              </h2>
            </div>

            <span>
              {eligibleSetups.length} found
            </span>
          </div>

          <div className="brief-setup-list">
            {scanLoading ? (
              <p className="brief-empty">
                Loading scanner results…
              </p>
            ) : strongestSetups.length ? (
              strongestSetups.map((setup) => (
                <button
                  type="button"
                  className="brief-setup-row"
                  key={setup.symbol}
                  onClick={() =>
                    onOpenSetup(setup.symbol)
                  }
                >
                  <div>
                    <strong>
                      {setup.symbol}
                    </strong>

                    <span>
                      {setup.status}
                    </span>
                  </div>

                  <div>
                    <strong>
                      {setup.score}
                      <small>/100</small>
                    </strong>

                    <ArrowRight size={15} />
                  </div>
                </button>
              ))
            ) : (
              <p className="brief-empty">
                No current Qualified or Potential
                setups are available. That is a
                valid scanner result, not an
                error.
              </p>
            )}
          </div>
        </section>

        <section className="brief-panel">
          <div className="brief-panel-heading">
            <div>
              <p className="eyebrow">
                RESEARCH ACTIVITY
              </p>

              <h2>Recent Research</h2>
            </div>

            <span>
              {Number.isFinite(previousVisitMs)
                ? `${newResearchCount} new`
                : 'Recent runs'}
            </span>
          </div>

          <div className="brief-research-list">
            {researchLoading ? (
              <p className="brief-empty">
                Loading saved research runs…
              </p>
            ) : researchError ? (
              <p className="brief-empty">
                Research history is currently
                unavailable.
              </p>
            ) : researchRuns.length ? (
              researchRuns
                .slice(0, 4)
                .map((run) => {
                  const experimentTitles = (
                    run.requestedExperiments ?? []
                  ).map(
                    (id) =>
                      getResearchExperiment(id)
                        ?.title ?? id,
                  )

                  const visibleTitles =
                    experimentTitles
                      .slice(0, 2)
                      .join(' + ')

                  const additionalCount =
                    Math.max(
                      0,
                      experimentTitles.length - 2,
                    )

                  return (
                    <article
                      className="brief-research-row"
                      key={run.runId}
                    >
                      <div className="brief-research-title">
                        <strong>
                          {visibleTitles ||
                            'Research run'}
                        </strong>

                        {isNewResearchRun(
                          run,
                        ) ? (
                          <span>NEW</span>
                        ) : null}
                      </div>

                      <p>
                        {run.status?.toUpperCase() ??
                          'UNKNOWN'}
                        {' · '}
                        {(run.symbols ?? []).join(
                          ', ',
                        ) || 'No symbols'}
                        {' · '}
                        {run.timeframe ??
                          'Timeframe unavailable'}
                      </p>

                      <small>
                        {formatMarketTime(
                          run.requestedAt,
                          {
                            includeDate: true,
                          },
                        )}

                        {additionalCount > 0
                          ? ` · +${additionalCount} more experiment${additionalCount === 1 ? '' : 's'}`
                          : ''}
                      </small>
                    </article>
                  )
                })
            ) : (
              <p className="brief-empty">
                No saved research runs are
                available yet.
              </p>
            )}
          </div>

          <p className="brief-evidence-note">
            A completed research run means the
            experiment executed. It does not by
            itself mean a strategy was validated
            or promoted.
          </p>

          <button
            type="button"
            className="brief-link-button"
            onClick={onOpenResearch}
          >
            Open Research History
            <ArrowRight size={14} />
          </button>
        </section>
      </div>

      <section className="brief-panel brief-attention-panel">
        <div className="brief-panel-heading">
          <div>
            <p className="eyebrow">
              OPERATIONAL CHECK
            </p>

            <h2>Needs Attention</h2>
          </div>

          <AlertTriangle size={18} />
        </div>

        {attentionItems.length ? (
          <div className="brief-attention-list">
            {attentionItems.map(
              (message, index) => (
                <div
                  key={`${index}-${message}`}
                >
                  <AlertTriangle
                    size={14}
                  />

                  <span>{message}</span>
                </div>
              ),
            )}
          </div>
        ) : (
          <div className="brief-all-clear">
            <ShieldCheck size={16} />

            <span>
              No current scanner,
              paper-journal, or
              research-history warnings are
              being reported by these checks.
            </span>
          </div>
        )}

        <div className="brief-bottom-actions">
          <button
            type="button"
            className="brief-link-button"
            onClick={onOpenPaper}
          >
            Open Paper Trading
            <ArrowRight size={14} />
          </button>

          <small>
            SetupScan should explain weak or
            missing evidence just as clearly as
            strong evidence.
          </small>
        </div>
      </section>
    </section>
  )
}