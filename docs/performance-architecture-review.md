# Performance and architecture review

Review date: 2026-11-06, America/Sao_Paulo. Measurements use UTC timestamps where emitted by tools. The reviewed state includes the existing uncommitted changes in this checkout.

The initial five fixes and all ten follow-up findings F06–F15 are implemented. The follow-up adds backup admission and read limits, byte-bounded log ingestion, owned fleet concurrency, bounded history pagination, SQL aggregation and indexes, build-time gzip, and parallel independent project reads. Measurements and operating limits are recorded below; whole-file backup encryption still has a substantial single-file memory cost.

## Review method and coverage

Two passes covered the application execution paths. The first followed requests and data from entry points to storage and rendering. The second restarted from resource ownership, concurrency, query plans, cache consistency, and failure paths; it also challenged the fixes and repeated browser measurements. These are two analytical passes by the same reviewer, not two reviewers or independent production experiments.

The initial source inventory contained 894 TypeScript and TSX files, including generated code and tests. Coverage below describes the reviewed flows; generated routing code, fixtures, and every individual presentational component were not subjected to a separate manual line-by-line audit.

| Area                                                                                                    | First pass                                                   | Second pass                                                           |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| HTTP, auth, server functions, MCP, webhooks                                                             | Authorization, validation, request flow, payload boundaries  | Revocation, credential isolation, cache ownership, repeat calls       |
| Projects, deploys, environments, domains, settings, servers, databases, volumes, tasks, previews, audit | Service boundaries, transactions, list queries, external I/O | History growth, indexes, query plans, allocation and fan-out          |
| Queue, worker, deployment execution, Docker, processes, SSH, probes, routing                            | Leases, cancellation, command supervision, monitoring        | Partial failure, late completion, disposal, overlap, retained buffers |
| SQLite, retention, backups, encryption                                                                  | WAL configuration, retention, transfer paths                 | Blocking cost, copies in memory, byte limits, restore limits          |
| Browser shell, routes, forms, logs, charts, navigation                                                  | Query keys, polling, skeletons, render cost, transitions     | Throttled production navigation, repeated log benchmark, mobile menu  |

No dependencies were added. Existing unrelated modifications were preserved. Referenced `.Codex/rules/*.md` files were unavailable in this checkout; the supplied instructions and root `AGENTS.md` were used.

## Initial review measurements

### Retention

Bun 1.4.4 on Windows; migrated in-memory SQLite; one project; interleaved-project correctness covered separately by a regression test. Each measurement starts with a fresh database and keeps 5,000 rows. Three repetitions per size, median elapsed milliseconds:

| Runtime rows before pruning | Original query | Ranking query | Approximate speedup |
| --------------------------- | -------------: | ------------: | ------------------: |
| 10,000                      |       1,608.90 |          8.06 |                200x |
| 20,000                      |       3,219.65 |         19.10 |                169x |
| 50,000                      |       8,235.93 |         61.75 |                133x |

This compares the actual original `DELETE ... RETURNING id` query with the replacement ranking deletion. The production function additionally executes two constant-size `SELECT changes()` statements and deployment-log retention. These numbers are not a benchmark of disk-backed production transactions or a claim that a large delete can never block.

### Log rendering

A browser fixture uses the real `LogViewer`, production React, Chromium, and 4x CPU throttling. It loads 5,000 lines and sends ten additional lines individually. Three alternating baseline/optimized runs supply thirty update observations per variant. The baseline uses the original `log-lines.tsx` from HEAD; that file had no pre-existing local edits.

| Measurement                                                   | Original rows | Memoized rows |
| ------------------------------------------------------------- | ------------: | ------------: |
| Median incremental update until the new DOM row is observable |     124.73 ms |      82.56 ms |
| Long tasks over the three runs, including initial mount       |  12 / 12 / 13 |     5 / 3 / 3 |
| Median initial load of the fixture                            |     950.39 ms |     962.72 ms |
| DOM elements after loading                                    |        15,042 |        15,042 |

Incremental updates improved by about 34%; initial mount did not improve. The fixture uses simple layout CSS rather than the complete application stylesheet. DOM-observation latency includes browser automation overhead and is not INP. Memoization reduces repeated row work but does not virtualize the list or eliminate reconciliation and filtering.

### Production navigation

The production build was served against a throwaway seeded database. Chromium used a 1440x900 viewport, 4x CPU throttling, 100 ms network latency, 200,000 bytes/s download, and 100,000 bytes/s upload. External HTTPS requests were blocked. These are laboratory observations, not field percentiles.

