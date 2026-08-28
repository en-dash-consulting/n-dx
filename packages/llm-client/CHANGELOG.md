# @n-dx/llm-client

## 0.5.1

### Patch Changes

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Ctrl-C now reaches commands run through `exec()`. Tree-kill puts POSIX children in their own process group so a timeout can reach grandchildren, which also took them out of the group the terminal signals — so an interrupt no longer stopped them, and hench's `run_command` and `git` tools had to be killed by hand. While a detached child is alive, a SIGINT arriving at the parent is now forwarded to the child's group. One shared listener regardless of how many commands are in flight, removed as soon as the last child settles, and it stands down and re-raises when nothing else is listening so a CLI never ends up ignoring Ctrl-C. Windows is unchanged — it never detaches for tree-kill.

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the tests' `sh`-on-PATH dependency explicit instead of failing opaquely.
  
  `sh` is absent from a stock Windows PATH — it ships with Git for Windows, which Git Bash exposes and PowerShell/cmd.exe do not. Tests that spawn `sh -c` therefore passed from Git Bash and failed from PowerShell on the same commit, and no failure message mentioned a shell: the orphan test reported `expected false to be true` after burning a 5s wait, because the grandchild that never started also never wrote its pid. Two of these were investigated as suspected regressions during a merge before the shell was identified as the variable.
  
  The audit found more than the two files that prompted it: **28 shell-dependent cases across 5 files**, of which 21 were failing and **5 were passing vacuously** — a case asserting "nothing was written after the timeout" is trivially satisfied when nothing ever ran, and hench's `reports exit code on failure without output` is satisfied by a spawn that failed to launch. Those were green on machines where the behaviour was never exercised, which is the worse half of this bug.
  
  Each site now skips with `sh` named, via one helper per suite boundary, all delegating to the production `isExecutableOnPath` probe. The `sh` indirection itself is preserved, not removed: libuv puts every non-detached child it spawns on Windows into a global job object, so spawning `node` directly would reap the tree for free and make the tests vacuous — which is how an earlier version of the orphan test managed to prove nothing.
  
  For hench the skip says more, because there `sh` is not scaffolding: `run_command` and the post-task test runner spawn `sh -c` on *every* platform, so a machine without `sh` cannot run those tools at all. The skip records which product capability went unverified rather than implying a test artifact.
  
  Also: shell spawns in tests no longer discard their own failure. `stdio: "ignore"` is about the child's output, and with the spawn error thrown away an unresolvable shell looked identical to a surviving orphan. Full inventory and the rules for adding a new shell-spawning test are in `tests/shell-spawn-inventory.md`.

