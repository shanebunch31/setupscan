# SetupScan Backup and Recovery Guide

This guide describes the storage paths verified from the current source code and the current backup artifacts. The local paper-trade journal backup is complete and verified. A PostgreSQL custom-format dump has been created and its archive listing has been verified locally. No PostgreSQL restore test has been performed, and archive inspection does not prove recoverability.

## Current backup status — 2026-10-18

| Item | Status | Verification |
| --- | --- | --- |
| Local paper-trade journal | **Complete and verified** | The source and backup are both 113,860 bytes, their SHA-256 checksums match the manifest and each other, and the source JSON parses. The manifest reports `complete` and `passed`. |
| PostgreSQL dump | **Created; archive verified; restore not tested** | `C:\Users\holle\SetupScanBackups\database-20261018T012222Z\setupscan-database.dump` is 138,629,943 bytes. Its SHA-256 is `21CA9C9B24897EBD3F7E0E0DFF95B64B3EA566FCF3A598D6CE8BA60618C3A9FF`, matching the supplied value. PostgreSQL 17.11 `pg_restore --list` succeeded, and its generated 625-line listing matched `archive-list.txt`. |
| Isolated PostgreSQL restore | **Not completed** | No local PostgreSQL service is running, and the default PostgreSQL 17 data directory is not initialized. The PostgreSQL 17 server and cluster-management binaries are installed, so a disposable local cluster is technically possible, but it would require creating a new data directory and running a local server process. No cluster or process was created or started. |

The dump's archive listing includes Supabase `auth`, `storage`, and `vault` schemas. Treat the dump and any restored copy as sensitive: they can contain authentication-related records, uploaded-file metadata, secrets-related data, and private application or research data. Store them only in access-restricted, preferably encrypted locations. Do not upload the dump to public file-sharing, paste archive contents into chat, or restore it into production. A local restore would copy this sensitive data onto this computer.

## Storage map

| Data | Storage and code path | What it contains and whether it can be recreated | Backup treatment |
| --- | --- | --- | --- |
| Dashboard paper journal | `server/data/paper-trades.json`, read/written by `server/paperStore.js` and used by `server/paperService.js` | Paper positions/trades and account state for the dashboard service. It is execution history and should be preserved; it cannot be reliably reconstructed from market data. | Included by the local backup utility when present. `.gitignore` excludes `server/data/`. |
| Paper observer state, paper trades, processed-candle checkpoints | PostgreSQL tables created by `server/postgresPaperStore.js`: `paper_observer_state`, `paper_trades`, `paper_processed_candles` | Observer recovery state, paper-trade records, and de-duplication checkpoints. With `DATABASE_URL`, these PostgreSQL records are separate from the dashboard JSON journal. Without it, the observer falls back to the same `server/data/paper-trades.json` path, storing observer state alongside the journal. Do not assume the two paths contain equivalent history. | Back up through a full PostgreSQL export when configured; the JSON fallback is included in the local-file backup. |
| Research runs, experiment records, investigations and links, datasets, historical cache | PostgreSQL schema initialized by `server/researchRunStore.js`: `research_runs`, `research_run_experiments`, `research_investigations`, `research_investigation_runs`, `research_datasets`, and `research_historical_cache` | Saved evidence and reproducibility inputs/cache. Some experiments are costly to rerun, and exact historical provider responses may no longer be obtainable. Preserve them. | Back up through the PostgreSQL export; not included in the local-file backup. |
| Strategy definitions and code | Tracked project source files | Reproducible only from a separate code backup/version-control copy; a database dump does not back up source code. | Back up source independently. Do not put data backups in this repository. |
| Configuration | Environment variable names include `DATABASE_URL`, `DATABASE_SSL`, and paper-observer settings. The root `.env` is ignored by Git. The server loads it through `dotenv.config()` in `server/index.js`; deployment settings may be configured separately. | Configuration determines destinations and behavior. Secrets must not be included in data backups or this repository. | Preserve credentials separately using a password manager/provider secret store. Do not copy `.env` into the local data backup. |
| Browser state and provider data | No additional local persistent research file was found in the inspected storage paths. Research history is served by the server API; historical cache is stored in PostgreSQL. | Market data may be fetched again, but provider history can change or expire. Browser/session state is not included. | Not included. |

The current local `.env` has a non-empty `DATABASE_URL` setting, but its value was not displayed or used. Source code indicates the dashboard paper API always uses its JSON journal, while the observer and research API use PostgreSQL when the server process has `DATABASE_URL`. In the observer's no-database fallback mode, it uses the same JSON path as the dashboard. Do not merge histories from different configured destinations or assume they are equivalent.