| Observation                                         | Before fixes | After fixes |
| --------------------------------------------------- | -----------: | ----------: |
| Initial dashboard LCP sampled before SPA navigation |     6,064 ms |    6,084 ms |
| Initial dashboard CLS at that sample                |     0.000117 |    0.000117 |
| Initial long tasks                                  |  87 / 222 ms | 89 / 203 ms |
| Projects navigation until network idle              |       839 ms |      846 ms |
| Enter project until network idle                    |       807 ms |      811 ms |
| Environment navigation until network idle           |       848 ms |      876 ms |
| Metrics navigation until network idle               |     2,363 ms |    2,373 ms |
| Return to projects until network idle               |       417 ms |      483 ms |
| Unhandled page errors                               |            0 |           0 |

The initial five fixes did not establish a navigation speedup. `networkidle` includes a quiet interval and may miss subsequent React work, so these times are not exact click-to-usable measurements. LCP observed after later SPA activity was about 7.5 s; it must not replace the initial-dashboard sample. Event Timing recorded individual interactions up to 88 ms in the optimized run, but the short scripted interaction set does not establish field INP. Follow-up cold-loading results appear below.

A final 375x812 viewport check opened the mobile menu and closed it through its close button without page errors. Opening through the end of its declared animation took about 577 ms. Across 32 sampled frame intervals, p95 was 16.8 ms and the maximum gap was 66.6 ms. This short headless-browser sample shows an isolated delayed frame; it does not establish sustained FPS or low-end-phone performance. A tooltip can consume the first Escape key before the containing menu, so the close-button flow was used for the closure check.

## Findings and fixes

### F01 Critical — Retention repeats a large lookup for every log row — fixed

- **Location:** `src/logs/log.service.ts`, `pruneLogs`, runtime deletion and both deletion counts.
- **Problem and cause:** The correlated subquery enumerated the newest K rows for the current project for each candidate row. At fixed K=5,000, work repeatedly traversed the same retained rows. `RETURNING id` also materialized an object per deleted row solely to count them.
- **Impact:** Measured multi-second synchronous SQLite work blocks the worker event loop and holds the write transaction. Larger backlogs can delay heartbeats, lease renewal and other writers sufficiently to threaten stability. That larger operational failure was not reproduced against production.
- **Solution applied:** Rank runtime rows once with `ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY id DESC)`, delete rows beyond the limit, and read SQLite change counts instead of materializing deleted IDs.
- **Validation:** The benchmark above; a regression test checks interleaved IDs across three projects, fewer-than-limit histories, deployment-log counts, and a second no-op pruning run. Disk-backed chunked retention remains a possible next step if measured write-lock durations require it.

### F02 High — Slow SSE consumers accumulate queued batches — fixed

- **Location:** `src/web/server/event-stream.ts`, `createEventStreamResponse`, polling and heartbeat scheduling.
- **Problem and cause:** Timers polled and enqueued data without checking the readable stream's demand. A reader that stopped consuming could retain successive batches indefinitely.
- **Impact:** Memory and repeated authorized database reads grew with connection duration and log rate. Transport and proxy buffering can add further memory outside this stream.
- **Solution applied:** Use byte-based stream sizing with a 65,536-byte high-water mark; pause reads while demand is exhausted and suppress queued heartbeats. Recheck closure after asynchronous reads before scheduling another timer.
- **Validation:** A reader left paused over multiple poll intervals causes one batch read, then resumes from the correct cursor. Additional tests cover cancellation during an in-flight read, authorization revocation, reconnection cursors and final cleanup lines.
- **Limit:** The high-water mark is a threshold, not a hard 64 KiB cap: a whole batch can overshoot it. Current route batch limits still bound that overshoot. Per-user connection limits and proxy behavior were not load-tested.

### F03 High — Container observation races with refresh and disposal — fixed

- **Location:** `src/worker/servers/container-observer.ts`, `refresh`, `sampleMetrics`, `#follow`, event scheduling and disposal.
- **Problem and cause:** Job completion, Docker events and periodic refresh could list the same server concurrently. An operation suspended in Docker I/O or secret loading could resume after disposal, recreating followers or writing observations after ownership ended.
- **Impact:** Redundant Docker calls, stale snapshots and resources that outlive their observer.
- **Solution applied:** Share an in-flight refresh and coalesce additional requests into a trailing read. The trailing read is necessary because a caller may have changed containers after the first read began. Guard asynchronous continuation points, ignore late log callbacks, stop events after disposal, and clear the running-container references.
- **Validation:** Tests dispose during a deferred list, coalesce three overlapping calls into an initial and trailing read, and recover after a rejected shared read. Existing tests confirm rotated secrets remain redacted with and without deployment snapshots.

### F04 High — A TCP connection can outlive a timed-out probe — fixed

