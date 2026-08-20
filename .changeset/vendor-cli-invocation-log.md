---
"@n-dx/llm-client": patch
"@n-dx/core": patch
---

Record every vendor CLI invocation to an append-only `claude_commands.log`.

Each `claude` / `codex` spawn now appends one JSON line capturing the timestamp, vendor, binary, argv, cwd, platform, the spawning helper, and — on Windows — the fully-built verbatim command line. The log accumulates across sessions, giving a project a consistent history of what was actually run.

Wired at the spawn chokepoints rather than per call site, so a single edit per tier covers everything downstream:

- `packages/llm-client/src/exec.ts` `spawnCli` — covers `cli-provider.ts` (claude), `codex-cli-provider.ts` (codex), and hench's `cli-loop.ts`
- `packages/core/win-spawn.js` `spawnCli` + `execFileSyncCli` — covers `pair-programming.js` reviewer runs and `config.js` preflight/`--version` probes
- `packages/core/claude-integration.js` — the `ndx init` MCP registration `claude mcp add/remove` calls, which use raw `execSync` and bypass the helpers

Behaviour:

- **On by default**; opt out with `NDX_CLI_LOG=0` (also `false` / `no`).
- **Path**: `<cwd>/claude_commands.log`, overridable via `NDX_CLI_LOG_PATH`. Gitignored, along with its rotated `.1` generation.
- **Secrets redacted before the write** — values following `--api-key`/`--token`/`--password` (and the `--flag=value` form), plus standalone `sk-ant-*`, `sk-*`, `gh[pousr]_*`, and `AIza*` tokens become `<redacted>`. The log is a plain file that outlives the process, so redaction happens at write time rather than read time.
- **One atomic single-line append per invocation**, so concurrent `ndx` processes interleave cleanly by line instead of tearing.
- **Never throws** — an unwritable cwd, permission error, or full disk cannot turn a logging failure into a spawn failure.
- **Rotates at 1 MB** to `claude_commands.log.1`, mirroring `.rex/execution-log.jsonl`.

The implementation is duplicated as `packages/llm-client/src/cli-log.ts` and `packages/core/cli-log.js` because the orchestration tier must not import `@n-dx/llm-client` (spawn-only rule) — the same constraint that already forces the `quoteWindowsToken` twin. `tests/unit/cli-log.test.js` runs the full behavioural suite against both copies and asserts they emit byte-identical lines for a shared record table; both twins are imported from source so the parity check cannot fail on a stale `dist/`.

Also adds `cli-log.js` to `@n-dx/core`'s `files` allowlist — without it the published package would import a file it does not ship.
