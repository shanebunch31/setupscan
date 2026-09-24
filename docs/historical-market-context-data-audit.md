# Historical Market Context Data Audit

## Scope

This document defines the source-audit foundation for Historical Market Context
Phase 1. The intended coverage window is **2022-01-03 through 2026-09-23**,
inclusive. This phase defines authoritative sources, fields, timing rules, and
provenance requirements. It does not create the event dataset, infer missing
events, or change scanner behavior.

Historical Context is descriptive research. A relationship observed between an
event and setup behavior must not automatically become a trading filter.

## Authoritative Sources

### Federal Reserve FOMC calendars and statements

- Official source: <https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm>
- Coverage: FOMC meetings and the associated public policy statements within the
  coverage window.
- Required fields:
  - meeting date;
  - policy-statement publication timestamp;
  - original timezone of the publication timestamp;
  - source URL for the calendar or statement;
  - whether the meeting was regularly scheduled or unscheduled.
- Timing rule: the actual public statement publication timestamp is the
  information-availability timestamp. The meeting start date or meeting date is
  not a substitute for that timestamp.
- Unscheduled meetings or announcements must be identified as such from the
  official record. They must not be treated as regularly scheduled events.

### BLS CPI historical release calendars

- Official source family: <https://www.bls.gov/schedule/>
- Coverage: CPI releases within the coverage window.
- Required fields:
  - release date and time in Eastern Time;
  - release title;
  - reference period;
  - source URL;
  - information-availability timestamp.
- Timing rule: use the release time published by BLS as the availability
  timestamp. The reference period identifies the data being reported and is not
  the publication timestamp.
- The event record may include only information that was publicly available at
  the stated release time. Later revisions or later-added details must not be
  backfilled into an earlier event's information set.

### BLS Employment Situation historical release calendars

- Official source family: <https://www.bls.gov/schedule/>
- Coverage: Employment Situation releases within the coverage window.
- Required fields:
  - release date and time in Eastern Time;
  - release title;
  - reference period;
  - source URL;
  - information-availability timestamp.
- Timing rule: use the release time published by BLS as the availability
  timestamp. The reference period identifies the employment data being reported
  and is not the publication timestamp.
- As with CPI, only information available at the stated release time may be
  used. Subsequent revisions must not be used to represent the original release
  information.

### BEA GDP release schedule

- Official source: <https://www.bea.gov/news/schedule/full>
- Coverage: GDP releases within the coverage window.
- Required fields:
  - release timestamp;
  - reference period;
  - source URL;
  - revision status.
- GDP estimates must be represented separately when applicable:
  - advance estimate;
  - second estimate;
  - third estimate.
- Timing rule: use the schedule's publication timestamp for availability. The
  reference period is not a publication timestamp. Each estimate is a distinct
  event because it changes what was publicly available at that point in time.
- Revision status must identify the estimate stage and must not collapse an
  advance estimate and later estimates into one historical observation.

## Timestamp and Information Rules

The following rules apply to every source:

1. Never use revised information before it was publicly available.
2. Never use an event's reference period as its publication timestamp.
3. Store timestamps internally in UTC while preserving the original Eastern
   Time timestamp for auditability. For FOMC records, preserve the source's
   original timezone when it differs from Eastern Time.
4. Preserve the source URL and provenance for every event record.
5. Do not use a synthetic or demo fallback when a source cannot be retrieved or
   verified.
6. Missing or uncertain timestamps must be explicitly flagged rather than
   guessed.
7. Scheduled event date and actual information-availability timestamp are
   separate fields.
8. Historical Context is descriptive research and must not automatically become
   a trading filter.

An event's availability timestamp is the earliest point at which the relevant
information could have been known from the cited official publication. Research
queries must not expose later revisions to a setup evaluated before those
revisions were available.

## Codespace Connectivity Finding

During the source audit, direct Python requests from the Codespace returned:

- HTTP 403 for BLS sources;
- HTTP 403 for the Federal Reserve source;
- HTTP 200 for BEA.

Therefore, implementation must not depend on unrestricted direct scraping from
these sites. The ingestion method must be reproducible and use cached or
committed source-derived event data with provenance, including the original
source URL and retrieval details. A connectivity failure must not silently
substitute another source or generate replacement data.

This document records source and ingestion requirements only. No cached event
dataset is created in Phase 1.

## Proposed Event Schema

The proposed event record contains:

| Field | Purpose |
| --- | --- |
| `eventId` | Stable identifier for the source event or estimate release. |
| `category` | Broad family, such as FOMC, CPI, Employment Situation, or GDP. |
| `eventType` | Specific event type, such as policy statement or GDP advance estimate. |
| `eventTimestampET` | Original information-availability timestamp preserved in Eastern Time when applicable. |
| `eventTimestampUTC` | Normalized UTC timestamp used internally for ordering and joins. |
| `referencePeriod` | Period represented by the release, separate from publication time. |
| `source` | Official publisher, such as Federal Reserve, BLS, or BEA. |
| `sourceUrl` | URL for the official calendar, statement, or release record. |
| `availabilityStatus` | Whether the availability timestamp is verified, missing, or uncertain. |
| `revisionStatus` | Revision stage or status, including GDP advance, second, or third estimate when applicable. |
| `notes` | Provenance details, scheduling classification, exclusions, or uncertainty explanation. |

The schema is proposed only. It does not authorize creation of event rows or
assume that an uncertain timestamp can be normalized.

## Audit and Ingestion Requirements

Any later ingestion should preserve, at minimum:

- the exact source URL used;
- the retrieval timestamp;
- the source-derived timestamp before UTC normalization;
- the normalized UTC timestamp;
- the source title and reference period;
- revision and scheduling classification;
- explicit missing or uncertain fields;
- exclusions and the reason for each exclusion.

The resulting source-derived data should be reviewable and reproducible from
the committed cache and its provenance. It must remain separate from scanner
logic and from any future trading-rule decision.