- **Location:** `src/worker/probes.ts`, `networkProbes.tcp`.
- **Problem and cause:** `Promise.race` returned on timeout but did not cancel or consume a subsequently successful socket. Successful probes also left the sleep timer pending until its deadline.
- **Impact:** Slow connection establishment could leave an open connection without an owner; repeated probes could accumulate such sockets.
- **Solution applied:** Close sockets delivered after the deadline and dispose the timeout timer when the probe settles.
- **Validation:** A local TCP server and a deferred connection result reproduce late completion after the three-second deadline; the peer observes closure. A successful local probe also passes. No public network was used.

### F05 High — Appending logs renders unchanged rows again — improved

- **Location:** `src/web/components/monitoring/log-lines.tsx`, `LogLineRow` and `LogOutput`; related work in `use-log-filters.ts` and `log-stream.ts`.
- **Problem and cause:** Every update rebuilt the visible row tree and invoked every row component, including repeated timestamp formatting. Existing line objects retain their identities, but the row component did not use them to bail out.
- **Impact:** At 5,000 visible lines, incremental updates caused repeated long tasks and competed with typing, scroll and navigation.
- **Solution applied:** Memoize the row component using its existing immutable line object and highlighted flag. Changes to highlighting still update affected rows.
- **Validation:** Alternating production-React benchmark above and all log-stream browser tests pass. Initial render, 15,042 DOM elements, O(N) filtering/reconciliation, and per-event array copying remain. Virtualization or ingestion batching would require a separate behavioral change covering wrapped lines, search, jump-to-error, export, ordering and accessible output.

## Original follow-up findings — implemented

This section preserves the original diagnoses and validation proposals as historical context. All ten findings below were subsequently addressed; the implementation, measurements and remaining limits are in the follow-up results section. Original statements about unmeasured behavior describe the initial review, rather than the completed follow-up.

### F06 High — Backup operations have large overlapping buffers

- **Location:** `src/worker/databases/database-backup-runner.ts`, `storeDump` and `restoreDump`; `src/secrets/secret-box.ts`, `encryptBytes` and `decryptBytes`; `src/backups/offsite-backup.ts`, object reads and `downloadBackup`.
- **Problem and cause:** A permitted 512 MiB dump is read whole, encrypted whole, then copied into a framed output. Remote file reads also concatenate buffers and copy the result. Restore paths read whole stored objects before decryption and do not apply the dump upload limit to the incoming object.
- **Impact:** Several large buffers can coexist per job; concurrency is configured up to eight jobs, with additional periodic panel backups. Multi-gigabyte working sets and OOM are plausible, not measured here. The exact live-copy peak depends on GC and crypto implementation. This is allocation pressure, not proof of a retained-reference leak.
- **Solution:** Enforce an encrypted-object read limit before/during transfer, including framing overhead; impose a backup-specific concurrency or byte budget. If larger dumps are needed, design versioned authenticated chunk encryption with complete authentication before restore activation. Do not replace AES-GCM with an unauthenticated streaming format.
- **Validation:** Measure RSS and external/ArrayBuffer memory for near-limit uploads and restores with simultaneous jobs; reject oversized objects before full allocation; preserve existing tamper, wrong-key, cancellation and restore-activation tests.

### F07 High — Runtime log buffering limits line count rather than bytes

- **Location:** `src/worker/servers/container-observer.ts`, `MAX_PENDING_LINES`, `#collectLine`, `#flush`; `src/worker/maintenance/scheduled-duties.ts`, hourly retention.
- **Problem and cause:** Up to 5,000 redacted strings are buffered per observer; truncation to storage length happens later in `appendRuntimeLogs`. Process lines can reach 65,536 characters, and redaction may expand them. Additional lines are dropped without a dropped-line counter. Hourly retention permits a large on-disk burst between pruning runs.
- **Impact:** Hundreds of megabytes of pending text are possible on a noisy host despite the count limit, alongside unreported log loss and substantial SQLite growth. These upper-bound scenarios were derived from the code, not an OOM experiment.
- **Solution:** Apply redaction before storage truncation, enforce a byte budget in addition to a line budget, and expose dropped-line counters. Consider bounded incremental retention or ingestion quotas rather than assuming an hourly count policy bounds instantaneous storage.
- **Validation:** Feed maximum-size lines from several containers; assert a bounded buffered byte count, visible drop accounting, secret redaction and acceptable disk growth. Measure worker lease renewal latency while flushing and pruning.

### F08 High — Fleet fan-out can escape the periodic overlap guard

