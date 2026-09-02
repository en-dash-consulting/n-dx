# CLI Smoke Parity

> Cost/value review of this stage: [Cross-OS Pipeline Review — 2026-09](./cross-os-pipeline-review-2026-09.md). Its recommendations are applied as of 2026-09-02.

The macOS and Windows smoke jobs in [ci.yml](../../.github/workflows/ci.yml) must run the same canonical `ndx` validation sequence by invoking:

```bash
node scripts/cli-smoke-parity.mjs collect --output <artifact-path>
```

`collect` defaults to running the source-checkout CLI entrypoint via the current Node executable. Use `--cli-command <command>` only when you explicitly need to exercise a separately installed CLI binary.

The collector records the canonical sequence in each artifact under `sequence`, **and asserts the baseline contract on the platform that produced it**. The sequence is the structural contract used by the CI parity comparison.

## Where each check runs

This split is deliberate and load-bearing — a per-OS contract enforced in the comparison job is attributed to the wrong platform and is skipped exactly when a platform is already red.

| Check | Command | Job |
|---|---|---|
| Per-OS baseline: exit code, `stdoutExact`/`stderrExact`, required substrings, `stderrCode`, `stdoutJson` literal | `collect` (`validateBaseline`) | `CLI Smoke (macOS)` / `CLI Smoke (Windows)` |
| Canonical sequence metadata equality | `compare` (`compareSequence`) | `CLI Smoke Parity` |
| `comparable` projection and normalized failure codes, macOS vs Windows | `compare` (`compareArtifacts`) | `CLI Smoke Parity` |
| Raw separator / line-ending fingerprint, macOS vs Windows | `compare` (`shape`) | `CLI Smoke Parity` |

On a baseline failure the collector writes the artifact and *then* exits non-zero, and the upload steps run with `if: always()`, so the artifact recording the broken output is still published for diagnosis.

## Artifact Semantics

Each collected case keeps two views of the same run:

- `stdoutNormalized`, `stderrNormalized`, and `failure.detail` are diagnostic fields. They stay in the artifact so engineers can inspect native shell wording, normalized temp paths, and other OS-shaped context after a failure.
- `comparable.stdout` and `comparable.stdoutJson` are parity-critical for successful scenarios. CI compares them across platforms exactly.
- `comparable.failure.code` is parity-critical for failed scenarios. CI compares only the normalized error code across platforms.
- `failure.detail` is intentionally not parity-critical. It is allowed to drift between macOS and Windows when the underlying failure meaning is still the same.
- `shape` is present only on cases marked `shapeParity` and holds `{ crlfCount, backslashCount }` for each raw stream. It is parity-critical.

Use that split deliberately: artifact detail is for diagnosis, while the `comparable` projection is the cross-platform contract.

## Normalization limitation, and the shape fingerprint