- [#342](https://github.com/en-dash-consulting/n-dx/pull/342) [`a7b3227`](https://github.com/en-dash-consulting/n-dx/commit/a7b3227e42f778bedb0e19343cf42443f545c167) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `ndx work --review`: an adversarial review pass that runs after a task's
  changes validate and before the commit prompt, so must-fix repairs ship in the
  same commit as the work they repair.
  
  **`--review` changes meaning; the old gate is now `--approve-diff`.** The flag
  previously showed the diff and prompted for approval. That gate is unchanged
  apart from its name — pass `--approve-diff` to get it. The two are independent
  and compose: the review pass runs first, so a human answering the diff prompt
  sees the repaired tree rather than the one the implementer left behind. Runs
  that pass `--review` print a line saying where the old behavior went.
  
  **The reviewer resumes the work session.** On the Claude CLI the pass re-enters
  the session that just did the work (`--resume <session-id>`, captured from the
  `session_id` that `--output-format stream-json` stamps on every line) and runs
  it on a stronger model. That inherits what the diff cannot show: which
  approaches were tried and abandoned, which files were read and found
  irrelevant, what the implementer believed it was doing. Vendors whose CLI has no
  resume equivalent — and any run where the session id never arrived — fall back
  to a fresh reviewer seeded with the task, its acceptance criteria, and the
  change's scope.
  
  Resuming invites anchoring, so the reviewer's system prompt is built against it:
  prior reasoning in the conversation is named as evidence under test rather than
  a position to defend, and every finding must carry inputs-to-wrong-result
  concrete enough to be refuted. Findings that cannot be triggered are dropped
  rather than softened.
  
  **Review gets its own model tier, `REVIEW_MODELS`.** Review is read-heavy and
  judgment-dense but short — one diff, one pass — so its token volume is a
  fraction of the run it audits and a stronger model costs little in absolute
  terms. Claude defaults to `claude-opus-5` ($5/$25 per MTok): Opus-tier reasoning
  at the same input price as Opus 4.8, where `claude-fable-5` would cost twice as
  much for a single pass. Codex and Google resolve to their existing top tier;
  local uses whatever is loaded.
  
  Resolution is `--review-model` → `llm.<vendor>.reviewModel` → `llm.reviewModel`
  → the vendor default. `llm.model` and `llm.<vendor>.model` are deliberately
  excluded: inheriting the execution model would mean a project that pins a cheap
  executor silently gets a cheap reviewer, which defeats the reason the tier
  exists. `--review-model` without `--review` is an error rather than a no-op.
  
  **Findings are triaged, not just listed.** Autonomous runs apply the verdict
  policy directly — `must-fix` is repaired in-session with the test that would
  have caught it, `should-fix` and `out-of-scope` are captured as rex items after
  checking `.rex/prd_tree/` for an existing item describing the same defect, and
  `not-worth-fixing` is reported with its reason. Interactive runs still stop and
  ask before writing anything to the PRD. The reviewer is barred from committing,
  from changing task status, and from any command that rewrites analysis or PRD
  state concurrently with the run.
  
  **A broken review never fails a valid task.** By the time the pass runs, the
  task's own completion validation has already passed, so a reviewer that dies,
  writes nothing, or writes something unparseable tells us nothing about the work
  — the failure is reported and the run continues. The distinction is preserved
  on the run record (`run.review`) rather than left in terminal scrollback,
  because a review that silently did not happen must not read as one that found
  nothing. Report transport is a JSON file under `.hench/reviews/<run-id>.json`,
  keyed by run so a re-review keeps both, and cleared before each pass so a stale
  report can never be read as the current one. Unknown enum values in a report
  are coerced toward alarm — an unrecognized severity becomes `critical`, an
  unrecognized action becomes `failed` — so a garbled field demands attention
  instead of reading as clean.
  
  The pass requires the CLI provider and errors out on `provider=api` rather than
  accepting the flag and doing nothing. Its token usage is charged to the run it
  reviewed, so `ndx usage` reflects what `--review` actually costs.

- [#339](https://github.com/en-dash-consulting/n-dx/pull/339) [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12) Thanks [@endash-shal](https://github.com/endash-shal)! - Update LLM model catalogs to current vendor releases
  
  Refreshes the Claude, Codex, and Gemini model catalogs and fixes several
  incorrect context-window and pricing entries. Two of the previous defaults
  pointed at models that are no longer usable.
  
  **Claude**
  - `claude-opus-4-8` → `claude-opus-5` in the init catalog, the `opus` shorthand
    alias, and the `heavy` tier (was `claude-opus-4-7`).
  - Added a `fable` shorthand alias for `claude-fable-5`.
  - Corrected context windows: `claude-sonnet-4-6` and `claude-opus-4-7` are 1M
    models, not 200K.
  - Corrected pricing: `claude-haiku-4-5` is $1.00/$5.00 (was $0.80/$4.00) and
    `claude-opus-4-7` is $5.00/$25.00 (was $15.00/$75.00).
  - Default remains `claude-sonnet-5`.
  
  **Codex** — GPT-5.6 replaces the GPT-5.4/5.5 line
  - Default is now `gpt-5.6-terra` (was `gpt-5.5`), with `gpt-5.6-sol` as a new
    `heavy` tier (codex previously had no tier above standard) and `gpt-5.6-luna`
    as `light` (was `gpt-5.4-mini`).
  - `gpt-5.4` and `gpt-5.4-mini` retire from ChatGPT-authenticated Codex sessions
    on 2026-08-31; `gpt-5.3-codex` and `gpt-5.2` are already unavailable there.
    All four are now legacy aliases that normalize to OpenAI's stated
    replacements, so existing `.n-dx.json` files keep working after upgrade.
  - `gpt-5.5` is still supported and remains a selectable catalog entry.
  - `openai-api-provider` default was `gpt-4o`; now `gpt-5.6-terra`.
  
  **Google**
  - `gemini-2.0-flash` has been **shut down** by Google and was the configured
    `light` tier — replaced with `gemini-3.5-flash-lite`. `standard` moves from
    `gemini-2.5-flash` to `gemini-3.7-flash`.
  - `heavy` intentionally stays on `gemini-2.5-pro`, the newest *stable* Pro
    model. `gemini-3.1-pro-preview` is newer but is a preview release whose ID
    may be renamed or withdrawn; it remains selectable via `llm.google.model`.
  - Corrected `gemini-2.5-flash` pricing to $0.30/$2.50 (was $0.15/$0.60).
  
  Also refreshes the dashboard's model suggestions, which still listed retired
  IDs (`claude-haiku-3-5`, `claude-3-7-sonnet-20250219`, `o3`, `o4-mini`), and
  updates model examples in `ndx config --help`, `ndx init --help`, and the
  configuration guide.

- [#331](https://github.com/en-dash-consulting/n-dx/pull/331) [`cfdd3b5`](https://github.com/en-dash-consulting/n-dx/commit/cfdd3b5d3f53ad7e6a032fa855ba66a359818be9) Thanks [@jeremylumanbailey](https://github.com/jeremylumanbailey)! - Add `--verbose`/`--debug` live progress across `ndx init` and `sourcevision analyze`, and replace scattered vendor string literals with shared `LLM_VENDOR` constants.
  
  **Live progress instrumentation.** `ndx init` gave no visibility into a slow `sourcevision analyze` run — `--debug` reached the child process but its output was fully captured and discarded on success, so a slow run was indistinguishable from a hung one. `ndx init`'s spinner now forwards the child's own progress live (throttled so a high-volume `--debug` firehose can't stall the pipe via backpressure), and the Components phase (component parsing, route detection, server-route detection) gets per-operation timestamped tracing plus automatic gap detection that flags any silence past 250ms by naming the last known checkpoint. A worker-thread-backed live stopwatch prints an incrementing "current operation runtime" for any operation still in flight — verified to keep ticking even during a fully synchronous, non-yielding block, which a same-thread timer cannot do. `hench`'s shell tool gets equivalent live-tail output for long-running commands.
  
  **Fixed a real infinite loop this instrumentation surfaced.** `inferPrefix` (server-route prefix inference) could spin forever on any two ordinary routes that share no deeper common path (e.g. `/users/:id` and `/orders`) — confirmed live via a CPU sample showing 100% of time in `String.prototype.lastIndexOf`. Also tightens `isLikelyRouteFile` so a client-side `api/` directory (axios/fetch-style callers, not Express-style route definitions) is no longer scanned for server routes at all, and adds a length guard against any future misextracted route "path" that's actually an unrelated string literal.
  
  **Vendor literal consolidation.** Replaces hardcoded `"claude"`/`"codex"`/`"google"`/`"local"` string comparisons throughout `core`, `hench`, `rex`, `sourcevision`, and `web` with the canonical `LLM_VENDOR`/`DEFAULT_LLM_VENDOR`/`LLM_VENDORS`/`isLLMVendor` helpers exported from `provider-interface.ts` and re-exported through each package's llm-client gateway, so the supported-vendor set has one source of truth instead of being duplicated ad hoc at each call site.
  
  **Fixed `ndx config <key>` incorrectly reporting an initialized project as stale.** The pre-dispatch directory resolver used for the staleness check and command-timeout config load treated a config key like `llm` as a target directory when no explicit directory argument was given, so `ndx config llm` looked for `.sourcevision`/`.rex`/`.hench` under a nonexistent `llm/` subdirectory and reported a fully-initialized project as uninitialized.

## 0.5.0

### Minor Changes

- [#295](https://github.com/en-dash-consulting/n-dx/pull/295) [`21283a2`](https://github.com/en-dash-consulting/n-dx/commit/21283a22fcd2b68d5f016fe923e49908c141ebf0) Thanks [@jeremylumanbailey](https://github.com/jeremylumanbailey)! - When running ndx config llm.vendor claude if the auth is outdated, a vague error message would show. Now the error message is more explicit and users can run "ndx auth" to troubleshoot that their auth for the configured llm is up to date

### Patch Changes

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Surface concise re-authentication guidance when a provider rejects credentials, and stop dumping raw JSON error payloads.
  
  A new canonical helper in `@n-dx/llm-client` (`authFailureGuidance` / `authFailureMessage`) is the single source of truth for auth-failure wording: it names the provider, states the cause (`Invalid or expired credentials`), and gives the exact fix — `claude logout && claude login`, `codex logout && codex login`, or `ndx config llm.google.api_key <KEY>`. Every entry point now reads identically:
  
  - **`ndx init` / `ndx config llm.vendor`** — the core preflight (`packages/core/config.js`) replaces the verbose `Details: <raw JSON>` dump with the concise, ANSI-colored guidance (red headline, yellow remediation). The NDX error code (e.g. `NDX_CLAUDE_PREFLIGHT_AUTH_REQUIRED`) is demoted to a dim secondary line instead of the headline, and JSON payloads are never printed. A missing Google key gets a distinct "No API key configured" message.
  - **`ndx work`** — the runtime LLM providers already throw `AuthFailureError`; its message is now the canonical, JSON-free line.
  - **`ndx plan` / `ndx analyze`** — rex/sourcevision route auth errors through the shared classifier and (for rex) render `AuthFailureError` with the shared remediation.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Redact secrets in the logged `commandLine`, and cover every secret pattern in the twin tests.
  
  `cli-log` redacted `args` but wrote `commandLine` through verbatim. On Windows that is the same data twice: `buildWindowsCliCommandLine(binary, args)` embeds the argv into the command line, so a key that `redactArgs` correctly replaced with `<redacted>` in the `args` field reappeared in full in `commandLine` on the same log line of `claude_commands.log`.
  
  `redactArgs` cannot be reused for this, and reaching for it makes things worse rather than better. It iterates its argument, so handing it a string walks the individual characters — every pattern is anchored (`^sk-ant-…`), no single character matches, and the field is emitted as an array of letters with the secret fully intact:
  
  ```json
  "commandLine":["c","l","a","u","d","e"," ","-","-","a","p","i","-","k","e","y"," ","s","k","-","a","n","t","-","S","E","C","R","E","T"]
  ```
  
  So both twins gain a `redactCommandLine(line)` that tokenises on whitespace, preserves the original spacing, and applies the same `SECRET_FLAGS` / `SECRET_PATTERNS` tables through the surrounding quotes that `buildWindowsCliCommandLine` adds. Returns a string, as the field's own type always claimed.
  
  **Two of the four `SECRET_PATTERNS` were never exercised.** The parity block drove five fixed records, and between them they only ever hit `gh[pousr]_`; the per-twin behaviour block added `sk-ant-`. Nothing anywhere passed an `AIza…` (Google AI Studio) or a non-Anthropic `sk-…` token, in either twin. Either pattern could have been dropped from either copy with the whole suite green — and a dropped pattern means the key it matches is written to disk in plaintext. Both now have cases, plus `redactCommandLine` coverage per twin and a secret-bearing `commandLine` in the parity records.
  
  Verified by deleting the `AIza` pattern from the core twin alone: 4 assertions fail across both the behaviour and parity blocks, where previously that deletion was invisible.
  
  Also corrects both twins' TWIN docblock, which pointed at `tests/unit/cli-log-parity.test.js`. No such file exists — the guard is the `cli-log twin parity` block inside `tests/unit/cli-log.test.js`. A pointer whose only job is telling the next person where the tripwire is should not name a file that was never there.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - `exec` no longer reports a timeout while the process tree is still alive.
  
  The timeout path already awaited the tree kill before resolving, but the `close` handler resolved too — and `close` fires when the DIRECT child's pipes close, which with `shell: true` is the moment the shell dies, not the moment its descendants do. Since `finish()` is idempotent, `close` won the race and the awaited path was effectively dead code (its own comment assumed as much). Callers therefore resumed against a live tree still holding the cwd and any port it had bound.
  
  On Windows that surfaced as `EBUSY: resource busy or locked, rmdir` when a test tore down its workspace immediately after a timeout — hench's `tests/unit/tools/shell.test.ts`, on a CI runner slow enough for `taskkill /T` to still be running. Everywhere else it was silent: a leaked process nobody attributed to the timeout.
  
  `close` now defers to the timeout path when our own timer fired, so the promise settles only after termination completes. An externally delivered signal is not ours to wait on and still reports immediately. The timeout path was also hardened to settle even if the kill itself throws — previously a rejected kill left nothing to resolve the promise, which only went unnoticed because `close` was resolving first.
  
  Note the trade: a timed-out `exec` now takes as long as the tree kill needs (bounded by `forceKillTimeoutMs`) before it returns. That is the point — the previous latency was borrowed against correctness.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Make a command timeout actually stop the command, descendants included.
  
  `exec` delegated its timeout to Node's `execFile`, which signals only the process it spawned. Anything that process had itself started survived — kept running, kept holding file handles, kept writing to the workspace — while the caller had already been told the command stopped. Measured on Windows with a 400ms timeout: the reported result was `Command timed out after 400ms`, yet the surviving process went on to write four more times, and a temp directory it held could not be removed for 52 seconds.
  
  That report is what an autonomous agent acts on. It reads files and runs the next command believing the previous one finished, so a build or codemod still writing underneath it can corrupt the state being read.
  
  `exec` now owns the timeout timer and terminates the whole process tree when it fires: a process-group signal on POSIX (`SIGTERM`, escalating to `SIGKILL`, waiting on the *group* rather than the direct child), and `taskkill /T /F` on Windows. `exitCode: null` still signals a timeout, and an externally-killed child still reports the same way it always did. Opt out with `treeKill: false` when a child must stay in the caller's own process group.
  
  Not a Windows-only fix, though Windows is where it was caught: the orphan survived on POSIX too, just invisibly, because unlinking open files is permitted there so no EBUSY drew attention to it. On Windows, libuv's global job object masks the problem for node-spawned node, but not for the cases that matter — `sh`, `cmd`, `make`, and pnpm/npm shims all leave their children behind.
  
  The primitive is exported as `terminateProcessTree` / `treeKillSpawnOptions`. It is a deliberate twin of `terminateTree` in `packages/core/child-lifecycle.js`, since the orchestration tier must not import from packages; a parity test fails if the two diverge.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Detect authentication/session loss before it cascades. `@n-dx/llm-client` now exports `isAuthError(message)`, a shared predicate that recognizes both API auth failures (401/403, rejected/invalid keys, `unauthorized`) and CLI session loss (`not logged in`, `please run … login`, `/login`, expired/revoked sessions or OAuth tokens, `re-authenticate`). `classifyLLMError` uses it, so lost-session messages are now classified as `auth` with re-authentication guidance. In hench's CLI run-loop, `processErrorResult` checks for auth errors *before* the transient-retry check: auth loss is never transient, so the run now fails immediately with actionable re-auth guidance (and a distinct `auth_error` log event) instead of burning retries on a failure the user must fix.

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Enforce the git-subcommand allowlist in CLI provider mode. Previously only the
  API-provider agent loop honored `guard.allowedGitSubcommands`; CLI-mode spawns
  were granted a blanket `Bash(git:*)`, which auto-approved destructive
  subcommands (`reset`, `clean`, `revert`, `push`). The Claude CLI adapter now
  grants `git` at subcommand granularity (`Bash(git commit:*)`, …) drawn from the
  guard allowlist, so destructive subcommands fall through to a permission prompt
  (denied under a non-interactive `acceptEdits` spawn). Codex remains
  sandbox-gated (no per-command allowlist). When no allowlist is present, `git`
  keeps its legacy unscoped grant.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Clear the losing timer in every bounded termination wait, so a CLI exits when its work is done.
  
  `Promise.race([waitForChildExit(child), delay(forceKillTimeoutMs)])` reads as "wait, but not forever". It also leaks: when the child wins the race, the `delay` timer is still armed, and an armed timer holds the event loop open. Nothing was waiting on it — the process simply could not exit until it fired.
  
  Measured against `sh -c "sleep 30"` with a 300 ms command timeout, before and after, no other change:
  
  | | `exec()` resolves | process exits | dead time |
  |---|---|---|---|
  | before | 432 ms | 5436 ms | ~5000 ms |
  | after | 445 ms | 446 ms | ~1 ms |
  
  The 5 s is `DEFAULT_FORCE_KILL_TIMEOUT_MS`. Any CLI that finished immediately after a command timeout sat idle for the full kill grace period before returning to the shell.
  
  Nine sites across the two twins, all of them replaced with a `raceWithTimeout` helper that clears its own timer in a `finally`:
  
  - `packages/llm-client/src/process-tree.ts` — four `waitForChildExit` races, the `taskkill` completion race, and `captureStdout`'s bare `setTimeout(finish, timeoutMs)`. That last one is the worst of the set: it is reached on every POSIX non-freeze kill via `posixDescendants` → `readProcessTable`, where `ps` returns in milliseconds but the timer is armed for the whole grace period.
  - `packages/core/child-lifecycle.js` — the `childTarget` wait adapter and both Windows tree-kill races. Same defect, and it had to be fixed twice because the orchestration tier cannot import `@n-dx/llm-client` (spawn-only rule).
  
  The polling `delay()` calls are deliberately untouched. Those are awaited directly rather than raced, so their timer always fires and never outlives its await — replacing them would add a `clearTimeout` that can never run.
  
  No behavioural change to the kill sequence itself: the same signals go out in the same order with the same bounds, and every existing termination test passes unmodified. What changes is only how long the process lingers afterwards.

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `ndx auth` — on-demand credential verification for the active LLM vendor.
  
  The command re-runs the same provider auth preflight used by `ndx init` / `ndx config llm.vendor` and exits 0 when credentials are valid (printing the active vendor, resolved model, and "credentials valid") or 1 on failure (printing the canonical, JSON-free auth-failure guidance). It works without an initialized project — the default vendor (claude) is checked when no config exists.
  
  Every vendor's auth-failure remediation (and the flattened `authFailureMessage` used by runtime errors) now ends with the canonical verification step `Verify credentials: ndx auth`, exported from `@n-dx/llm-client` as `VERIFY_CREDENTIALS_STEP`, so users always know how to confirm a fix.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a BETA option to make the POSIX timeout kill definitive: freeze the process tree, prove it is frozen, then kill it. **Off by default.**
  
  It ships behind a flag because the sweep it replaces has far more mileage: the freeze path's unit coverage injects its seams, and its behaviour against real POSIX processes is not yet proven in CI. Enable per-project with `ndx config experimental.posixFreezeTreeKill true`, or for a single run with `NDX_POSIX_FREEZE_KILL=1`. `ndx config --help` documents it as BETA and NOT RIGOROUSLY TESTED so nobody turns it on unaware.
  
  The previous approach enumerated descendants and signalled them, which is inference. Its hole is reparenting: a descendant whose parent dies is adopted by init, so the pid→ppid link the enumeration depends on dissolves at exactly the moment the killing starts. The old code collected descendants *before* signalling to work around that; freezing first removes it, because reparenting only happens when a parent exits and nothing exits until enumeration is finished.
  
  On timeout, `exec` now SIGSTOPs the tree, closes over its descendants to a fixpoint — a pass that discovers nothing, rather than a fixed number of rounds — verifies every member reads as stopped in the process table, and only then SIGKILLs, leaves before parents. It terminates because SIGSTOP cannot be caught, blocked, or ignored and a stopped process cannot fork, so new arrivals can only come from processes that were still running at the previous read, and that set shrinks monotonically. When the child *is* a process-group leader the fast path skips enumeration entirely: group membership is inherited rather than listed, so `SIGSTOP` then `SIGKILL` on the group are atomic over the whole tree.
  
  SIGKILL, never SIGTERM: a stopped process does not act on SIGTERM — the signal queues until SIGCONT — so a "graceful" attempt against a frozen tree is a silent no-op. Freezing and graceful termination are therefore mutually exclusive, and this policy is opt-in via `freeze` on `terminateProcessTree`, used only for timeouts and runaways. Graceful shutdown keeps its SIGTERM grace period unchanged, and a test pins that the two policies stay distinct.
  
  Windows is unchanged. It has no pure-JS pause — libuv maps the signals it supports onto TerminateProcess, and the real equivalents all need native code — so `taskkill /T` remains a tree walk. Its failure mode is the mirror image of POSIX's and is now documented where taskkill is invoked: Windows never reparents, so a link survives its parent's death and can dangle onto a recycled pid.
  
  Known limit, recorded in the code: a deliberate double-fork daemon escapes parentage by design and no enumeration finds it. That is a policy question about whether agent-run commands may daemonize, not a detection one.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Reconcile Codex model identifiers across the config surface. Removed the dead `gpt-5.4mini` legacy alias from `LEGACY_CODEX_MODEL_ALIASES` (its target `gpt-5.4-mini` is already a direct catalog model and the non-hyphen key was never a shipped ID). The remaining legacy brand IDs (`gpt-5-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`) now match the orchestration-tier list in `init-llm.js`, with cross-reference comments pinning the two tiers together. Updated the hench vendor-compatibility error hint from the outdated `gpt-4o, o1` to current Codex models (`gpt-5.5, gpt-5.4-mini`).

- [#279](https://github.com/en-dash-consulting/n-dx/pull/279) [`18b36f7`](https://github.com/en-dash-consulting/n-dx/commit/18b36f73c0b18bdf508b956e3fb42e5bbf5aeabd) Thanks [@endash-shal](https://github.com/endash-shal)! - Refresh the Claude model catalog shown in `ndx init` and align the runtime default. Adds **Claude Fable 5** (`claude-fable-5`) and **Claude Sonnet 5** (`claude-sonnet-5`) to the selector, and promotes Sonnet 5 to the recommended default (replacing the previous-generation Sonnet 4.6 as the pre-selected model and as `DEFAULT_CLAUDE_MODEL` / `NEWEST_MODELS.claude`). Sonnet 5's 1M context window and pricing are registered for budget preflight. `claude-sonnet-4-6` remains a valid, accepted model id (kept in the context/cost maps and added to the init legacy-alias list) so existing configs and `--claude-model=claude-sonnet-4-6` keep working without warnings. Codex and Gemini catalogs are unchanged.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Self-heal can be stopped from the dashboard. The web server exposes `POST /api/commands/self-heal/stop`, which kills the managed loop process (SIGTERM) and reports it as stopped rather than failed. The Self-Heal panel shows the current iteration and phase parsed from loop output, with a Stop button while it runs.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Self-heal and n-dx workflow visibility in the dashboard. The dashboard can now run and observe the full n-dx flow: self-heal with live iteration/phase progress and a stop control, full sourcevision analysis with async progress, rex fix/reshape/CI actions with dry-run previews, a Commands reference with inline run triggers, and views for the previously UI-less requirements, adaptive-optimization, and activity-log APIs. Command references throughout the dashboard and hench prompts resolve from the project's detected CLI name.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard job progress now streams while commands run: full/targeted sourcevision analysis, data refresh, and self-heal spawn through `spawnManaged` with a new `onStdout` chunk callback, so status endpoints expose live output, refresh phases, and self-heal iteration progress mid-run instead of only after exit. The `signal` option briefly added to the buffering `exec` is removed — `spawnManaged.kill()` covers cancellation.

- [#330](https://github.com/en-dash-consulting/n-dx/pull/330) [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056) Thanks [@endash-shal](https://github.com/endash-shal)! - Local-loop tasks reset to pending on infra failures (retryable instead of deferred), `--reset-deferred` documented in hench help, and single-item PATCH via the web API restores startedAt/completedAt timestamping and status validation.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Record every vendor CLI invocation to an append-only `claude_commands.log`.
  
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

- [#334](https://github.com/en-dash-consulting/n-dx/pull/334) [`4206697`](https://github.com/en-dash-consulting/n-dx/commit/42066975f4b7ffcec402df7446d2a0101ff929c6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Security and modernization pass over all dependencies. Resolves all 45 `pnpm audit` findings (2 critical, 16 high) via updated direct dependencies and refreshed pnpm overrides (hono, @hono/node-server, fast-uri, ip-address, js-yaml, nanoid, postcss, qs, vite, ws, body-parser). Modernizes major tooling: TypeScript 6.0, vitest 4.1.10, ink 7, ora 9, jsdom 30, esbuild 0.28, @modelcontextprotocol/sdk 1.30, @anthropic-ai/sdk 0.117, changesets 3. Raises the supported Node.js floor from 18 to 22 (Node 18 and 20 are both end-of-life; CI already runs Node 22).

- [#323](https://github.com/en-dash-consulting/n-dx/pull/323) [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop quoting bare command names in the Windows cmd.exe verbatim command line so PATHEXT resolution still applies. `buildWindowsCliCommandLine` quoted every token including the binary, and a quoted command name makes cmd.exe look for an exact filename match on PATH instead of trying `.CMD`/`.EXE`/… in turn. When a PATH directory holds an extensionless file beside its shim — exactly what pnpm/npm global installs produce (`pnpm` + `pnpm.CMD`, `claude` + `claude.CMD`) — cmd found the extensionless POSIX script, failed `CreateProcess`, and exited 1 with `The system cannot find the path specified.`, making the CLI look absent on Windows. Arguments are still quoted unconditionally and binary paths containing spaces or metacharacters keep their quotes, so the GH [#68](https://github.com/en-dash-consulting/n-dx/issues/68) spaced-path handling is unchanged. Non-Windows platforms are unaffected — they use a plain `spawn` and never build a cmd.exe command line.

- [#299](https://github.com/en-dash-consulting/n-dx/pull/299) [`ab24172`](https://github.com/en-dash-consulting/n-dx/commit/ab241723f3822cca76e801d4628289b3c45b0b84) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Harden CLI spawning on Windows so launching `.cmd` shims (claude, codex, rex) no longer fails. Node can't spawn a `.cmd` directly (post-CVE-2024-27980), and the previous `shell: process.platform === "win32"` workaround triggered the `[DEP0190]` deprecation and broke on paths containing spaces.
  
  - **New `spawnCli` helper** (`@n-dx/llm-client`) routes CLI binaries through `cmd.exe /d /s /c` with `windowsVerbatimArguments` and never uses `shell:true`. Argument quoting follows the Microsoft ArgvQuote / cross-spawn rules (unconditional quoting, backslash-run doubling before quotes, embedded-quote doubling) so paths with spaces and tokens with cmd.exe metacharacters (`& | < > ^ ( )`) are handled. The orchestration tier (`@n-dx/core`) carries an equivalent `win-spawn.js` twin (it cannot import `@n-dx/llm-client`), kept in lockstep by a cross-package parity test.
  - **All CLI-binary spawn sites** are routed through the helper: the claude and codex providers, the hench agent loop and its adapters, the `ndx config` CLI-path validator, `ndx pair-programming`'s reviewer, and sourcevision's `rex` invocations.
  - **Prompts are delivered via stdin** for the codex hench adapter and the pair-programming reviewer (previously passed as an argv token), preventing multi-line prompt truncation and command injection through `cmd.exe`.
  - **`diagnoseCliInvocation`** produces an actionable message when a CLI binary is missing or not invokable — distinguishing a not-found binary, a configured absolute path that doesn't exist, and a binary present on PATH but failing to run — and works from the close/non-zero-exit path on Windows (where a missing `.cmd` never raises `ENOENT`). Detection is anchored to the spawned binary so a legitimate run's own error output isn't misclassified.
  - A **regression guard test** fails CI if any CLI spawn site reintroduces the `shell:true` + args (`DEP0190`) pattern.
  
  No behavior change on macOS or Linux.

## 0.4.6

### Patch Changes

- [#243](https://github.com/en-dash-consulting/n-dx/pull/243) [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99) Thanks [@dnaniel](https://github.com/dnaniel)! - Raise the per-CLI-call timeout default from 120s to 300s. Zone-enrichment and classification prompts ask the model for several KB of JSON (1.5–2.5k output tokens), and Sonnet's time-to-first-token alone can run 30–120s before generation begins. Because `--output-format json` buffers the whole response, a slow-but-legitimate completion looks like `stdout=0B` until it finishes — and a 120s cap killed many of these mid-generation, surfacing as "claude hung past 120s". The new 300s default lets them complete; `NDX_CLAUDE_PER_CALL_TIMEOUT_MS` still overrides it.

- [#267](https://github.com/en-dash-consulting/n-dx/pull/267) [`579d831`](https://github.com/en-dash-consulting/n-dx/commit/579d831018b949938f6ad18a0a637315a2b9b352) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Fix Codex CLI provider on Windows: pass prompt via stdin instead of argv. On Windows, `shell: true` routes through cmd.exe which splits unquoted multi-word arguments on spaces, causing Codex to receive a fragmented prompt. Passing `-` as the prompt argument and writing to `proc.stdin` bypasses cmd.exe argument parsing.

- [#269](https://github.com/en-dash-consulting/n-dx/pull/269) [`545d611`](https://github.com/en-dash-consulting/n-dx/commit/545d611c9a47a372ada5e9b65f2a48d034d37482) Thanks [@en-drza](https://github.com/en-drza)! - Introduced animated carolinaBlue loader and aesthetic DX improvements for long-running status and work commands.

- [#239](https://github.com/en-dash-consulting/n-dx/pull/239) [`b9570fd`](https://github.com/en-dash-consulting/n-dx/commit/b9570fd2d7528c6e315f1a1fc6b3aa33e8537da2) Thanks [@endash-shal](https://github.com/endash-shal)! - Added Google integration

## 0.4.5

### Patch Changes

- [#222](https://github.com/en-dash-consulting/n-dx/pull/222) [`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f) Thanks [@endash-shal](https://github.com/endash-shal)! - reduce code size, improve skills for claude

- [#236](https://github.com/en-dash-consulting/n-dx/pull/236) [`6bdf00b`](https://github.com/en-dash-consulting/n-dx/commit/6bdf00b7af631518bbb829bb89160638b500507b) Thanks [@endash-shal](https://github.com/endash-shal)! - init changes to readmes, and startup messages

## 0.4.4

## 0.4.3

### Patch Changes

- [#229](https://github.com/en-dash-consulting/n-dx/pull/229) [`2a754b2`](https://github.com/en-dash-consulting/n-dx/commit/2a754b21efed8738ce798eb1cc231d34e668efa0) Thanks [@dnaniel](https://github.com/dnaniel)! - Republish via npm Trusted Publishing. 0.4.2 was bumped in source but never
  made it to the registry because the original NPM_TOKEN-based publish in
  the Release run for [#227](https://github.com/en-dash-consulting/n-dx/issues/227) returned E404. Workflow now uses OIDC; this
  changeset moves all six packages to 0.4.3 so they get published with
  provenance attestation.

## 0.4.2

### Patch Changes

- [#216](https://github.com/en-dash-consulting/n-dx/pull/216) [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a) Thanks [@dnaniel](https://github.com/dnaniel)! - Close the child's stdin immediately when calling `exec()`. `execFile`
  pipes stdio by default, but `exec` never writes to the child's stdin —
  leaving it open caused any spawned process that reads stdin (e.g.
  `rex add`'s `readStdin()` in non-TTY mode) to hang forever waiting for
  an EOF that would never arrive. This was the root cause of the
  dashboard Quick Add timing out at 240 s with zero output from a
  daemonized `ndx start`.

- [#216](https://github.com/en-dash-consulting/n-dx/pull/216) [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a) Thanks [@dnaniel](https://github.com/dnaniel)! - Correct the haiku model id. `TIER_MODELS.claude.light` and
  `MODEL_ALIASES.haiku` referenced `claude-haiku-4-20250414`, which doesn't
  exist — the API returns 404, but the Claude CLI provider hangs silently
  on the bad id instead of erroring. That caused dashboard Quick Add (which
  forces the light tier via `--fast`) to time out at 240 s with zero
  output. Updated to the dateless alias `claude-haiku-4-5` (matching the
  existing pattern used for `opus`/`sonnet`); it resolves to the latest
  Haiku 4.5 release without pinning to a snapshot that will eventually be
  deprecated.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Make `sv analyze` (and especially `--full`) substantially faster.

  - **Parallel enrichment batches.** Previously batches inside a single
    enrichment pass ran sequentially because each fed an `enrichedNames` hint
    forward to the next. That hint was advisory (collisions are resolved
    post-hoc), so batches now run via `Promise.allSettled`. On a typical
    7-zone repo this roughly halves Phase 4 wall-clock per pass.
  - **Early-exit `--full` on convergence.** The pass loop now fingerprints
    zone identity + finding/insight counts after each pass and stops as soon
    as a pass produces no observable change. Stable codebases routinely run
    4 passes today where 1–2 do all the real work; the rest were dead weight.
  - **`ZONES_PER_BATCH` 5 → 7.** Lets the typical small-to-medium project run
    in a single batch instead of two.
  - **Tightened file-header excerpts.** Per-file cap 800 → 400 chars,
    per-batch budget 6 KB → 2.5 KB. Headers are still useful as ground-truth
    for "is this documented", but the previous budget inflated the full
    prompt enough to consistently miss the 90 s per-call timeout on slower
    networks.
  - **Per-call timeout configurable + default bumped.** `claude` CLI
    invocations now default to 120 s (was 90 s) and respect
    `NDX_CLAUDE_PER_CALL_TIMEOUT_MS=<ms>` for users on slow networks /
    larger prompts. The 90 s cap was killing many legitimate-but-slow
    full-prompt completions before first byte (claude buffers stdout fully,
    so partial progress is invisible).

## 0.4.1

### Patch Changes

- [#201](https://github.com/en-dash-consulting/n-dx/pull/201) [`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4) Thanks [@endash-shal](https://github.com/endash-shal)! - Adding auto-changing llm models for long runs, self-heal improvements and bug fixes.

## 0.4.0

### Minor Changes

- [#198](https://github.com/en-dash-consulting/n-dx/pull/198) [`4de9d46`](https://github.com/en-dash-consulting/n-dx/commit/4de9d46036963129b0e962e1c9aed7e0b9d87262) Thanks [@endash-shal](https://github.com/endash-shal)! - Address security findings, fix package publishing regression, and refresh documentation.

  **Security** — clears 27 of 30 Dependabot advisories:

  - `@modelcontextprotocol/sdk` ^1.25.3 → ^1.29.0 (rex, sourcevision, web) — fixes cross-client data leak via shared transport reuse (GHSA-345p-7cg4-v4c7) plus transitive `hono`, `@hono/node-server`, `path-to-regexp`, `ajv`, and `qs` advisories.
  - `@anthropic-ai/sdk` ^0.85.0 → ^0.94.0 (hench, llm-client) — fixes insecure default file permissions in the local-filesystem memory tool (GHSA-p7fg-763f-g4gf).
  - `vitest` ^4.0.18 → ^4.1.5 (root) — fixes transitive `vite` and `picomatch` advisories.
  - Adds range-scoped `pnpm.overrides` for `picomatch`, `postcss`, `hono`, `@hono/node-server`, `ajv`, `path-to-regexp`, `qs`, and `vite` to pin patched versions in transitive trees the resolver would otherwise leave on older cached versions.

  Audit drops from 11 high / 21 moderate / 2 low to 1 high / 2 moderate. The remaining advisories (rollup, esbuild, vite reached via `vitepress`) are dev-server-only docs-build vulns deferred to a follow-up.

  **Packaging regression guard** — moves `assistant-assets/` under `packages/core/` so it ships inside the published `@n-dx/core` tarball, and adds two e2e tests to prevent recurrence:

  - `tests/e2e/published-assets-bundled.test.js` — asserts `pnpm pack` includes the assistant-assets payload.
  - `tests/e2e/published-package-loadability.test.js` — installs each packed tarball into a clean fixture and verifies CLIs load.

  **Docs** — README, getting-started, and quickstart updates with screenshots in `documentation/` to walk through `ndx init`, `analyze`, `plan`, `work`, `status`, `start`, `ci`, and `self-heal`.

## 0.3.4

### Patch Changes

- [#197](https://github.com/en-dash-consulting/n-dx/pull/197) [`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307) Thanks [@endash-shal](https://github.com/endash-shal)! - added more documentation changes

## 0.3.3

## 0.3.2

## 0.3.1

## 0.3.0

### Patch Changes

- [#167](https://github.com/en-dash-consulting/n-dx/pull/167) [`9ce5ee5`](https://github.com/en-dash-consulting/n-dx/commit/9ce5ee50f9c2a8f90099f2a0fed17475441d55c7) Thanks [@endash-shal](https://github.com/endash-shal)! - more documentation additions and sourcevision token optimizations

- [#168](https://github.com/en-dash-consulting/n-dx/pull/168) [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f) Thanks [@endash-shal](https://github.com/endash-shal)! - Vendor-aware batch construction and response handling in self-heal

  - **`llm-client`**: Add `VENDOR_CONTEXT_CHAR_LIMITS` — per-vendor safe prompt size constants (claude: 640K chars, codex: 400K chars) derived from each vendor's context window.
  - **`hench/summary.ts`**: Recognise Codex CLI tool names (`shell`, `str_replace_editor`, `create_file`) in `buildRunSummary`. Fixes IC-1: file-change tracking now works for Codex runs.
  - **`hench/cli-loop.ts`**: Bound the brief text to `VENDOR_CONTEXT_CHAR_LIMITS[vendor]` before each dispatch. Uses the vendor/model resolver from `llm-gateway` rather than a Claude-specific constant.
  - **`hench/shared.ts`**: When `toolCalls` is empty in self-heal mode, fall back to `git diff --name-only HEAD` to populate `filesChanged`. Fixes IC-2: the mandatory test gate now runs for Codex (which does not emit structured tool events).

- [#168](https://github.com/en-dash-consulting/n-dx/pull/168) [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more codex fixes, added full codex integration and other smaller fixes

## 0.2.3

### Patch Changes

- [#155](https://github.com/en-dash-consulting/n-dx/pull/155) [`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817) Thanks [@endash-shal](https://github.com/endash-shal)! - model and quality of experience improvements

## 0.2.2

### Patch Changes

- [#138](https://github.com/en-dash-consulting/n-dx/pull/138) [`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba) Thanks [@endash-shal](https://github.com/endash-shal)! - This change optimizes some code, adds timeouts and big fixes for major use cases. No new functionality is added.

## 0.2.1

## 0.2.0

## 0.1.9

### Patch Changes

- [#106](https://github.com/en-dash-consulting/n-dx/pull/106) [`616c799`](https://github.com/en-dash-consulting/n-dx/commit/616c799ef0ef2ed9f96acadb6ba5540270a07a82) Thanks [@ryrykeith](https://github.com/ryrykeith)! - ### SourceVision

  - Go language support: import graph analysis, zone detection, route extraction, archetype classification
  - Multi-language project detection (Go + TypeScript coexistence)
  - Database package detection and Architecture view panel (194 known packages across Go/Node/Python)
  - Handler → Database flow tracing in Architecture view
  - Architecture view layout improvements for long Go module paths

  ### Rex

  - Go module scanner (`go.mod` dependency parsing)
  - Go-aware analysis pipeline integration

  ### Hench

  - Go test runner support
  - Go-specific agent planning prompts
  - Go guard defaults in schema

  ### Web Dashboard

  - Database Layer panel in Architecture view
  - Handler → DB Flows panel with BFS path tracing
  - Bar chart label improvements (wider labels, SVG tooltips, smart truncation)
  - Table cell overflow handling for long package names

  ### LLM Client

  - Schema updates supporting Go language constructs

- [#98](https://github.com/en-dash-consulting/n-dx/pull/98) [`d940a48`](https://github.com/en-dash-consulting/n-dx/commit/d940a48af8ca288642efebf90a5786ee59bf6a88) Thanks [@dnaniel](https://github.com/dnaniel)! - ### Rex

  - Add `withTransaction` API for safe concurrent PRD writes with file locking
  - Add `level` field to `edit_item` MCP tool for changing item hierarchy levels
  - Fix LLM reshape response parsing with action normalization and lenient fallback
  - Fix `--mode=fast` being ignored when `--accept` is passed to `reorganize`
  - Extract shared archive module for prune/reshape/reorganize
  - Add reorganize archiving (removed items preserved in `.rex/archive.json`)
  - Proactive structure: MCP schema coverage audit test

  ### Hench

  - Show auto-selection reasoning in run header (why task was chosen, skipped counts, unblock potential)
  - Show prior attempt history in task card (retry count, last status)
  - Classify changes in run summary (code/test/docs/config/metadata-only)

  ### Web Dashboard

  - Default to showing all PRD items (fixes blank page for 100% complete projects)
  - Remove redundant StatusFilter, wire status chips to tree visibility
  - Smart collapse: tree starts closed when no active work
  - Hide view-header, promote breadcrumb as page title
  - Show sibling page icons in collapsed sidebar rail
  - Move command buttons (Add, Prune) inline into search row
  - Add filtered-empty state messaging

  ### CLI

  - Surface all package commands through `ndx` (validate, fix, health, report, verify, update, remove, move, reshape, reorganize, prune, next, reset, show)
  - Helpful error when running orchestrator commands on package CLIs
  - Workflow-based `ndx --help` grouping (no package names in primary help)
  - Skip provider prompt on re-init when config exists
  - Unified init status report
  - Branded ASCII art CLI header

  ### Docs

  - New 5-minute quickstart tutorial
  - New troubleshooting guide (7 common issues)
  - Commands reference rewritten by workflow stage

  ### Infrastructure

  - `@n-dx/core` included in release workflow (synced version + auto-publish)
  - `/ndx-reshape` skill for PRD hierarchy restructuring
  - `/ndx-capture` skill updated with automatic parent placement and dependency wiring

- [#99](https://github.com/en-dash-consulting/n-dx/pull/99) [`17e486a`](https://github.com/en-dash-consulting/n-dx/commit/17e486a391d85a65e62d231539bff0a2ee212dc8) Thanks [@dnaniel](https://github.com/dnaniel)! - ### Rex

  - Proactive PRD structure health checks with configurable thresholds
  - Post-write health warnings on `rex add` and `rex analyze`
  - Structure health gate in `ndx ci` (fails below score 50)

  ### Web Dashboard

  - Checkbox multi-select: hover reveals checkbox, click row opens detail panel
  - Remove Edit icon from tree rows (detail panel handles editing)
  - Completion timeline view with date range filters (today/week/month/all)

  ### CLI

  - Fix release workflow: use `npx` for changeset commands (pnpm script resolution bug)

## 0.1.8