- **Location:** `src/worker/servers/server-fleet.ts`, `collectMetrics` and `refreshContainers`; `src/worker/worker.ts`, `guardDuty`.
- **Problem and cause:** Fleet work uses `Promise.all`. One server can reject while work for another server continues. The aggregate rejects immediately, so `guardDuty` clears its running flag before all child operations settle. The next interval may launch another set of work on those still-pending servers. Fleet size also controls fan-out without a global cap.
- **Impact:** A failing server plus slow peers can cause repeated remote commands, concurrent samples and SSH-channel pressure. This is a proven control-flow property; the resulting production overlap has not been profiled.
- **Solution:** Keep the duty owned until all launched children settle, then report collected failures; or track in-flight work per server. Add a bounded fleet-wide concurrency limit if measurements justify it. Preserve parallel progress of healthy hosts.
- **Validation:** Use a fast-rejecting host and a deferred host across two timer ticks; assert no repeated work for the deferred host and that errors remain logged. Test cancellation and partial failures with a large fleet.

### F09 High — Infinite history polling scales with all loaded pages

- **Location:** `src/web/components/deployment-history/use-deployment-history.ts`, `useInfiniteQuery` and `refetchInterval`; `deployment-history.ts`, 5 s active / 15 s idle polling.
- **Problem and cause:** Loaded pages are neither capped nor separated from the live head. An infinite-query refetch can refresh the accumulated page chain; the interval decision flattens all pages, and the rendered list grows with every explicit load-more action.
- **Impact:** Request counts, retained data and DOM work increase with the browsing session. This is user-driven accumulation, not an autonomous infinite memory leak. Separate observers sharing query keys correctly deduplicate concurrent requests; that does not remove multi-page refetch work.
- **Solution:** Refresh a bounded live window and keep historical pages immutable where appropriate, or use a bounded page window with deliberate cursor and scroll semantics. A simple `maxPages` change alone can discard visible history or break return navigation.
- **Validation:** Load 1, 10 and 100 pages, count requests per polling interval, and measure DOM/heap growth. Verify stable ordering and no duplicates or omissions across status changes, new deployments, cancellation and rollback.

### F10 Medium — Deployment statistics materialize every deployment in the window

- **Location:** `src/deployments/deployment-stats.service.ts`, `listWindowDeployments`, `countByDay`, duration calculation.
- **Problem and cause:** Rows are loaded into JavaScript and traversed several times. Day keys use timezone formatting per row in both filtering and grouping. A bounded date window does not bound the number of deployments.
- **Impact and evidence:** Three-run medians were about 2.40 ms at 1,000 rows, 19.89 ms at 10,000 and 89.66 ms at 50,000, with all rows from the same day. That is synchronous request work and O(N) allocations; concurrent polling multiplies it.
- **Solution:** Aggregate counts and duration totals in SQL or maintain carefully invalidated daily aggregates. Preserve São Paulo calendar-day boundaries, production-only filtering, and duration handling. Avoid a global response cache without scoping and invalidation rules.
- **Validation:** Compare output with existing tests at local midnight, missing dates and invalid durations; benchmark 50k+ rows with concurrent readers and measure event-loop delay.

### F11 Medium — Preview summaries read complete deployment histories

- **Location:** `src/previews/preview-summary.ts`, `summarizePreviews`, ordered `.all()` and the JavaScript latest-per-preview map.
- **Problem and cause:** Every deployment of each active preview is read and sorted, even though the result needs only one deployment per preview. A limit on active previews does not bound deployments per preview.
- **Impact:** Query, sorting and allocation costs grow with history while the returned summary stays small. Static query-shape finding; no production timing claim.
- **Solution:** Select the newest deployment ID per preview in SQLite, preserving the `created_at, id` tie-break. Evaluate an appropriate composite index using the actual query plan rather than adding indexes indiscriminately.
- **Validation:** Generate many deployments per preview, compare summaries including timestamp ties and mixed production data, and confirm result-size work follows the number of previews.

### F12 Medium — Runtime resume lookup scans logs without a deployment index

- **Location:** `src/logs/log.service.ts`, `getLatestRuntimeLogTime`; `src/db/tables/projects.tables.ts`, `runtimeLogs` indexes.
- **Problem and cause:** Lookup filters by `deployment_id` and orders by descending `id`; indexes cover project/id and creation time, not deployment/id. New deployments with no stored logs take the worst path.
- **Impact and evidence:** `EXPLAIN QUERY PLAN` reports `SCAN runtime_logs`. A missing-deployment lookup over 100,000 short rows took about 3.01 ms in memory. Larger retained sets and reconnecting many containers multiply the work.
- **Solution:** Evaluate `(deployment_id, id)` or provide the known project ID to exploit a suitable project-scoped index. Measure the write and disk cost of any new index and ship it through a reviewed migration.
- **Validation:** Compare query plans and missing/existing-deployment lookup latency on multi-project data, together with log-ingestion throughput and migration time.

### F13 Medium — Cold loading transfers a substantial uncompressed startup bundle

