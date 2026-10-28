# FTP/SFTP transfer performance

The comparison uses ng-jk/vscode-sftp commit `ef4d3ca3e6fd2c0c24e05079d3dcf6093d633ce8`, the upstream revision recorded in `vendor/sftp/provenance.json`. The before/after wire benchmark compares this toolkit 0.7.13 (`b6edb011b2896f70e2f00a3ad3a3ac43fdeccfc0`) with 0.7.14; it does not claim a measured speedup over the upstream extension.

| Area | Upstream implementation | Toolkit requirements and optimization |
| --- | --- | --- |
| FTP payload | `put` directly calls STOR | Keep private staging and verified permissions; remove cleanup requests only after confirmed successful moves. |
| Transfer preparation | Some source/open work runs concurrently; directory setup uses ensureDir | Keep safe ancestry and mode checks. Share FTP listings only during a file's read-only preflight, ending the snapshot before staged-file mutation. |
| Ancestor metadata | No equivalent root/owner isolation policy | Historical 0.7.14 behavior checked owners/modes. From 0.7.16 these audits are removed by request; ordinary directory-type checks remain. |
| Backup absence | Mirror skips missing/read errors as best effort | Keep fail-closed backups. An adapter-issued verified absence result avoids repeating its exact successful absence probe; generic ENOENT from incomplete listings still requires verification. |
| Backup index | Upstream mirror stages a batch | Enumerate our backup Git index once per serialized batch, retaining per-path validation, conflict handling, committed content and link verification. |

Primary sources: [upstream transfer task](https://github.com/ng-jk/vscode-sftp/blob/ef4d3ca3e6fd2c0c24e05079d3dcf6093d633ce8/src/core/transferTask.ts), [FTP adapter](https://github.com/ng-jk/vscode-sftp/blob/ef4d3ca3e6fd2c0c24e05079d3dcf6093d633ce8/src/core/fs/ftpFileSystem.ts), [mirror](https://github.com/ng-jk/vscode-sftp/blob/ef4d3ca3e6fd2c0c24e05079d3dcf6093d633ce8/src/core/mirror.ts).

## Reproduce the wire workload

The existing FTP wire fixture has an optional benchmark mode. Set `DEVKIT_BENCHMARK_OUTPUT` to a local output filename, then run `node --test --test-name-pattern="FTP wire: passive" tests/ftp-wire.test.js`. It uploads six small files through three nested directories, then uploads them again with automatic backup enabled. The fixture adds 3 ms per control reply, records command counts and elapsed time, verifies transferred contents and closes its local server. Unset the variable after the run. To compare a retained previous bundled engine, additionally set `DEVKIT_BENCHMARK_ENGINE` to its path as resolved from the test file. Normal pipeline runs leave these variables unset and execute the complete wire regression.

Run alternating before/after samples and compare medians; local Git/ACL/disk activity can dominate overwrite times. The HTML release report records the actual samples and command counts. Command reductions are repeatable protocol savings, not a promise about throughput on any production server.

## Limits

FTP serializes control commands within each connection. From 0.7.15, batch uploads can use up to ftpConnections independent connections (default 3). Existing originals must be downloaded and verified in the backup before replacement. Private staging and permissions require protocol round trips. SFTP can use the configured transfer concurrency; FTP does not pretend that parallel commands on one control connection provide safe concurrent data transfers. Large-file bandwidth, server load, network latency and local backup storage still affect elapsed time. No production server credentials were used for these measurements.


## Parallel connection benchmark

For a serial/parallel comparison with the same 0.7.15 engine, set DEVKIT_BENCHMARK_CONNECTIONS to 1 or 3 alongside DEVKIT_BENCHMARK_OUTPUT, then run the wire benchmark above. Added connection authentication is included in elapsed time. Originals are still downloaded and verified before workers upload. The HTML release report records three alternating samples for each setting; this is a local small-file latency workload, not a production throughput guarantee.