`normalizeText` rewrites every `\r\n` to `\n` and every `\` to `/` before anything is compared. That is what lets CI ignore expected OS-specific differences — temp paths, shell wording, native process messages — while still failing on real semantic drift. The cost is that it also erases the bug class this matrix is named for: a hardcoded `\r\n` or a stray Windows separator in user-facing output is normalized away, not detected.

`shape` closes that gap. It counts `\r\n` and `\` on the raw stream (after runtime-noise stripping, which does not touch separators) and compares those counts across platforms.

It is opt-in per case via `shapeParity: true`, and only correct for cases whose output embeds **no filesystem path**. The two fixture cases are excluded: they print the temp directory, so on Windows their stderr legitimately carries native backslashes — measured 2026-09-02, `status-missing-rex` emits 12, all from the two embedded temp paths. Comparing counts there would fail on working behaviour. The six path-free cases measured 0 backslashes and 0 CRLF on Windows 11, so any nonzero count now means output grew a hardcoded separator.

If a message in a `shapeParity` case ever legitimately gains a path, drop that case's flag in the same change rather than loosening the check. `shapeParity` is recorded in the `sequence` metadata, so two platforms disagreeing about which cases are shape-compared fails `compareSequence` rather than silently skipping the check.

## Canonical Sequence

1. `ndx version`
2. `ndx version --json`
3. `ndx foobar`
4. `ndx statis`
5. `ndx help rex`
6. `ndx help plan`
7. `ndx status <TMPDIR>` with an empty fixture
8. `ndx status --format=json <TMPDIR>` with a seeded `.rex` fixture

## Baseline Contract

Each step carries a stable expectation embedded in the artifact sequence:

- expected exit code
- required stdout or stderr substrings for text commands
- projected JSON contract for structured commands

`collect` asserts this contract against the platform it runs on and exits non-zero if any case violates it.

`node scripts/cli-smoke-parity.mjs compare --mac <mac-artifact> --windows <windows-artifact>` then validates cross-OS agreement only:

- both artifacts were collected with the same canonical sequence metadata
- success-case comparable payloads are equal across macOS and Windows
- failure-case parity compares normalized error codes instead of raw stderr detail
- the raw separator / line-ending fingerprint is equal for every `shapeParity` case

When parity fails, the comparator reports the scenario name and either the exact field path that diverged or an explicit normalized error code mismatch.

## Cross-Platform CLI Error Code Reference

The table below is the maintained reference for exported `CLI_ERROR_CODES`. Tests fail if an exported code is missing from this list, or if a smoke-parity failure code is not marked as comparable.

| Code | Failure meaning | Comparable across platforms? | Typical remediation |
| --- | --- | --- | --- |
| `NDX_CLI_API_KEY_MISSING` | Required API credentials were not configured. | Yes | Set the required API key in environment or project config and rerun. |
| `NDX_CLI_AUTH_FAILED` | LLM API authentication was rejected (401, invalid key, expired token). | Yes | Verify the API key or CLI credentials and rerun. |
| `NDX_CLI_BUDGET_EXCEEDED` | Execution was rejected because a configured budget limit was exceeded. | Yes | Raise or reset the relevant budget, or reduce the requested work. |
| `NDX_CLI_CONCURRENCY_LIMIT` | Execution was blocked by a configured concurrency cap. | Yes | Wait for capacity or lower the number of simultaneous jobs. |
| `NDX_CLI_CONFIG_NOT_FOUND` | A required config file or config source could not be found. | Yes | Create the missing config or point the command at the correct location. |
| `NDX_CLI_DIRECTORY_NOT_FOUND` | The requested directory path does not exist. | Yes | Fix the path or create the directory before retrying. |
| `NDX_CLI_EPIC_NOT_FOUND` | The requested epic identifier does not exist in the PRD tree. | Yes | Verify the epic id or refresh the PRD state before retrying. |
| `NDX_CLI_GENERIC` | Fallback classification for CLI failures that do not yet have a narrower exported code. | Yes | Read the rendered error text, then either fix the underlying issue or introduce a more specific code if the failure is a new stable semantic bucket. |
| `NDX_CLI_INVALID_CONFIGURATION` | Configuration was found but failed validation or contained an unsupported value. | Yes | Fix the invalid config value and rerun. |
| `NDX_CLI_INVALID_PRD` | PRD data exists but is malformed or internally inconsistent. | Yes | Repair the PRD structure or regenerate the invalid artifact. |
| `NDX_CLI_INVALID_RUN_RECORD` | A persisted run record exists but is malformed or unreadable. | Yes | Repair or remove the invalid run record, then rerun. |
| `NDX_CLI_JSON_PARSE_FAILED` | Structured JSON input or output could not be parsed. | Yes | Inspect the malformed payload, then fix the producer or input file. |
| `NDX_CLI_LLM_CLI_NOT_FOUND` | An expected external LLM CLI executable could not be resolved. | Yes | Install the CLI or configure the correct executable path. |
| `NDX_CLI_LLM_RATE_LIMITED` | LLM API rate limit exceeded (429, too many requests, retry-after). | Yes | Wait for the retry-after period and rerun, or switch to a different model. |
| `NDX_CLI_LLM_SERVER_ERROR` | LLM API returned a server error (500, 503, 529 overloaded). | Yes | Wait and retry; consider switching models if the provider is persistently degraded. |
| `NDX_CLI_MEMORY_THRESHOLD` | Execution was blocked because memory pressure crossed the configured threshold. | Yes | Free resources, adjust the threshold, or reduce workload size. |
| `NDX_CLI_NETWORK_ERROR` | A network-level failure prevented reaching the LLM API (DNS, connection refused, fetch failed). | Yes | Check internet connectivity and retry. |
| `NDX_CLI_NOT_INITIALIZED` | The target workspace is missing required n-dx initialization state. | Yes | Run the relevant init command for the workspace, then retry. |
| `NDX_CLI_PERMISSION_DENIED` | The process lacks permission to read, write, or execute a required resource. | Yes | Fix filesystem or process permissions and rerun. |
| `NDX_CLI_PRD_NOT_FOUND` | The expected PRD file or PRD root could not be found. | Yes | Point the command at the correct PRD or create the missing artifact. |
| `NDX_CLI_RESOURCE_NOT_FOUND` | A requested named resource does not exist. | Yes | Verify the identifier and rerun against an existing resource. |
| `NDX_CLI_SOURCEVISION_MANIFEST_NOT_FOUND` | SourceVision-specific manifest data is missing. | Yes | Regenerate or supply the manifest before rerunning the command. |
| `NDX_CLI_TIMEOUT` | An LLM API request or network operation timed out before completing. | Yes | Retry with a shorter input or increase the timeout configuration. |
| `NDX_CLI_UNKNOWN_COMMAND` | The CLI command or subcommand is not recognized. | Yes | Fix the command spelling or use help output to find the supported command. |

## Contributor Guidance

When you introduce a failure that should compare cleanly across macOS and Windows:

1. Reuse an existing exported code when the new failure has the same user-facing meaning and the same remediation path.
2. Add a new exported code only when the failure meaning is distinct enough that engineers should triage it differently from existing buckets.
3. Format the emitted error with that code before the human-readable message so the collector can extract it as `failure.code`.
4. Update this reference table in the same change as the new exported code.
5. If the failure is added to smoke parity, make sure the case projects it through `comparable.failure.code` rather than comparing raw stderr detail.

Do not rely on `NDX_CLI_GENERIC` for a newly introduced comparable failure unless there is genuinely no stable semantic bucket yet. If engineers would take a different next step based on the failure, it should usually have its own exported code.