- **Location:** `src/web/serve.ts`, `serveStaticFile`; production client assets; shell imports and route chunks.
- **Problem and cause:** The direct production server returns static files without content-encoding negotiation. The observed root JS transferred 476,748 bytes including response overhead and took about 4,809 ms under the test network. The build reports roughly 145 kB gzip for that JS asset; other startup JS and CSS compete for bandwidth.
- **Impact:** Initial dashboard LCP was about 6.1 s under throttling, with long tasks during startup. This does not establish the behavior of a deployed proxy, which might already compress responses.
- **Solution:** Verify production proxy compression first. Otherwise use build-time compressed static variants with correct content negotiation, MIME type, `Vary` and immutable asset caching. Profile shell dependencies before further splitting; preserve existing route splitting. Do not synchronously compress every request.
- **Validation:** Test an actual deployment with and without `Accept-Encoding`, inspect transfer bytes and cache headers, and repeat cold navigation. Use browser traces to separate transfer, parse, hydration and font costs.

### F14 Medium — Project entry serializes parent and child data loading

- **Location:** `src/web/routes/_app.tsx`, `beforeLoad`; `src/web/routes/_app/projects/$projectId.tsx`, `ProjectLayout`; child hooks such as `useRecentDeployments`.
- **Problem and cause:** Session lookup precedes rendering; the project layout then withholds its `Outlet` until project details arrive. Queries in child components cannot start until that parent data resolves. Some sequencing is required for authorization and project-dependent values, but independent child reads still inherit the render dependency.
- **Impact and evidence:** The initial project entry issued a session request plus project/child reads; metrics first entry was the slowest scripted navigation at roughly 2.36 s until network idle. The measurement alone does not apportion that time between the waterfall, chunks and chart work.
- **Solution:** Profile the dependency graph and prefetch genuinely independent child data through the existing router/query client after authorization. Reuse query keys and preserve server-side permission checks. Do not introduce a long-lived session cache that delays revocation.
- **Validation:** Compare request-start waterfalls and click-to-usable traces under latency. Test route cancellation, rapid project changes, permission revocation and error/skeleton behavior. Current laboratory navigation does not show a speedup from this review's fixes.

### F15 Medium — Fleet disposal does not own all pending continuations

- **Location:** `src/worker/servers/server-fleet.ts`, `#checkOne`, `collectMetrics`, `#observerFor`, `[Symbol.dispose]`; `src/worker/worker.ts`, `#drain`.
- **Problem and cause:** Observer-level disposal is now guarded, but fleet-level checks and samples can still be pending when the fleet is disposed or a server is removed. For example, collection can resume after awaiting a host sample and call `#observerFor`, creating a new observer after the map was cleared.
- **Impact:** Timers or stale server state can briefly reappear at the fleet level. Process exit reduces the shutdown lifetime, but server removal and readiness changes also need ownership checks. This is a remaining lifecycle risk, not proof of a persistent production leak.
- **Solution:** Give fleet work a closed/generation guard or owned cancellation signal; await or settle active operations before final disposal, and recheck server membership after I/O. Keep this distinct from the fixed observer lifecycle.
- **Validation:** Pause host sampling and checks, remove/dispose the fleet, then resolve them; assert no observer or timer is recreated and no removed server is marked ready.

## Cache and transition decisions

- Shared React Query keys already reuse project and metric responses across multiple components. Multiple hooks alone are not proof of duplicate network requests. No blanket cache or extra memoization layer was added.
- The router creates a separate query client per server request or browser tab. GitHub authentication caches are bounded and credential-scoped, while pending installation requests are removed after settlement. These were not classified as unlimited caches.
- SSE authorization remains server-side. Public static assets use immutable caching for hashed filenames; private function responses were not moved into public caches.
- Charts already disable series animation and cap returned series at 2,000 points. The shared clock stops when its last subscriber leaves. These existing controls were preserved.
- Menu, dialog and sheet transitions use opacity/translation effects, but overlays also blur the backdrop. The mobile sheet declares a 500 ms opening animation. Neither that duration nor blur is by itself evidence of a bottleneck; mobile frame observations must be interpreted with the rendering device and browser mode.
- No speculative prefetch of secret environment data, credentials, destructive operations or arbitrary repository content was introduced.

## Follow-up implementation and results

### F06 High — Bound backup admission and incoming objects

