---
"@n-dx/core": patch
---

`ndx export` now publishes run records through an allowlist, not a denylist.

`sanitizeRunForExport` deleted five named fields (`toolCalls`, `events`,
`error`, `diagnostics.promptSections`, `testGate.error`) and published
everything else verbatim. Everything else included the raw test-runner output
(`testGate.packages[].failureOutput`), post-run test output and error
(`structuredSummary.postRunTests.output` / `.error`), the literal command lines
the agent ran (`structuredSummary.commandsExecuted[].command`,
`testsRun[].command`), dependency-audit and cleanup error text, and
`diagnostics.notes[]`. The `runs.json` index was worse: it copied the whole
`structuredSummary` plus `error`. A failing test that printed an env dump, or an
agent `curl -H "Authorization: Bearer …"`, ended up in the static site while the
deploy manifest said transcripts were excluded — and `--deploy=github --yes`
force-pushed it.

- `sanitizeRunForExport` copies only fields named in an explicit allowlist, so a
  free-text field added to `RunRecord` later is excluded by default rather than
  published by default. It keeps what the deployed viewer renders: identity,
  timestamps, status, turns, summary, model/vendor/weight/`ndxVersion`, token
  usage and per-turn totals, `structuredSummary.counts` and
  `fileChangesWithStatus`, diagnostic labels, the test-gate verdict, review
  counts.
- A new `summarizeRunForExport` builds the `runs.json` entries, mirroring the
  live server's `toRunSummary`. It drops `error` (published only under
  `--include-transcripts`) and stamps `transcriptOmitted`, and it now carries
  `vendor`, `tokenDiagnosticStatus` and `invocationContext`, which the runs list
  renders and the export previously omitted.
- `cliPath` (an absolute path on the operator's machine), `actor` (git name and
  email) and `host` are no longer published.
- The deploy manifest and `ndx export --help` describe what is actually
  withheld, including that the record is allowlisted.
- `tests/unit/export-sanitize.test.js` replaces every string leaf of a full
  run-record fixture with a sentinel naming its own path and asserts the exact
  set that survives, so a new leak fails without anyone remembering to deny it.
  `tests/e2e/cli-export.test.js` asserts on the bytes actually written to
  `api/hench/runs/<id>.json` and `api/hench/runs.json`.

Found by the 2026-09-15 adversarial review of the September security fix branch.
