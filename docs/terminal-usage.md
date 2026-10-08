# Terminal usage

These commands run from a toolkit source checkout with Node.js 20+ and built dependencies. See [development setup](development.md). For installed VS Code commands use the [user manual](../README.md).

### FTP/SFTP from a terminal

The commands below run from a source checkout with Node.js 20+, `npm ci` and `npm run build:sftp`. VS Code uses the bundled version of the same engine.

```sh
node cli.js sftp config /path/to/project
node cli.js sftp profiles /path/to/project
node cli.js sftp list /path/to/project --context development
node cli.js sftp upload /path/to/project src/app.js --context development
node cli.js sftp download /path/to/project src/app.js --context staging
node cli.js sftp sync-up /path/to/project --context development
node cli.js sftp diff /path/to/project src/app.js --context development
node cli.js sftp watch /path/to/project --context development
node cli.js sftp --help
```

Paths are relative to the context’s local/remote roots. `--context` selects only that invocation and leaves `activeContext` unchanged. Use `--yes` only for intended destructive operations; Ctrl+C cancels/disconnects.



### Run the same request in a terminal

Use **Save request for CLI**, then run from a toolkit source checkout:

```sh
node cli.js send request.json --env environment.local.json --out response.json
node cli.js run collection.json --json results.json --junit results.xml
```

CLI secrets can use `{{env.NAME}}`. Collection reports return a failing exit code for failed assertions. Saved single-request responses may contain sensitive data. Add `--allow-scripts` only when you intend to run trusted scripts.