- **Changed:** `src/backups/backup-memory.ts`, `backup-read.ts`, `offsite-backup.ts`, `local-object-store.ts`, `restore.ts`; `src/worker/databases/database-backup-runner.ts`, `database-backup-storage.ts`; `src/worker/servers/local-host.ts`; `src/remote/remote-files.ts`.
- **Applied:** One memory-heavy backup/restore phase is admitted per process, including periodic panel uploads. Cancelled waiters reject promptly without allowing later waiters to overtake an active owner. Plaintext remains capped at 512 MiB; encrypted objects are capped at that size plus the existing 32-byte NLC1 framing overhead. Production S3 reads reject oversized HEAD metadata before GET and enforce actual streamed bytes if metadata changes. Local reads check the opened file's size and returned bytes; locally owned snapshots are published through temporary files and atomic rename. Remote reads no longer copy an already concatenated Buffer into another Uint8Array.
- **Correctness:** Existing Web Crypto AES-GCM APIs and the NLC1 format remain intact. Independent Web Crypto compatibility tests cover empty and multi-chunk-size payloads; IV, ciphertext and tag tampering are rejected. Existing wrong-key/context, cancellation and restore-activation protections pass. Tests cover admission cancellation, exact/oversized/stale read sizes, atomic publication, and the real Bun S3 client against a local fake S3 endpoint. Windows replacement refusal while a descriptor is held preserves the old object and succeeds after it closes.
- **Limit:** This is a bounded whole-file policy, not streaming encryption or a constant-RSS guarantee. The admission limit is process-local, and filesystem snapshots must remain owned and immutable. One accepted 512 MiB file still needs about 2.07 GiB RSS in this environment. Deployments must provision for that cost or choose a smaller accepted file limit; a future chunked format would need separate authenticated-format design.

Fresh Bun 1.4.4 processes on Windows read the same sparse files, use the unchanged crypto implementation, and write to a simulated store that waits 25 ms without retaining the uploaded buffer. RSS is sampled every 5 ms and at the store write. Eight simultaneous 32 MiB uploads use three repetitions per variant; the table gives medians. The original reference executes the original file-read/encrypt/upload core, while the updated path calls the actual bounded upload function.

| Measurement                                 |   Original |    Updated |
| ------------------------------------------- | ---------: | ---------: |
| Peak process RSS, eight 32 MiB uploads      | 871.02 MiB | 376.80 MiB |
| Peak RSS increase above initial process RSS | 800.67 MiB | 307.14 MiB |
| Upload workload elapsed time                |  108.76 ms |  333.01 ms |
| Simultaneous simulated writes               |          8 |          1 |
| Peak RSS, one 512 MiB upload, one run       |   2.07 GiB |   2.07 GiB |

The approximately 57% reduction in aggregate peak RSS trades throughput for bounded concurrency. It does not show a single-file memory improvement. GC, allocator behavior, a real bucket's transfer buffers and multiple processes can change the peak. Near-limit restore RSS and real-bucket throughput were not measured.

### F07 High — Bound log ingestion by bytes and retain during flush

- **Changed:** `src/worker/servers/container-observer.ts`, `src/logs/log.service.ts`, and the logs package exports.
- **Applied:** Pending log text uses a 4,194,304-byte accounting budget, modeling two bytes per UTF-16 code unit plus 128 bytes per record, alongside the existing 5,000-line cap. Redaction precedes storage truncation; rejected lines increment a counter reported on flush. `appendRuntimeLogs` inserts and prunes affected projects in one transaction using the configured per-project retained-line count, rather than waiting for hourly maintenance.
- **Validated:** A 1,000-line oversized-input regression checks the budget, exact drop accounting, maximum stored length and a secret crossing the truncation boundary. Service tests check retention immediately after ingestion and indexed query plans. The budget bounds accounted pending data, not all runtime/transport/SQLite allocations. Disk-backed sustained-ingestion latency was not profiled.

### F08 High — Own and cap fleet duties through partial failure

- **Changed:** `src/worker/servers/fleet-operations.ts` and `server-fleet.ts`.
- **Applied:** A shared queue admits four fleet duty operations, deduplicates operation/server keys, and allows healthy hosts to progress in parallel. Checks, scheduled metrics and container refresh duties share this queue. Aggregates wait for every launched child with `Promise.allSettled` before reporting an `AggregateError`, so one early rejection cannot release the periodic overlap guard while peers still run. Deleted-project cleanup collects failures after its owned sequential work.
- **Validated:** Queue tests assert the four-operation ceiling, deduplication and disposal behavior. A fleet regression combines a fast rejection with a deferred healthy peer and verifies that aggregate ownership stays pending and the peer is not launched again. Long-running event followers and job-owned commands have separate lifetimes; the four-operation cap is not a global limit on every SSH or Docker command.

### F09 High — Keep one history page active

- **Changed:** `src/web/components/deployment-history/use-deployment-history.ts` and `deployment-history-list.tsx`.
- **Applied:** A regular query holds one 25-row page; inactive pages use zero garbage-collection delay. Only the visible page polls. Previous/next controls replace accumulating rows, cursor history is capped at 100 entries, and a latest-page reset remains available after older cursors are discarded. Filters reset pagination and cannot display placeholder rows from a different filter. Existing query-key prefixes preserve mutation invalidation.
- **Validated:** A browser fixture runs the real hook and controls through 100 pages. It checks 25 rendered rows, one retained query entry, exactly one request during an active polling interval, previous/latest navigation and filter reset. This validates bounded retained pages and DOM rows; it is not a heap-allocation profile or an exhaustive concurrent-deployment mutation test.

