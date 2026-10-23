# Historical Market Context: FOMC Cache

## Scope and result

This cache contains Federal Reserve FOMC policy statements with release dates
from **2022-01-03 through 2026-09-23**, inclusive. It contains **38** regularly
scheduled events. The data is stored at
[data/historical-market-context/fomc/events.json](../data/historical-market-context/fomc/events.json).

The cache is source-derived and uses only official Federal Reserve pages. It is
descriptive research data only and is not a trading filter. No scanner logic or
UI consumes it.

## Sources used

The calendar source was retrieved at `2026-09-24T20:10:16Z`:

- [FOMC calendars](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm)

The linked individual statement pages used were:

- 2022: [Jan](https://www.federalreserve.gov/newsevents/pressreleases/monetary20220126a.htm), [Mar](https://www.federalreserve.gov/newsevents/pressreleases/monetary20220316a.htm), [May](https://www.federalreserve.gov/newsevents/pressreleases/monetary20220504a.htm), [Jun](https://www.federalreserve.gov/newsevents/pressreleases/monetary20220615a.htm), [Jul](https://www.federalreserve.gov/newsevents/pressreleases/monetary20220727a.htm), [Sep](https://www.federalreserve.gov/newsevents/pressreleases/monetary20220921a.htm), [Nov](https://www.federalreserve.gov/newsevents/pressreleases/monetary20221102a.htm), [Dec](https://www.federalreserve.gov/newsevents/pressreleases/monetary20221214a.htm)
- 2023: [Feb](https://www.federalreserve.gov/newsevents/pressreleases/monetary20230201a.htm), [Mar](https://www.federalreserve.gov/newsevents/pressreleases/monetary20230322a.htm), [May](https://www.federalreserve.gov/newsevents/pressreleases/monetary20230503a.htm), [Jun](https://www.federalreserve.gov/newsevents/pressreleases/monetary20230614a.htm), [Jul](https://www.federalreserve.gov/newsevents/pressreleases/monetary20230726a.htm), [Sep](https://www.federalreserve.gov/newsevents/pressreleases/monetary20230920a.htm), [Nov](https://www.federalreserve.gov/newsevents/pressreleases/monetary20231101a.htm), [Dec](https://www.federalreserve.gov/newsevents/pressreleases/monetary20231213a.htm)
- 2024: [Jan](https://www.federalreserve.gov/newsevents/pressreleases/monetary20240131a.htm), [Mar](https://www.federalreserve.gov/newsevents/pressreleases/monetary20240320a.htm), [May](https://www.federalreserve.gov/newsevents/pressreleases/monetary20240501a.htm), [Jun](https://www.federalreserve.gov/newsevents/pressreleases/monetary20240612a.htm), [Jul](https://www.federalreserve.gov/newsevents/pressreleases/monetary20240731a.htm), [Sep](https://www.federalreserve.gov/newsevents/pressreleases/monetary20240918a.htm), [Nov](https://www.federalreserve.gov/newsevents/pressreleases/monetary20241107a.htm), [Dec](https://www.federalreserve.gov/newsevents/pressreleases/monetary20241218a.htm)
- 2025: [Jan](https://www.federalreserve.gov/newsevents/pressreleases/monetary20250129a.htm), [Mar](https://www.federalreserve.gov/newsevents/pressreleases/monetary20250319a.htm), [May](https://www.federalreserve.gov/newsevents/pressreleases/monetary20250507a.htm), [Jun](https://www.federalreserve.gov/newsevents/pressreleases/monetary20250618a.htm), [Jul](https://www.federalreserve.gov/newsevents/pressreleases/monetary20250730a.htm), [Sep](https://www.federalreserve.gov/newsevents/pressreleases/monetary20250917a.htm), [Oct](https://www.federalreserve.gov/newsevents/pressreleases/monetary20251029a.htm), [Dec](https://www.federalreserve.gov/newsevents/pressreleases/monetary20251210a.htm)
- 2026: [Jan](https://www.federalreserve.gov/newsevents/pressreleases/monetary20260128a.htm), [Mar](https://www.federalreserve.gov/newsevents/pressreleases/monetary20260318a.htm), [Apr](https://www.federalreserve.gov/newsevents/pressreleases/monetary20260429a.htm), [Jun](https://www.federalreserve.gov/newsevents/pressreleases/monetary20260617a.htm), [Jul](https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm), [Sep](https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm)

Each included statement page was retrieved at `2026-09-24T20:10:16Z`, recorded
in `retrievedAt`, and verified to contain an explicit **“For release at 2:00
p.m. EST/EDT”** timestamp.

## Exclusion

The calendar also contains the official page
[monetary20250822a.htm](https://www.federalreserve.gov/newsevents/pressreleases/monetary20250822a.htm),
labeled **“August 22 (notation vote)”**. It was excluded because it is not a
regularly scheduled FOMC meeting policy statement. No uncertain or missing
timestamp record was silently included.

## Timestamp normalization

`eventTimestampET` preserves the statement page's original timezone abbreviation
(`EST` or `EDT`) alongside the local timestamp. `eventTimestampUTC` represents
the same instant in UTC, using the corresponding Eastern Time offset for that
date. The meeting date or reference period is never used as the information-
availability timestamp; only the statement page's explicit “For release at”
time is used.

`retrievedAt` is the UTC time when the source page was actually fetched. It is
provenance metadata and is not the statement publication time.

## Research-only status

This cache does not assert a causal market effect and does not authorize a
trading rule. It is a descriptive historical-context input for later research;
any future use must preserve source provenance and information availability.