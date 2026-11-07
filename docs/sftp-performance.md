# FTP/SFTP transfer performance

The comparison uses ng-jk/vscode-sftp commit `ef4d3ca3e6fd2c0c24e05079d3dcf6093d633ce8`, the upstream revision recorded in `vendor/sftp/provenance.json`. The before/after wire benchmark compares this toolkit 0.7.13 (`b6edb011b2896f70e2f00a3ad3a3ac43fdeccfc0`) with 0.7.14; it does not claim a measured speedup over the upstream extension.

| Area | Upstream implementation | Toolkit requirements and optimization |
| --- | --- | --- |
| FTP payload | `put` directly calls STOR | Keep private staging and verified permissions; remove cleanup requests only after confirmed successful moves. |
| Transfer preparation | Some source/open work runs concurrently; directory setup uses ensureDir | Keep safe ancestry and mode checks. Share FTP listings only during a file's read-only preflight, ending the snapshot before staged-file mutation. |
| Ancestor metadata | No equivalent root/owner isolation policy | 0.7.17 removes automatic owner/mode audits from transfers by owner request. Ordinary directory-type checks and guarded replacement/cleanup remain. Optional isolation diagnostics are advisory. |
| Backup absence | Mirror skips missing/read errors as best effort | Keep fail-closed backups. An adapter-issued verified absence result avoids repeating its exact successful absence probe; generic ENOENT from incomplete listings still requires verification. |
| Backup index | Upstream mirror stages a batch | Enumerate our backup Git index once per serialized batch, retaining per-path validation, conflict handling, committed content and link verification. |

Primary sources: [upstream transfer task](https://github.com/ng-jk/vscode-sftp/blob/ef4d3ca3e6fd2c0c24e05079d3dcf6093d633ce8/src/core/transferTask.ts), [FTP adapter](https://github.com/ng-jk/vscode-sftp/blob/ef4d3ca3e6fd2c0c24e05079d3dcf6093d633ce8/src/core/fs/ftpFileSystem.ts), [mirror](https://github.com/ng-jk/vscode-sftp/blob/ef4d3ca3e6fd2c0c24e05079d3dcf6093d633ce8/src/core/mirror.ts).

## Reproduce the wire workload

The existing FTP wire fixture has an optional benchmark mode. Set `DEVKIT_BENCHMARK_OUTPUT` to a local output filename, then run `node --test --test-name-pattern="FTP wire: passive" tests/ftp-wire.test.js`. It uploads six small files through three nested directories, then uploads them again with automatic backup enabled. The fixture adds 3 ms per control reply, records command counts and elapsed time, verifies transferred contents and closes its local server. Unset the variable after the run. To compare a retained previous bundled engine, additionally set `DEVKIT_BENCHMARK_ENGINE` to its path as resolved from the test file. Normal pipeline runs leave these variables unset and execute the complete wire regression.

Run alternating before/after samples and compare medians; local Git/ACL/disk activity can dominate overwrite times. The HTML release report records the actual samples and command counts. Command reductions are repeatable protocol savings, not a promise about throughput on any production server.

## Limits

FTP serializes control commands within each connection. From 0.7.15, batch uploads can use up to ftpConnections independent connections (default 1 since 0.7.18; previously 3). Existing originals must be downloaded and verified in the backup before replacement. Private staging and permissions require protocol round trips. SFTP can use the configured transfer concurrency; FTP does not pretend that parallel commands on one control connection provide safe concurrent data transfers. Large-file bandwidth, server load, network latency and local backup storage still affect elapsed time. No production server credentials were used for these measurements.


## Parallel connection benchmark

For a serial/parallel comparison with the same 0.7.15 engine, set DEVKIT_BENCHMARK_CONNECTIONS to 1 or 3 alongside DEVKIT_BENCHMARK_OUTPUT, then run the wire benchmark above. Added connection authentication is included in elapsed time. Originals are still downloaded and verified before workers upload. The HTML release report records three alternating samples for each setting; this is a local small-file latency workload, not a production throughput guarantee.

## Large batch reliability (0.7.18)

Compared against current upstream HEAD ef4d3ca3e6fd2c0c24e05079d3dcf6093d633ce8: upstream caches one connection per configuration, serializes FTP and multiplexes SFTP requests over one SSH session. The toolkit now defaults to one FTP connection too. Optional extra logins fall back to accepted sessions; certificate failures still stop the batch. Dropped FTP control connections reject pending requests instead of losing callbacks, and the scheduler stops queued transfers after failure. Login and passive-data establishment have independent 30-second and 60-second defaults. There is no total batch deadline or automatic replay of writes.

## 0.7.20 backup and staging optimization (2026-11-08)

One fixed-code Windows ACL worker now handles repository preparation and all staged backup files in a batch. Every file still receives its ACL establishment and verification; JSON paths are data, not executable code. Git stages the touched file list in one index transaction, including ignored originals, and committed-byte verification reuses a per-verification object cache. Replacement validates an identical staging/destination ancestor chain once at that boundary, with fresh checks still performed after payload and descriptor close. No directory validation is cached across mutations.

| Protocol / workload | 0.7.19 | 0.7.20 | Elapsed reduction | Requests before → after |
| --- | ---: | ---: | ---: | ---: |
| FTP / 6 files / new | 6.676s | 6.100s | 8.6% | 423 → 387 |
| FTP / 6 files / existing | 9.518s | 6.905s | 27.5% | 344 → 308 |
| SFTP / 6 files / new | 1.126s | 0.915s | 18.7% | 162 → 138 |
| SFTP / 6 files / existing | 3.853s | 4.885s | -26.8% | 185 → 161 |
| FTP / 24 files / new | 25.014s | 22.734s | 9.1% | 1575 → 1431 |
| FTP / 24 files / existing | 35.342s | 21.379s | 39.5% | 1352 → 1208 |
| SFTP / 24 files / new | 2.543s | 2.131s | 16.2% | 576 → 480 |
| SFTP / 24 files / existing | 9.317s | 3.668s | 60.6% | 707 → 611 |

Figures are medians of three runs per condition. Both protocols used 3 ms added fixture delay and verified payload bytes. FTP used one connection, SFTP used four concurrent transfers. Overwrite timings include downloading remote originals and verifying their Git backup. Windows startup/disk timing varies: the six-file SFTP overwrite series was slower despite fewer requests; the 24-file medians improved. Raw samples and method: [0.7.20 benchmark data](benchmarks/0.7.20.json).

The headless upstream FTP reference measured new: 1.128s, existing: 2.282s. This is faster than the toolkit. The reference uses upstream transfer/FTP/mirror logic with UI hooks stubbed, normalized legacy import interoperability, current local dependencies, temporary-file uploads and mirror enabled. The harness checks expected backup bytes; it is not an installed upstream UI benchmark. The toolkit additionally verifies private staging permissions, directory types, recoverable replacement and fail-closed backups. Equal production speed is not established.

To reproduce the upstream reference, run `node scripts/benchmark-upstream-sftp.js`, set `DEVKIT_BENCHMARK_ENGINE` to the generated absolute `dist/upstream-benchmark-engine.js` path and run the FTP benchmark above. For SFTP use `DEVKIT_SFTP_BENCHMARK_OUTPUT` and `node --test --test-name-pattern="SFTP wire: password" tests/sftp-wire.test.js`. `DEVKIT_BENCHMARK_FILES=24` selects the larger workload (1–48 supported). Clear benchmark environment variables after use.