### F10 Medium — Aggregate deployment statistics in SQLite

- **Changed:** `src/deployments/deployment-stats.service.ts`.
- **Applied:** SQLite returns at most 30 daily rows with counts and duration totals. JavaScript no longer materializes or timezone-formats every deployment. Calendar boundaries are computed for São Paulo, including historical midnight DST changes. Production-only filtering, empty days, invalid/negative duration exclusion, millisecond rounding and finite division results are preserved or explicitly validated.
- **Validated:** Existing statistics cases plus historical DST, invalid/negative durations, millisecond precision and exclusion of tomorrow's rows pass. Same-day, migrated in-memory SQLite benchmarks, three-run medians:

| Deployments | Original | SQL aggregation |
| ----------- | -------: | --------------: |
| 1,000       |  2.40 ms |         1.26 ms |
| 10,000      | 19.89 ms |        10.10 ms |
| 50,000      | 89.66 ms |        47.27 ms |

This reduces the 50,000-row sample's elapsed time by about 47% and bounds transferred rows. SQL still scans the matching deployments; this is not constant database work or a concurrent disk-backed load test.

### F11 Medium — Select one deployment per preview

- **Changed:** `src/previews/preview-summary.ts` and its regression tests.
- **Applied:** The query starts from previews and left-joins the deployment selected by a correlated latest-ID lookup ordered by `created_at DESC, id DESC`. It returns one row per preview, including previews with no deployments, instead of loading complete histories into JavaScript.
- **Validated:** A 1,000-deployment timestamp-tie fixture selects the correct final ID and keeps the empty preview's deployment null. The composite preview index in F12 supports the ordered lookup.

### F12 Medium — Add measured lookup indexes

- **Changed:** `src/db/tables/projects.tables.ts`, `drizzle/0015_performance-indexes.sql`, its snapshot and migration journal.
- **Applied:** Add `runtime_logs_deployment_id_idx (deployment_id, id)` and replace the preview-only index with `deployments_preview_created_idx (preview_id, created_at, id)`. The migration was generated with `bun run db:generate --name=performance-indexes` and exercised by migrated test databases.
- **Validated:** The missing-deployment runtime-log lookup over 100,000 rows changes from `SCAN runtime_logs` to `SEARCH ... USING INDEX runtime_logs_deployment_id_idx`; the sample falls from 3.0149 ms to 0.0214 ms. Tests assert the lookup and plan. Index maintenance adds write and disk overhead; production ingestion throughput and migration lock duration were not measured. The migration has not been applied to a production database.

### F13 Medium — Serve build-time compressed static assets

- **Changed:** `src/web/server/assets/{compressed-assets,content-encoding,static-response}.ts`, `src/web/serve.ts` and the build script in `package.json`.
- **Applied:** The build writes gzip variants for compressible text assets of at least 1,024 bytes when gzip is smaller. Request handling selects a prebuilt representation, preserves original MIME types and hashed immutable caching, and sends the appropriate `Content-Encoding`, `Content-Length` and `Vary: Accept-Encoding`. HEAD returns no body. No compression runs per request and no dependency was added.
- **Validated:** Tests cover gzip decompression/identity parity, strict quality negotiation including explicit gzip rejection over a wildcard, malformed headers, MIME/cache headers, HEAD, path traversal and invalid URI handling. Production browser measurements below confirm smaller transfer and faster laboratory cold loading through the direct Bun server. Proxy behavior still requires deployment-specific verification.

### F14 Medium — Start independent project reads together

- **Changed:** `src/web/routes/_app/projects/$projectId.tsx`.
- **Applied:** The project header can show its skeleton while the keyed child outlet mounts and starts independent reads. A project change resets the child subtree. Parent errors and server authorization checks remain authoritative; no long-lived session cache or speculative secret-data prefetch was introduced. Reads requiring a deployment ID still wait for that ID.
- **Validated:** The production trace originally started project details at 459.41 ms and received them at 589.07 ms; recent activity then started at 619.19 ms. After the change, project details and activity start together at 471.78/471.90 ms, before either response at about 601 ms. The confirmation run repeats this parallel start at 458.32/458.45 ms. This proves removal of that render-induced waterfall; it does not imply every navigation becomes faster.

### F15 Medium — Guard fleet continuations after ownership ends