## Local-file backup

The manual utility backs up only `server/data/paper-trades.json`, if it exists. It does not copy `.env`, PostgreSQL records, browser state, dependencies, build output, or temporary files. It copies the JSON bytes unchanged, checks that the JSON parses, compares SHA-256 checksums, and writes a metadata-only `manifest.json`.

By default, a new directory is created outside the repository under:

```text
%USERPROFILE%\SetupScanBackups\setupscan-<UTC timestamp>-<unique id>\
```

From the project root, run:

```powershell
node scripts/backup-local-data.js
```

To choose another destination (it must remain outside the repository):

```powershell
node scripts/backup-local-data.js --destination "E:\SetupScanBackups"
```

Each run creates a unique folder and refuses an in-repository destination. If no eligible local file exists, the command fails rather than reporting an empty backup as successful. Do not run the command while another process is actively changing the journal if a stable copy is required; the utility also compares file identity and content before and after the copy and fails if it detects a change.

### Verify the local backup

The command reports the manifest path and SHA-256 for each copied file. Check that the manifest says `status: "complete"`, each file has `validation.status: "passed"`, `checksumMatches: true`, and `jsonSyntax: "valid"` for the paper journal. The utility already compares the source checksum to the copied file. For an additional manual check, compare the source and backup hashes while the source is not changing:

```powershell
Get-FileHash -Algorithm SHA256 "server/data/paper-trades.json"
Get-FileHash -Algorithm SHA256 "<backup-directory>\files\server\data\paper-trades.json"
```

The hash values must match. Never edit the backup to make a check pass.

### Restore a local JSON file safely

Do not copy a backup directly over an existing journal. Stop the dashboard process that writes the JSON file, preserve the current journal under a new name outside the repository, and compare it with the selected backup first. Restore to a temporary file in `server/data`, verify its SHA-256 against the manifest, and validate JSON syntax. Only after the current journal has a separate verified copy and the target is confirmed should an operator replace the file. Keep the backup intact. This procedure is guidance only; no local restore has been performed.

## PostgreSQL dump and export procedure

The installed PostgreSQL client and server tools report version 17.11. The Supabase project version `17.6.1.166` was supplied by the user; this task did not connect to the project or independently verify its server version. The custom-format dump listed in the status table above exists and passed local checksum and archive-list checks. This task made no database connection and ran no SQL. The dump has **not** been restored, so this is not a restore-verified backup.

Official references:

- [PostgreSQL 17 `pg_dump`](https://www.postgresql.org/docs/17/app-pgdump.html)
- [PostgreSQL 17 `pg_restore`](https://www.postgresql.org/docs/17/app-pgrestore.html)
- [PostgreSQL 17 SSL support](https://www.postgresql.org/docs/17/libpq-ssl.html)
- [PostgreSQL 17 service connection files](https://www.postgresql.org/docs/17/libpq-pgservice.html)
- [PostgreSQL 17 `pg_dumpall`](https://www.postgresql.org/docs/17/app-pg-dumpall.html)
- [Supabase: Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [PostgreSQL Windows installers](https://www.postgresql.org/download/windows/)

Supabase's Free plan does not provide the managed backup capability needed here. The application's Node PostgreSQL setting (`DATABASE_SSL`) is not automatically used by `pg_dump`; the native client needs its own libpq connection settings. The application currently defaults to encrypted Node connections without verifying the server certificate (`rejectUnauthorized: false`). For this manual export, configure native libpq with certificate and hostname verification instead of copying that weaker application setting.

### For a future export

1. In the Supabase Dashboard, privately choose the connection method recommended for a native backup command. Supabase identifies `pg_dump` as a direct-connection use case. If the machine's network cannot reach the direct endpoint, follow Supabase's current guidance for an appropriate session connection; do not guess or substitute a transaction-pool connection. Do not paste any connection string into chat.
2. Obtain the host, port, database name, and user from the Dashboard's Connect panel. Put those non-password fields in the user's PostgreSQL service file at `%APPDATA%\postgresql\.pg_service.conf`, under a local section named `[setupscan_backup]`. Add `sslmode=verify-full` and `sslrootcert=<local path to the provider's verified CA certificate>`. Get the certificate from the provider's trusted dashboard/documentation and keep it outside the repository. Do not put a password or full connection string in this file or in Git. If certificate verification cannot be configured, stop and resolve that requirement before exporting.
3. The service file is a local configuration. Keep its host and username private. Enter the database password only at the `pg_dump --password` prompt; do not place it in command arguments, PowerShell variables, `$env:PGPASSWORD`, `.env`, shell history, a transcript, logs, or this guide. Do not start `Start-Transcript` or redirect command output to a log for the export.
4. Confirm free disk space and use a protected, preferably encrypted, local or removable destination outside the repository. The dump contains database records and is sensitive even though it contains no `DATABASE_URL` value. Restrict access to the destination directory.
5. The account must have read privileges for all objects being dumped. Supabase-managed roles or internal objects may be inaccessible; do not mask permission errors or warnings. If `pg_dump` reports any warning or error, treat the attempt as unverified and investigate it before relying on the file.

Before any future export, use the configured service for a **read-only identity preflight** and verify privately that it identifies the intended project/database and PostgreSQL major version 17. For example, after the user explicitly authorizes database access:

```powershell
psql --dbname="service=setupscan_backup" --no-psqlrc --set=ON_ERROR_STOP=1 --command="SELECT current_database(), current_schema(), current_setting('server_version'), current_setting('transaction_read_only');"
```

If the identity or version is unexpected, stop. Do not run `pg_dump` until the user confirms the destination. Do not share the output if it includes identifying connection information.

### Scope and known limits

Use a database-level dump with no `--schema`, `--table`, `--data-only`, `--schema-only`, or exclusion filters. That captures the accessible objects and data in the selected database, including application schemas and tables, rows, sequences and sequence values, constraints, indexes, functions, triggers, policies, and large objects. The known SetupScan tables initialized in source are:

- Research: `research_runs`, `research_run_experiments`, `research_investigations`, `research_investigation_runs`, `research_datasets`, and `research_historical_cache` (`server/researchRunStore.js`).
- Paper observer: `paper_observer_state`, `paper_trades`, and `paper_processed_candles` (`server/postgresPaperStore.js`).

Do not use `pg_dumpall` for this procedure. `pg_dump` covers one database; it does not include cluster-wide roles, tablespaces, or server configuration. A full `pg_dumpall` generally requires elevated privileges and includes global role material that is outside this single-database backup scope and may be unavailable on managed hosting. Extension definitions can be recorded, but extension binaries and provider-managed services are not contained in the archive; the isolated target must support required extensions. Database users, credentials, environment variables, source code, and broker configuration are not part of this dump.

### Future PowerShell export template — NOT TESTED AGAINST THIS DATABASE

Run only after the service entry and certificate have been configured locally and a real export is separately authorized. The following template intentionally contains no host, username, password, or connection string. It creates a unique run directory and reserves the dump filename with create-new semantics so an existing export is never overwritten. If any step fails, keep the folder for diagnosis, label it failed, and do not treat its dump file as valid.

```powershell
$pgDump = 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe'
$pgRestore = 'C:\Program Files\PostgreSQL\17\bin\pg_restore.exe'
$service = 'setupscan_backup'
$startedAtUtc = [DateTime]::UtcNow
$repoRoot = [System.IO.Path]::GetFullPath((git rev-parse --show-toplevel).Trim())
$backupRoot = [System.IO.Path]::GetFullPath((Join-Path $HOME 'SetupScanBackups\postgres'))
$repoPrefix = $repoRoot.TrimEnd('\') + '\'
if ($backupRoot.Equals($repoRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    $backupRoot.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Choose a PostgreSQL export destination outside the repository.'
}
if (-not (Test-Path -LiteralPath $pgDump -PathType Leaf) -or
    -not (Test-Path -LiteralPath $pgRestore -PathType Leaf)) {
  throw 'PostgreSQL 17 pg_dump and pg_restore executables are required.'
}
$clientVersion = (& $pgDump --version).Trim()
if ($LASTEXITCODE -ne 0 -or $clientVersion -notmatch '^pg_dump \(PostgreSQL\) 17\.') {
  throw 'The expected PostgreSQL 17 pg_dump client was not verified.'
}
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$stamp = $startedAtUtc.ToString('yyyyMMddTHHmmssfffZ', [Globalization.CultureInfo]::InvariantCulture)
$runDirectory = Join-Path $backupRoot ("setupscan-pg17-{0}-{1}" -f $stamp, [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $runDirectory) { throw 'The unique export directory already exists; choose a new run.' }
$null = New-Item -ItemType Directory -Path $runDirectory -ErrorAction Stop
$dumpPath = Join-Path $runDirectory 'setupscan-postgres17.dump'
$reservation = [System.IO.File]::Open($dumpPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
$reservation.Dispose()

# The password is entered interactively. Do not transcript, redirect, or log this command.
& $pgDump --dbname="service=$service" --format=custom --file="$dumpPath" --password
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed; this export is NOT VERIFIED.' }
if ((Get-Item -LiteralPath $dumpPath).Length -le 0) { throw 'The dump file is empty; this export is NOT VERIFIED.' }

& $pgRestore --list "$dumpPath" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'pg_restore could not read the archive; this export is NOT VERIFIED.' }
$dumpItem = Get-Item -LiteralPath $dumpPath
$sha256 = (Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifestPath = Join-Path $runDirectory 'manifest.json'
$manifestReservation = [System.IO.File]::Open($manifestPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
$manifestReservation.Dispose()
$manifest = [ordered]@{
  status = 'archive-validated-not-restore-tested'
  createdAtUtc = $startedAtUtc.ToString('o')
  exportFile = [System.IO.Path]::GetFileName($dumpPath)
  clientVersion = $clientVersion
  fileSizeBytes = $dumpItem.Length
  checksumAlgorithm = 'SHA-256'
  checksum = $sha256
  archiveListValidation = 'passed'
}
$encoding = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4) + "`n", $encoding)
Get-Item -LiteralPath $dumpPath | Select-Object Name, Length
Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256
Get-Content -LiteralPath $manifestPath -Raw
```

The manifest includes only the filename, UTC time, client version, size, checksum, and archive-list check. Review `pg_dump` warnings locally and record their disposition before treating the run as archive-validated. The final `Get-Content` prints only the manifest, never database rows or credentials. Do not share connection settings, command transcripts, or dump contents.

### What validation establishes

The dump command must exit successfully and produce a non-empty file. `pg_restore --list` must successfully read its table of contents. Record and independently recalculate the SHA-256 checksum; it must match the manifest later when the file is copied or restored. These checks establish archive readability and detect file changes. They do **not** prove that every required object was accessible, that restoration will succeed, or that a working database can be recovered. The current export has passed archive-level checks only; restore testing remains outstanding.

## Isolated PostgreSQL restore-test checklist

Do not restore into production. A real test requires the verified dump, a separate isolated PostgreSQL database, confirmation that it is not the production database, and explicit authorization to create the target and copy the sensitive data into it. No isolated target has been confirmed. The installed binaries can support a disposable local PostgreSQL 17 cluster, but setting one up requires creating cluster files and running a local server process. An alternative is a newly created, isolated provider database after its identity and access controls are confirmed. Neither option has been used for this backup.

1. Create a distinct empty restore-test database through the provider's approved interface. Record its identity privately and verify it is not the production destination before using it.
2. Inspect the dump with `pg_restore --list`. Confirm the file's SHA-256 is recorded and stable.
3. Restore without `--clean` or any command that drops existing objects. Use a service entry dedicated to the isolated target and stop if its identity is ambiguous. An example, only after those checks, is:

   ```powershell
   pg_restore --dbname="service=setupscan_restore_test" --exit-on-error "<verified-dump-file>"
   ```

4. Compare the source and restored database privately using the same read-only queries on each. First confirm the target identity carefully, then check tables and constraints:

   ```sql
   SELECT current_database(), current_schema(), current_setting('server_version'),
          current_setting('transaction_read_only'), current_setting('search_path');

   SELECT table_schema, table_name
   FROM information_schema.tables
   WHERE table_type = 'BASE TABLE'
     AND table_name IN (
       'research_runs', 'research_run_experiments', 'research_investigation_runs',
       'research_investigations', 'research_datasets', 'research_historical_cache',
       'paper_observer_state', 'paper_trades', 'paper_processed_candles'
     )
   ORDER BY table_schema, table_name;

   SELECT conrelid::regclass::text AS table_name, conname, contype,
          convalidated, confdeltype
   FROM pg_constraint
   WHERE conrelid::regclass::text IN (
     'research_runs', 'research_run_experiments', 'research_investigation_runs',
     'research_investigations', 'research_datasets', 'research_historical_cache',
     'paper_observer_state', 'paper_trades', 'paper_processed_candles'
   )
   ORDER BY table_name, conname;
   ```

   After confirming each table exists in the expected schema, compare row counts. This query will fail if any listed table is missing:

   ```sql
   SELECT 'research_runs' AS table_name, count(*) FROM research_runs
   UNION ALL SELECT 'research_run_experiments', count(*) FROM research_run_experiments
   UNION ALL SELECT 'research_investigation_runs', count(*) FROM research_investigation_runs
   UNION ALL SELECT 'research_investigations', count(*) FROM research_investigations
   UNION ALL SELECT 'research_datasets', count(*) FROM research_datasets
   UNION ALL SELECT 'research_historical_cache', count(*) FROM research_historical_cache
   UNION ALL SELECT 'paper_observer_state', count(*) FROM paper_observer_state
   UNION ALL SELECT 'paper_trades', count(*) FROM paper_trades
   UNION ALL SELECT 'paper_processed_candles', count(*) FROM paper_processed_candles;
   ```

   Compare run identities and experiment counts without retrieving experiment payloads:

   ```sql
   SELECT r.run_id, r.requested_at, r.status, r.dataset_id,
          count(e.experiment_id) AS experiment_rows
   FROM research_runs AS r
   LEFT JOIN research_run_experiments AS e USING (run_id)
   GROUP BY r.run_id, r.requested_at, r.status, r.dataset_id
   ORDER BY r.requested_at, r.run_id;

   SELECT d.dataset_id, count(r.run_id) AS referencing_runs
   FROM research_datasets AS d
   LEFT JOIN research_runs AS r USING (dataset_id)
   GROUP BY d.dataset_id
   ORDER BY d.dataset_id;

   SELECT r.run_id, r.dataset_id
   FROM research_runs AS r
   LEFT JOIN research_datasets AS d USING (dataset_id)
   WHERE r.dataset_id IS NOT NULL AND d.dataset_id IS NULL
   ORDER BY r.run_id;
   ```

   Compare paper storage using counts only. Do not select `trade`, `state`, or other payload columns:

   ```sql
   SELECT count(*) AS paper_observer_state_rows FROM paper_observer_state;
   SELECT count(*) AS paper_trade_rows FROM paper_trades;
   SELECT count(*) AS paper_processed_candle_rows FROM paper_processed_candles;
   ```

   The row counts, run identity listing, dataset references, table/constraint inventory, and paper counts should match unless a documented snapshot-time difference explains them. Do not retrieve or paste trade payloads, observer JSON, credentials, or connection strings.
5. Investigate every discrepancy before calling the restore successful. Keep the dump and comparison report; remove the isolated test database only through an explicitly approved later cleanup step.

No restore has been performed. A successful archive listing alone is not a successful recovery test. Until an isolated restore and comparison succeeds, label this PostgreSQL backup **archive-verified, not restore-tested**.

## Common failures and recovery

- **Missing paper journal:** if the file does not exist, the utility reports failure when no other eligible local file exists. Confirm the dashboard's configured working directory before deciding the journal is absent.
- **Invalid JSON or file changing during copy:** stop writers, preserve the original, and investigate. Do not repair or reserialize the original as part of backup.
- **Destination inside the repository or inaccessible:** choose a writable folder outside the project and ensure adequate disk space. The utility will not write into the repository.
- **Checksum mismatch or partial backup:** treat it as failed. Keep the partial folder for diagnosis, do not restore from it, and make a new backup after resolving the cause.
- **`pg_dump` absent or permission denied:** do not install or change production configuration as part of a backup attempt. Use an approved trusted PostgreSQL client and provider-granted read access, then repeat the export and archive checks.
- **Restore mismatch:** stop before using restored data. Verify target identity, archive completeness, version compatibility, extensions, ownership, and permissions. Never try a repair command against production.

## Keeping backups and credentials safe

Backups default outside Git and `.gitignore` already excludes `.env` and `server/data/`. Keep custom backup destinations outside the repository too. Do not add backups, dumps, service passwords, or `.env` files to Git. The utility rejects credential-like paths and repository build/dependency/cache paths. Store database credentials in a trusted secret manager or local PostgreSQL credential mechanism with restrictive access, not in commands or logs.

## Coverage, retention, and proposed targets

The local utility covers only the dashboard JSON journal. The PostgreSQL dump is intended to include accessible database schemas and records, including research history, research cache/datasets, and database-backed observer/paper records. Source code, deployment configuration, provider-side source candle history, browser state, and credentials are not included. Supabase-managed services and external storage objects may not be recoverable from a PostgreSQL dump alone. Market data may not be exactly reproducible if the provider changes historical bars. Older research records may lack newer metrics and methodology fields; a backup preserves them as recorded and does not invent missing values.

Proposed operational targets, not measured guarantees:

- **RPO:** no more than one day of lost research/paper history, by making a verified backup at least daily and before methodology resets.
- **RTO:** restore critical history within one business day after an isolated restore procedure has been tested.

These targets require scheduled/manual PostgreSQL export procedures, protected off-device storage, retention policy, and a successful isolated restore drill before they can be treated as achievable.