- **Changed:** `src/worker/servers/server-fleet.ts`, `host-sampler.ts`, `container-observer.ts` and the owned duty queue.
- **Applied:** After I/O, continuations recheck disposal, current membership, connection identity and readiness where required. Identity includes creation time to distinguish a replaced server. Removal or changed connection identity disposes old observers/samplers. Disposal cancels queued duties, clears callbacks and ready state, and leaves active promises owned until they settle; stale results cannot record metrics, mark a removed server ready or recreate an observer.
- **Validated:** Deferred host samples and checks resolve after removal/disposal without recording samples or recreating observers/readiness. Existing observer disposal, coalescing, redaction and failure recovery tests still pass. These guards suppress stale effects; they do not forcibly cancel every underlying remote call.

### Follow-up production-browser comparison

The same production-server, throwaway-database and Chromium throttling method described above was repeated before and after the follow-up. Two updated cold runs provide a confirmation rather than a statistical distribution.

| Observation                               | Follow-up baseline |       Updated | Confirmation |
| ----------------------------------------- | -----------------: | ------------: | -----------: |
| Initial dashboard LCP                     |           6,092 ms |      2,936 ms |     2,884 ms |
| Initial dashboard CLS                     |           0.000117 |      0.000117 |     0.000117 |
| Initial long tasks                        |        86 / 229 ms |             — |  96 / 207 ms |
| Root JS transferred, including overhead   |      476,748 bytes | 145,638 bytes |            — |
| Projects navigation until network idle    |             831 ms |        832 ms |       828 ms |
| Enter project until network idle          |             811 ms |        810 ms |       804 ms |
| Environment navigation until network idle |             848 ms |        813 ms |       826 ms |
| Metrics navigation until network idle     |           2,356 ms |      1,388 ms |     1,447 ms |
| Return to projects until network idle     |             453 ms |        202 ms |       241 ms |
| Unhandled page errors                     |                  0 |             0 |            0 |

The root transfer is about 69% smaller and sampled cold LCP about 52% lower. Startup long tasks remain. The confirmation mobile menu opened and closed successfully; opening through animation end took 550 ms, with an isolated 100 ms frame interval. The 500 ms declared animation and the remaining delayed frame preclude a claim of immediate or uniformly smooth interaction. These samples do not establish field Web Vitals, sustained FPS or exact click-to-usable times. Session checks, server permissions and private-response cache policy were preserved.

## Validation and artifacts

Completed against the final code changes:

- `bun run check`: formatting, type-aware Oxlint, TypeScript, Knip, package-size check and **2,157 passing tests across 213 files**, zero failures, 3,486 assertions. The initial review finished at 2,112 tests; this follow-up adds 45. The original pre-review baseline was 2,104.
- `bun run test:browser`: **48 passing tests across six files**, zero failures, 144 assertions, including the 100-page history test and existing log-viewer, filtering, stream completion and navigation cases.
- `bun run build`: production client/server build and precompressed asset generation succeeded.
- Targeted bounded-read, real-S3-client/local-endpoint, admission cancellation, crypto compatibility/tampering, fleet lifecycle, log budget/retention, statistics DST and preview tie-break tests.
- Repeated query benchmarks, concurrent backup RSS profiling, a near-limit upload profile, production request waterfalls, throttled desktop navigation and mobile open/close checks. Initial TCP, SSE, retention and log-render results remain recorded above.

Oxlint reports non-blocking warnings, including existing complexity/file-size warnings and warnings in the enlarged review tests. No lint rules or tests were disabled. Knip did not report unused artifacts introduced by these changes.

Local artifacts are in the gitignored `ui-review-output/` directory. Final follow-up evidence is in `pending-check.log`, `pending-browser.log`, `pending-build-final.log`, `query-pending-{before,after}.json`, `backup-profile-final.log`, `backup-profile-{before,after}-limit-final.log`, `navigation-pending-{baseline,after,final}.json`, and `performance-{desktop,mobile}-pending-final.png`. Harnesses include `backup-memory-profile.ts`, `query-benchmark.ts` and `navigation-benchmark.ts`. Initial evidence remains in `check.log`, `browser-tests.log`, `build.log`, `retention-benchmark.json`, `log-render-{baseline,optimized}-{2,3,4}.json` and `navigation-{baseline,optimized,verification}.json`. These scratch files are available locally, rather than being a new committed benchmark suite. Intermediate backup experiments are not the reported final comparison.

Not validated: real Docker/Postgres/SSH integration runs, live S3 or Cloudflare/GitHub API load, sustained multi-user production load, near-limit restore RSS, actual low-end phones, deployment proxy compression, field INP/LCP/CLS, or production FPS. The local S3-client test and CPU/network emulation do not substitute for those measurements. Migration 0015 was generated and tested in disposable databases; no production migration or deployment was performed. No new dependencies were added.
