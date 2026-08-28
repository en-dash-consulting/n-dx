# @n-dx/hench

## 0.5.1

### Patch Changes

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Assisted skill runs now record what they cost, instead of zero.
  
  `hench record` writes the run entry for work driven through a skill rather than a spawned agent. Those entries carried empty token usage, on the stated grounds that "Claude Code does not expose its own token consumption to the running skill". That holds for the tool surface and not for the filesystem: Claude Code writes a JSONL transcript per session in which every assistant message carries the API's `usage` object, and it exports `CLAUDE_CODE_SESSION_ID` to the tools it runs. So the numbers were readable all along, and `ndx usage` plus the dashboard's per-item rollup were under-reporting every skill-driven task by its entire cost.
  
  Usage is now read from that transcript by default. Two things make the attribution honest rather than merely non-zero:
  
  - **Only the delta.** One session routinely completes several tasks — the session this was built in completed four — so a per-record session total would count the same tokens once per task. A watermark per session lives in `.hench/usage-cursors/`, and each record claims only what accumulated since the last one. It survives transcript compaction by falling back from message uuid to a count, and says when it did.
  - **Only after the work started.** The watermark cannot help the FIRST record in a session, which would otherwise claim everything spent before the task began. Measured against a live session: 549 messages and 127M cache-read tokens for one task. `--startedAt` now doubles as the earliest spend a record may claim, and `/ndx-work` captures it when it marks the task in progress.
  
  Precedence is explicit `--input-tokens`/`--output-tokens`/`--cache-*-tokens` flags, then the transcript, then zeros. A missing or unreadable transcript never fails the record — an unrecorded run is worse than one missing its tokens — and the command reports which happened. `--no-tokens` opts out; `--session` and `--transcript` override discovery.
  
  The `assisted` flag keeps its meaning as provenance (skill vs agent) rather than "no usage", and `turns` is now the transcript's message count, which is a real API-call count.
  
  Skills that mutate state — `/ndx-work`, `/ndx-capture`, `/ndx-plan`, `/ndx-reshape`, `/ndx-config` — record their runs as a documented step. Planning-style skills record against `skill:<name>`, which `get_token_usage` reports in its existing `orphans` bucket: work that produced many items should not be charged to one of them.
  
  Also fixes a test-isolation hazard this created. `CLAUDE_CODE_SESSION_ID` is exported to `pnpm test` as well, so the suite began reading the ambient live transcript and asserting against numbers that change between runs — green in CI, unreproducible locally. `tests/setup-session-env.js` clears it in every worker, the same shape as the existing `setup-color-env.js` and for the same reason.

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the tests' `sh`-on-PATH dependency explicit instead of failing opaquely.
  
  `sh` is absent from a stock Windows PATH — it ships with Git for Windows, which Git Bash exposes and PowerShell/cmd.exe do not. Tests that spawn `sh -c` therefore passed from Git Bash and failed from PowerShell on the same commit, and no failure message mentioned a shell: the orphan test reported `expected false to be true` after burning a 5s wait, because the grandchild that never started also never wrote its pid. Two of these were investigated as suspected regressions during a merge before the shell was identified as the variable.
  
  The audit found more than the two files that prompted it: **28 shell-dependent cases across 5 files**, of which 21 were failing and **5 were passing vacuously** — a case asserting "nothing was written after the timeout" is trivially satisfied when nothing ever ran, and hench's `reports exit code on failure without output` is satisfied by a spawn that failed to launch. Those were green on machines where the behaviour was never exercised, which is the worse half of this bug.
  
  Each site now skips with `sh` named, via one helper per suite boundary, all delegating to the production `isExecutableOnPath` probe. The `sh` indirection itself is preserved, not removed: libuv puts every non-detached child it spawns on Windows into a global job object, so spawning `node` directly would reap the tree for free and make the tests vacuous — which is how an earlier version of the orphan test managed to prove nothing.
  
  For hench the skip says more, because there `sh` is not scaffolding: `run_command` and the post-task test runner spawn `sh -c` on *every* platform, so a machine without `sh` cannot run those tools at all. The skip records which product capability went unverified rather than implying a test artifact.
  
  Also: shell spawns in tests no longer discard their own failure. `stdio: "ignore"` is about the child's output, and with the spawn error thrown away an unresolvable shell looked identical to a surviving orphan. Full inventory and the rules for adding a new shell-spawning test are in `tests/shell-spawn-inventory.md`.

- [#341](https://github.com/en-dash-consulting/n-dx/pull/341) [`2bb6a4c`](https://github.com/en-dash-consulting/n-dx/commit/2bb6a4c240e61aa34bf0d240e7ffc26c7e5a4dab) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Route mechanical single-shot LLM calls to the light model tier. In rex, `spawnClaude()` gains an optional task-weight parameter (default `"standard"`), and sibling renames, group renames, body merges, the consolidation guard, the granularity assessment pass, guided clarify rounds, and the post-prune consolidation pass now resolve the vendor's light-tier model (e.g. haiku) when no explicit model is given. In hench, pre-run commit-message generation resolves the light tier instead of the run's standard model. An explicit `--model` flag (or a per-vendor `lightModel` config for the light tier) still overrides tier resolution, and the active tier is surfaced in vendor-header/spinner output ("light tier").

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

- [#343](https://github.com/en-dash-consulting/n-dx/pull/343) [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558) Thanks [@endash-shal](https://github.com/endash-shal)! - `hench record --no-tokens` now burns the suppressed spend instead of deferring it to the next record.
  
  The `--no-tokens` branch returned before the transcript was read, so the session watermark never advanced: in one session, `record --task=A --no-tokens` followed by a normal `record --task=B` silently rolled A's entire spend into B's record and B's PRD-item rollup. The flag's plain reading — and the existing precedent of the explicit `--*-tokens` path, which advances the watermark because "that spend is now accounted for" — is that suppressed spend is attributed to nothing.
  
  Now the transcript is still read under `--no-tokens` and the watermark advances past the suppressed messages; the record keeps its zeros and its note says how many messages were discarded. A transcript problem never fails a `--no-tokens` record (the caller asked for no usage at all), and `hench record --help` states the discard semantics.

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - A run file that cannot be read is no longer treated as a run file that changed.
  
  Both change detectors trust mtime only once it is older than the filesystem's timestamp granularity, and inside that window compare a hash of the bytes instead. `hashFile` returns null when the read fails, and both docblocks promised the caller treats that as "no usable hash" rather than as a change. Neither caller did: the comparison guarded the *previous* hash against null but not the new one, so a previously-hashed file whose read now failed compared `"abc" !== null` and was reported modified.
  
  In the web aggregator that was the expensive direction to get wrong. "Modified" means subtract-then-re-read, and when the re-read failed too the contribution was dropped outright — so a momentarily unreadable run file silently lost its tokens from the per-task aggregate until something else touched it. Absence of evidence became a deletion. The hench detector only reports the change without mutating an accumulator, so the cost there was a spurious change flag.
  
  Both now require *both* hashes to be usable before a difference counts. mtime and size already agree at that point, so nothing suggests a rewrite — only that this scan could not check, which is not the same thing. Each side gained a test that injects the read failure (reproducing it from the filesystem is platform-specific; the branch is not) and asserts the file's tokens survive it, with a precondition check so it cannot pass vacuously when no hash was being carried.
  
  Fixed in both copies together, as the twins' shared rule requires. Note for anyone tracing this: there is no parity test between these two detectors and there was never meant to be — `incremental-task-usage.ts` explains why they are deliberately unshared and unpaired, unlike the `quoteWindowsToken` twins.

- [#343](https://github.com/en-dash-consulting/n-dx/pull/343) [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558) Thanks [@endash-shal](https://github.com/endash-shal)! - `hench record` no longer silently claims a whole session when its usage window is missing or malformed.
  
  `--startedAt` doubles as the usage window: the earliest spend a record may claim. Two paths quietly widened that window to the entire transcript. An unparseable value — `--startedAt=25/08/2026`, the shape a locale-formatted `Get-Date` produces — was accepted and discarded, taking the same branch as no window at all. And omitting the flag on a session's first record (the CLI help's own first example) claimed every usage-bearing message the session had, with the total reported as plain fact; measured while building the feature, that was 549 messages and 127M cache-read tokens attributed to one PRD item.
  
  Now an unparseable `--startedAt`/`--since` is a hard error naming the flag — the precedent `--turns=abc` already set — instead of an accepted no-op. A genuinely windowless first record still writes (recording a whole session is legitimate when the whole session was the task), but warns first, naming the message count it is about to claim and pointing at `--startedAt`. `hench record --help` states both behaviors, and its first example now passes `--startedAt`.
  
  The one behavior change to scripts: a sloppy timestamp that used to be ignored now fails the command. That is the point — the silent path put wrong numbers in `get_token_usage` and `ndx usage` with nothing marking them suspicious.

- [#335](https://github.com/en-dash-consulting/n-dx/pull/335) [`1f6f17c`](https://github.com/en-dash-consulting/n-dx/commit/1f6f17c32b0ae387ab0e927688ce71ad6859fb3b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Stamp `actor` (git `user.name`/`user.email` → OS username → `"unknown"`) and `host` (`os.hostname()`) on every `RunRecord` at run start, for both agent-loop runs and assisted `hench record` runs. Both fields are additive on the v1 schema — existing run files without them still parse. `hench show`/`status` and the run-complete summary surface the actor.

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

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Review follow-ups on session usage recording and the adversarial-review skill.
  
  - **The usage watermark can no longer rewind.** When the newest scanned transcript entry carried no `uuid`, the cursor kept the previous `lastUuid` while `consumed` advanced past it — and `lastUuid` wins on the next read, so everything between the two was claimed twice. The uuid watermark is now dropped when the tail has none, so the count governs and nothing is re-claimed. Latent rather than live (real transcripts stamp a uuid on every usage-bearing entry), but `uuid` is typed optional and the input is untrusted JSON parsed line-by-line, and the failure mode was silent inflation of exactly the number this module exists to make trustworthy.
  - **`CLAUDE_CONFIG_DIR` is honoured when locating the transcript.** `resolveTranscriptPath` accepted a `configDir` option but nothing outside its own test passed one, so a user who relocated their Claude config tree silently recorded zero tokens. The environment variable is now consulted between the explicit option and the `~/.claude` default.
  - **Transcript discovery probes with `stat` instead of a full read.** The existence probe read the whole file and threw the bytes away; the caller then read it again — twice the I/O on transcripts that reach tens of MB.
  - **`ndx-adversarial-review` stages only what it wrote.** Its commit step inherited the house `git add -A`, but this skill's diff mode takes the dirty working tree as its review subject, so unscoped staging swept the user's in-progress work into a commit attributed to the review. It now runs `git add .rex/prd_tree/` and scopes its porcelain check the same way; the other committing skills, which never take a dirty tree as input, keep `git add -A`.
- Updated dependencies [[`1f6f17c`](https://github.com/en-dash-consulting/n-dx/commit/1f6f17c32b0ae387ab0e927688ce71ad6859fb3b), [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12), [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`2bb6a4c`](https://github.com/en-dash-consulting/n-dx/commit/2bb6a4c240e61aa34bf0d240e7ffc26c7e5a4dab), [`a7b3227`](https://github.com/en-dash-consulting/n-dx/commit/a7b3227e42f778bedb0e19343cf42443f545c167), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`1f6f17c`](https://github.com/en-dash-consulting/n-dx/commit/1f6f17c32b0ae387ab0e927688ce71ad6859fb3b), [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`cfdd3b5`](https://github.com/en-dash-consulting/n-dx/commit/cfdd3b5d3f53ad7e6a032fa855ba66a359818be9)]:
  - @n-dx/rex@0.5.1
  - @n-dx/llm-client@0.5.1

## 0.5.0

### Patch Changes

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

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Agent prompts and task briefs now reference the project's resolved CLI command name (cli.name from .n-dx.json, default "n-dx") instead of hardcoding it — system prompt Project Info names the CLI, the brief's Project section carries it, and task-selection error suggestions use it.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Deliver the Codex agent prompt via stdin instead of as a positional argv argument. The Codex CLI adapter previously passed the entire `SYSTEM:`/`TASK:` prompt (bounded at 400 KB) as the last `codex exec` argument, which exceeds the OS `ARG_MAX` for a single argv element and crashed real task briefs with `E2BIG` — a primary reason Codex runs were unusable. The adapter now appends `-` and writes the prompt to stdin, matching the Claude adapter and the `@n-dx/llm-client` Codex provider.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Make Codex quota/token reporting behave sanely under `codex login` (session auth). The quota path required `OPENAI_API_KEY` and matched usage by exact model id, which broke the primary Codex auth flow — session auth never sets an API key (the CLI provider even deletes it), so quota was silently skipped and token retrieval returned not-found for real accounts.
  
  - **Session-auth quota notice:** when Codex is the active vendor and no API key is present, `checkQuotaRemaining` now surfaces a clear `quota unavailable — codex login (session auth) — set OPENAI_API_KEY or llm.codex.api_key for quota` entry instead of silently emitting nothing. `QuotaRemaining` gains an optional `notice` field rendered by `formatQuotaLog`.
  - **Dated deployment ids:** Codex token retrieval now matches the OpenAI usage `model` field tolerantly (`modelMatches`/`stripModelDateSuffix`), so dated deployment ids such as `gpt-5-codex-2025-03-01` resolve to the configured base id `gpt-5-codex`. Matching uses equality after date-stripping, so prefix-sharing models (`gpt-4o` vs `gpt-4o-mini`) never collide.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Wire Codex text-format token accounting into the event-pipeline close path. When `config.useEventPipeline` was enabled, the two non-JSON `catch` blocks in `spawnWithAdapter`'s close handler were empty, unlike the legacy path which falls back to `parseCodexCliTokenUsage`. Because `codex --json` emits JSONL, `JSON.parse(fullStdout)` always throws, so enabling the event pipeline silently zeroed Codex token/credit accounting. Both catch blocks now recover token usage from the text-format summary line and push a `token_usage` event into the accumulator.

- [#316](https://github.com/en-dash-consulting/n-dx/pull/316) [`c5fdbed`](https://github.com/en-dash-consulting/n-dx/commit/c5fdbed684ee91e1b6ceeb77b64bbb3f12b98600) Thanks [@stevemikedan](https://github.com/stevemikedan)! - fix(hench): commit task-completion metadata on the autoCommit path, and stop dropping `fullTestCommand` from config ([#302](https://github.com/en-dash-consulting/n-dx/issues/302))
  
  On the `autoCommit` path the agent commits its own code mid-run and `performCommitPromptIfNeeded` is a no-op, so the completion/resolution metadata written to `.rex/prd_tree` by `updateCompletedTaskStatus` was never committed — it orphaned in the working tree and tripped the next run's pre-run commit gate. `finalizeRun` now calls a focused `commitCompletionMetadata` helper (autoCommit + completed only) that stages `.rex/prd_tree` and commits it in a small dedicated second commit, leaving a clean tree. The non-autoCommit path is unchanged (it already stages PRD files alongside the code), guarded by a staged-diff check so no spurious second commit is created.
  
  Separately, `HenchConfigSchema` was missing `fullTestCommand`, so Zod stripped the key on parse and `loadConfig` returned it as `undefined` — the full-suite test gate always fell back to auto-detect even when `.hench/config.json` set the command. The field is now declared in the schema.

- [#279](https://github.com/en-dash-consulting/n-dx/pull/279) [`18b36f7`](https://github.com/en-dash-consulting/n-dx/commit/18b36f73c0b18bdf508b956e3fb42e5bbf5aeabd) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a pre-run commit gate to `hench run` / `ndx work`. Once per invocation (before the work loop begins, not per iteration), if the working tree has pre-existing uncommitted changes and the session is interactive, hench shows the diff stat plus an LLM-proposed commit message and prompts to **commit** (stage + commit with the standard N-DX trailers, then proceed), **stop** (abort before running), or **proceed** (start with changes left uncommitted). This keeps a user's in-progress edits from being folded into hench's own commits.
  
  Autonomous runs (`--auto`/`--loop`/`--epic-by-epic`) can't prompt without stalling an unattended loop, so a dirty working tree makes them **abort by default** rather than silently absorb the pre-existing changes. Pass the new `--allow-dirty` flag to start an autonomous run against a dirty tree anyway. Clean trees, `--yes` runs, and other non-interactive sessions proceed without prompting as before.

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the hench pre-run commit gate size-aware with configurable thresholds.
  
  The gate now measures change magnitude (dirty file count plus lines changed vs HEAD via `git diff --numstat`, shared helper `measureChangeMagnitude`) instead of reacting only to a non-empty dirty list. Two new persisted settings under `hench.git.*` (`.hench/config.json`, editable via `ndx config`):
  
  - **`hench.git.checkpointThreshold`** (default: 200, 0 disables) — at/above this many changed lines, the interactive prompt warns about the change size and defaults to committing a checkpoint instead of proceeding. Below the threshold, behavior is unchanged.
  - **`hench.git.requireCleanTree`** (default: false) — refuse to start against a dirty tree: the interactive prompt drops the "proceed" option and non-interactive runs (`--yes`, piped) abort.
  
  Autonomous runs (`--auto`/`--loop`/`--epic-by-epic`) keep today's behavior — abort on any dirty tree unless `--allow-dirty` — but the refusal now reports the measured magnitude. `--allow-dirty` takes precedence over both config settings for a single run (flag > config > defaults). Documented in `hench run --help` and `ndx config --help`.

- [#316](https://github.com/en-dash-consulting/n-dx/pull/316) [`c5fdbed`](https://github.com/en-dash-consulting/n-dx/commit/c5fdbed684ee91e1b6ceeb77b64bbb3f12b98600) Thanks [@stevemikedan](https://github.com/stevemikedan)! - fix(hench): make parent auto-completion self-healing so cascades are no longer silently lost ([#293](https://github.com/en-dash-consulting/n-dx/issues/293))
  
  During `hench run --auto --loop`, a child task could be persisted as `completed` while the parent auto-completion cascade was silently dropped — leaving parent features stuck `pending` with every child done, and no reconciliation path to recover. The cause: in `toolRexUpdateStatus` the `status_updated` log append and the cascade shared the caller's single best-effort `try/catch`, so a log-append failure after the child's status write cancelled the cascade; and the cascade was event-driven (`findAutoCompletions` walks only the triggering item's ancestor chain), so a missed cascade was never retried.
  
  Two changes:
  
  - **rex:** add `reconcileAutoCompletions(items)` — a whole-tree, bottom-up sweep that completes every parent whose children are all terminal (`completed`/`deferred`), independent of any single trigger item. It self-heals parents whose earlier cascade was lost. Exported from `public.ts`.
  - **hench:** in `toolRexUpdateStatus`, wrap the `status_updated` append in its own try/catch so a log failure can no longer cancel the cascade, and drive the cascade with `reconcileAutoCompletions` (via `rex-gateway`) for whole-tree healing. Cascade failures in `updateCompletedTaskStatus` and the finalize path are now recorded in `run.diagnostics.notes` instead of a console-only warning.

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the `rollbackOnFailure` revert **prompt-only** — a failed run never discards work without an express, per-run confirmation. On an interactive TTY, a failed run prompts `Revert N uncommitted file(s)? [y/N]` (defaults to **No**); only an explicit yes reverts — and even then the revert stays scoped ([#303](https://github.com/en-dash-consulting/n-dx/issues/303)): tracked changes are reverted via `git reset`/`checkout`, but untracked removal is limited to files the agent created this run (diffed against the pre-run baseline); pre-existing untracked work is never deleted. Declining preserves the working tree.
  
  Non-interactive runs — autonomous (`--auto`/`--loop`/`--epic-by-epic`), `--yes`, and non-TTY/CI — have no channel for a per-run confirmation, so they **never** revert on failure: the working tree is left exactly as-is and the uncommitted files are reported. This replaces the previous unattended auto-revert. `--no-rollback` / `hench.rollbackOnFailure: false` still suppresses the prompt entirely. PRD status reset on failure is unchanged.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop `RunChangeDetector` from missing a same-length run-file rewrite.
  
  It decided whether a run file had changed by comparing mtime + size, which misses a whole class of edit on Windows: file timestamps advance in ticks, so a rewrite of the same LENGTH inside one tick leaves both values identical. Measured on NTFS — 163 of 200 back-to-back same-size rewrites produced a byte-identical `mtimeMs`, with gaps between consecutive distinct mtimes running up to 10ms. An equal-length edit to a run record (a taskId or status swap) therefore kept its stale contribution until some later change forced a re-read. ext4 records nanoseconds, which is why Linux never showed it.
  
  mtime is now trusted only once it is older than a granularity bound. Inside that window the snapshot also carries a hash of the file's bytes and detection compares that; the hash is dropped as soon as the mtime ages out, so the steady state stays stat-only. The two new checkpoint fields are optional, so a checkpoint written by an earlier version still loads — its mtime is old by definition, so the absence of a hash correctly means "trustworthy".
  
  This is the same defect fixed in web's `IncrementalTaskUsageAggregator`. The two implementations are deliberately kept as documented twins rather than sharing a helper: no module both packages can import is an appropriate home for a filesystem utility, and — unlike the `quoteWindowsToken` twin — these two never need to agree with each other, so there is nothing for a parity test to assert. Each side carries its own `utimes`-pinned test for the hazard instead.

- [#316](https://github.com/en-dash-consulting/n-dx/pull/316) [`c5fdbed`](https://github.com/en-dash-consulting/n-dx/commit/c5fdbed684ee91e1b6ceeb77b64bbb3f12b98600) Thanks [@stevemikedan](https://github.com/stevemikedan)! - fix(hench): scope failure rollback to agent-created files and honor `--no-rollback` on review rejection ([#303](https://github.com/en-dash-consulting/n-dx/issues/303))
  
  Rollback on run failure previously ran a blanket `git clean -fd`, deleting **every** untracked file in the working tree — including the user's pre-existing scratch, `.env`, and other hidden files that git had never tracked and could not recover. It also reverted unconditionally when a reviewer rejected changes, ignoring the `--no-rollback` flag entirely.
  
  `revertChanges` now captures a baseline of untracked files before the agent runs (`captureBaselineUntracked`, mirroring `captureStartingHead`) and removes **only** the untracked files the agent created during that run, via a scoped `git clean -fd -- <paths>`. Pre-existing untracked files are never touched. When no baseline is available it deletes nothing (safe fallback). Tracked-file changes are still reverted via `git reset` + `git checkout` (recoverable from history). The review-rejection path now honors `rollbackOnFailure`/`--no-rollback` and reuses the same interactive confirmation prompt as the failure path. The baseline is threaded through both the API/Gemini (`loop.ts`) and CLI (`cli-loop.ts`) run loops.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Reconcile Codex model identifiers across the config surface. Removed the dead `gpt-5.4mini` legacy alias from `LEGACY_CODEX_MODEL_ALIASES` (its target `gpt-5.4-mini` is already a direct catalog model and the non-hyphen key was never a shipped ID). The remaining legacy brand IDs (`gpt-5-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`) now match the orchestration-tier list in `init-llm.js`, with cross-reference comments pinning the two tiers together. Updated the hench vendor-compatibility error hint from the outdated `gpt-4o, o1` to current Codex models (`gpt-5.5, gpt-5.4-mini`).

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Self-heal and n-dx workflow visibility in the dashboard. The dashboard can now run and observe the full n-dx flow: self-heal with live iteration/phase progress and a stop control, full sourcevision analysis with async progress, rex fix/reshape/CI actions with dry-run previews, a Commands reference with inline run triggers, and views for the previously UI-less requirements, adaptive-optimization, and activity-log APIs. Command references throughout the dashboard and hench prompts resolve from the project's detected CLI name.

- [#330](https://github.com/en-dash-consulting/n-dx/pull/330) [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056) Thanks [@endash-shal](https://github.com/endash-shal)! - Local-loop tasks reset to pending on infra failures (retryable instead of deferred), `--reset-deferred` documented in hench help, and single-item PATCH via the web API restores startedAt/completedAt timestamping and status validation.

- [#334](https://github.com/en-dash-consulting/n-dx/pull/334) [`4206697`](https://github.com/en-dash-consulting/n-dx/commit/42066975f4b7ffcec402df7446d2a0101ff929c6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Security and modernization pass over all dependencies. Resolves all 45 `pnpm audit` findings (2 critical, 16 high) via updated direct dependencies and refreshed pnpm overrides (hono, @hono/node-server, fast-uri, ip-address, js-yaml, nanoid, postcss, qs, vite, ws, body-parser). Modernizes major tooling: TypeScript 6.0, vitest 4.1.10, ink 7, ora 9, jsdom 30, esbuild 0.28, @modelcontextprotocol/sdk 1.30, @anthropic-ai/sdk 0.117, changesets 3. Raises the supported Node.js floor from 18 to 22 (Node 18 and 20 are both end-of-life; CI already runs Node 22).

- [#299](https://github.com/en-dash-consulting/n-dx/pull/299) [`ab24172`](https://github.com/en-dash-consulting/n-dx/commit/ab241723f3822cca76e801d4628289b3c45b0b84) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Harden CLI spawning on Windows so launching `.cmd` shims (claude, codex, rex) no longer fails. Node can't spawn a `.cmd` directly (post-CVE-2024-27980), and the previous `shell: process.platform === "win32"` workaround triggered the `[DEP0190]` deprecation and broke on paths containing spaces.
  
  - **New `spawnCli` helper** (`@n-dx/llm-client`) routes CLI binaries through `cmd.exe /d /s /c` with `windowsVerbatimArguments` and never uses `shell:true`. Argument quoting follows the Microsoft ArgvQuote / cross-spawn rules (unconditional quoting, backslash-run doubling before quotes, embedded-quote doubling) so paths with spaces and tokens with cmd.exe metacharacters (`& | < > ^ ( )`) are handled. The orchestration tier (`@n-dx/core`) carries an equivalent `win-spawn.js` twin (it cannot import `@n-dx/llm-client`), kept in lockstep by a cross-package parity test.
  - **All CLI-binary spawn sites** are routed through the helper: the claude and codex providers, the hench agent loop and its adapters, the `ndx config` CLI-path validator, `ndx pair-programming`'s reviewer, and sourcevision's `rex` invocations.
  - **Prompts are delivered via stdin** for the codex hench adapter and the pair-programming reviewer (previously passed as an argv token), preventing multi-line prompt truncation and command injection through `cmd.exe`.
  - **`diagnoseCliInvocation`** produces an actionable message when a CLI binary is missing or not invokable — distinguishing a not-found binary, a configured absolute path that doesn't exist, and a binary present on PATH but failing to run — and works from the close/non-zero-exit path on Windows (where a missing `.cmd` never raises `ENOENT`). Detection is anchored to the spawned binary so a legitimate run's own error output isn't misclassified.
  - A **regression guard test** fails CI if any CLI spawn site reintroduces the `shell:true` + args (`DEP0190`) pattern.
  
  No behavior change on macOS or Linux.
- Updated dependencies [[`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`c5fdbed`](https://github.com/en-dash-consulting/n-dx/commit/c5fdbed684ee91e1b6ceeb77b64bbb3f12b98600), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`18b36f7`](https://github.com/en-dash-consulting/n-dx/commit/18b36f73c0b18bdf508b956e3fb42e5bbf5aeabd), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056), [`ea75b8d`](https://github.com/en-dash-consulting/n-dx/commit/ea75b8d45ea03d20a1844855a97b19c80f31a328), [`21283a2`](https://github.com/en-dash-consulting/n-dx/commit/21283a22fcd2b68d5f016fe923e49908c141ebf0), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`4206697`](https://github.com/en-dash-consulting/n-dx/commit/42066975f4b7ffcec402df7446d2a0101ff929c6), [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d), [`ab24172`](https://github.com/en-dash-consulting/n-dx/commit/ab241723f3822cca76e801d4628289b3c45b0b84), [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d)]:
  - @n-dx/llm-client@0.5.0
  - @n-dx/rex@0.5.0

## 0.4.6

### Patch Changes

- [#243](https://github.com/en-dash-consulting/n-dx/pull/243) [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99) Thanks [@dnaniel](https://github.com/dnaniel)! - Record `/ndx-work` task execution in hench run history ([#271](https://github.com/en-dash-consulting/n-dx/issues/271)). The `/ndx-work` skill drove tasks through Claude Code without spawning hench, so the work left no `.hench/runs/` entry and was invisible to run history and `ndx usage`. A new `hench record` command writes a lightweight run record (task id, title, status, summary, timestamps, model) marked `assisted`, and the skill now calls it as a final step. Because Claude Code does not expose its own token consumption to a running skill, assisted records carry empty token usage and an `assisted` flag so analytics can distinguish them from genuine hench runs rather than reading them as anomalies; the skill also surfaces this caveat to the user.

- [#269](https://github.com/en-dash-consulting/n-dx/pull/269) [`545d611`](https://github.com/en-dash-consulting/n-dx/commit/545d611c9a47a372ada5e9b65f2a48d034d37482) Thanks [@en-drza](https://github.com/en-drza)! - Introduced animated carolinaBlue loader and aesthetic DX improvements for long-running status and work commands.

- [#239](https://github.com/en-dash-consulting/n-dx/pull/239) [`b9570fd`](https://github.com/en-dash-consulting/n-dx/commit/b9570fd2d7528c6e315f1a1fc6b3aa33e8537da2) Thanks [@endash-shal](https://github.com/endash-shal)! - Added Google integration

- Updated dependencies [[`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`579d831`](https://github.com/en-dash-consulting/n-dx/commit/579d831018b949938f6ad18a0a637315a2b9b352), [`be3b1d9`](https://github.com/en-dash-consulting/n-dx/commit/be3b1d98f70e6df6b031ed023fb7f8f5a96dba6a), [`545d611`](https://github.com/en-dash-consulting/n-dx/commit/545d611c9a47a372ada5e9b65f2a48d034d37482), [`b9570fd`](https://github.com/en-dash-consulting/n-dx/commit/b9570fd2d7528c6e315f1a1fc6b3aa33e8537da2)]:
  - @n-dx/llm-client@0.4.6
  - @n-dx/rex@0.4.6

## 0.4.5

### Patch Changes

- [#222](https://github.com/en-dash-consulting/n-dx/pull/222) [`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f) Thanks [@endash-shal](https://github.com/endash-shal)! - reduce code size, improve skills for claude

- Updated dependencies [[`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f), [`6bdf00b`](https://github.com/en-dash-consulting/n-dx/commit/6bdf00b7af631518bbb829bb89160638b500507b)]:
  - @n-dx/llm-client@0.4.5
  - @n-dx/rex@0.4.5

## 0.4.4

### Patch Changes

- Updated dependencies []:
  - @n-dx/rex@0.4.4
  - @n-dx/llm-client@0.4.4

## 0.4.3

### Patch Changes

- [#229](https://github.com/en-dash-consulting/n-dx/pull/229) [`2a754b2`](https://github.com/en-dash-consulting/n-dx/commit/2a754b21efed8738ce798eb1cc231d34e668efa0) Thanks [@dnaniel](https://github.com/dnaniel)! - Republish via npm Trusted Publishing. 0.4.2 was bumped in source but never
  made it to the registry because the original NPM_TOKEN-based publish in
  the Release run for [#227](https://github.com/en-dash-consulting/n-dx/issues/227) returned E404. Workflow now uses OIDC; this
  changeset moves all six packages to 0.4.3 so they get published with
  provenance attestation.
- Updated dependencies [[`2a754b2`](https://github.com/en-dash-consulting/n-dx/commit/2a754b21efed8738ce798eb1cc231d34e668efa0)]:
  - @n-dx/llm-client@0.4.3
  - @n-dx/rex@0.4.3

## 0.4.2

### Patch Changes

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Stop assuming every project is JS/TS during `hench init`.

  - Detect Swift projects (`Package.swift`, `*.xcodeproj`, `*.xcworkspace`) and
    apply a Swift guard profile: `allowedCommands: ["swift", "make",
"xcodebuild", "xcrun", "git"]`, Swift-aware blocked paths
    (`.build/`, `DerivedData/`, `Pods/`, `Carthage/`), and longer timeouts to
    fit Xcode build times. Adds `"swift"` to `ProjectLanguage`.
  - `autoDetectTestCommand` now prefers a Makefile `validate` target over the
    raw language toolchain — a strong "project author wrapped the full gate
    here" signal — and falls back to per-language defaults for Swift (`swift
test`), Cargo (`cargo test`), Go (`go test ./...`), and Python (`pytest`)
    before giving up.

  Net effect: on a Swift codebase with a `make validate` gate, `ndx init`
  yields a usable `.hench/config.json` with the right toolchain allowed AND
  the resolver picks up `make validate` automatically — no manual
  `hench.fullTestCommand` override needed.

- [#206](https://github.com/en-dash-consulting/n-dx/pull/206) [`d278f05`](https://github.com/en-dash-consulting/n-dx/commit/d278f0506c94ae8bce068f770caa450e07a3330e) Thanks [@endash-shal](https://github.com/endash-shal)! - Rework the PRD context graph, harden the hench run loop, and add LLM auto-failover.

  **PRD context graph (web)** — Top-down progressive-disclosure layout with folder-tree
  visual style; shape-based nodes for epic/feature/task/subtask; click-through opens the
  Rex task detail panel with subtree highlighting. Hierarchy is now driven from
  `.rex/prd_tree/` paths.

  **Hench run loop** — Per-task attempt tracking, completed tasks excluded from
  selection, and the loop advances immediately on success. The `no-plan-mode` rule is
  embedded in the agent system prompt; autonomous runs (`--auto` / `--loop` /
  `--epic-by-epic`) default to `acceptEdits`. New
  `docs/contributing/run-loop-invariants.md`.

  **LLM auto-failover** — New `llm.autoFailover` flag with vendor-specific failover
  chains; `hench run` restores the original config after a failover attempt. Model
  resolution honours top-level `llm.model` → `llm.{vendor}.model` → tier default.

  **Rex storage** — PRD tree rewritten to canonical `index.md`-per-folder layout with
  single-child compaction and atomic leaf-to-folder promotion for subtasks. Timestamped
  snapshots before structural migrations; cross-PRD duplicate detection in `reshape`.

  **CLI / DX** — New `ndx tree` command and tree-formatted `rex status`; `ndx self-heal`
  gains a pre-execution approval gate with `selfHeal.autoConfirm`. Obfuscated-code commit
  blocker added.

- Updated dependencies [[`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`d278f05`](https://github.com/en-dash-consulting/n-dx/commit/d278f0506c94ae8bce068f770caa450e07a3330e), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8)]:
  - @n-dx/llm-client@0.4.2
  - @n-dx/rex@0.4.2

## 0.4.1

### Patch Changes

- [#201](https://github.com/en-dash-consulting/n-dx/pull/201) [`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4) Thanks [@endash-shal](https://github.com/endash-shal)! - Adding auto-changing llm models for long runs, self-heal improvements and bug fixes.

- Updated dependencies [[`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4)]:
  - @n-dx/llm-client@0.4.1
  - @n-dx/rex@0.4.1

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

### Patch Changes

- Updated dependencies [[`4de9d46`](https://github.com/en-dash-consulting/n-dx/commit/4de9d46036963129b0e962e1c9aed7e0b9d87262)]:
  - @n-dx/llm-client@0.4.0
  - @n-dx/rex@0.4.0

## 0.3.4

### Patch Changes

- [#197](https://github.com/en-dash-consulting/n-dx/pull/197) [`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307) Thanks [@endash-shal](https://github.com/endash-shal)! - added more documentation changes

- Updated dependencies [[`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307)]:
  - @n-dx/llm-client@0.3.4
  - @n-dx/rex@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies []:
  - @n-dx/rex@0.3.3
  - @n-dx/llm-client@0.3.3

## 0.3.2

### Patch Changes

- [#186](https://github.com/en-dash-consulting/n-dx/pull/186) [`015b06a`](https://github.com/en-dash-consulting/n-dx/commit/015b06ad9fde134cee0f9a45e4fb310fa7a5fddd) Thanks [@endash-shal](https://github.com/endash-shal)! - new PRD structure and smaller fixes

- Updated dependencies [[`015b06a`](https://github.com/en-dash-consulting/n-dx/commit/015b06ad9fde134cee0f9a45e4fb310fa7a5fddd)]:
  - @n-dx/rex@0.3.2
  - @n-dx/llm-client@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @n-dx/rex@0.3.1
  - @n-dx/llm-client@0.3.1

## 0.3.0

### Patch Changes

- [#167](https://github.com/en-dash-consulting/n-dx/pull/167) [`9ce5ee5`](https://github.com/en-dash-consulting/n-dx/commit/9ce5ee50f9c2a8f90099f2a0fed17475441d55c7) Thanks [@endash-shal](https://github.com/endash-shal)! - more documentation additions and sourcevision token optimizations

- [#168](https://github.com/en-dash-consulting/n-dx/pull/168) [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f) Thanks [@endash-shal](https://github.com/endash-shal)! - Vendor-aware batch construction and response handling in self-heal

  - **`llm-client`**: Add `VENDOR_CONTEXT_CHAR_LIMITS` — per-vendor safe prompt size constants (claude: 640K chars, codex: 400K chars) derived from each vendor's context window.
  - **`hench/summary.ts`**: Recognise Codex CLI tool names (`shell`, `str_replace_editor`, `create_file`) in `buildRunSummary`. Fixes IC-1: file-change tracking now works for Codex runs.
  - **`hench/cli-loop.ts`**: Bound the brief text to `VENDOR_CONTEXT_CHAR_LIMITS[vendor]` before each dispatch. Uses the vendor/model resolver from `llm-gateway` rather than a Claude-specific constant.
  - **`hench/shared.ts`**: When `toolCalls` is empty in self-heal mode, fall back to `git diff --name-only HEAD` to populate `filesChanged`. Fixes IC-2: the mandatory test gate now runs for Codex (which does not emit structured tool events).

- [#165](https://github.com/en-dash-consulting/n-dx/pull/165) [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more documentation, small fixes and increased base timeout

- [#168](https://github.com/en-dash-consulting/n-dx/pull/168) [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more codex fixes, added full codex integration and other smaller fixes

- Updated dependencies [[`9ce5ee5`](https://github.com/en-dash-consulting/n-dx/commit/9ce5ee50f9c2a8f90099f2a0fed17475441d55c7), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f), [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f)]:
  - @n-dx/llm-client@0.3.0
  - @n-dx/rex@0.3.0

## 0.2.3

### Patch Changes

- [#155](https://github.com/en-dash-consulting/n-dx/pull/155) [`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817) Thanks [@endash-shal](https://github.com/endash-shal)! - model and quality of experience improvements

- Updated dependencies [[`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817)]:
  - @n-dx/llm-client@0.2.3
  - @n-dx/rex@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [[`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba)]:
  - @n-dx/llm-client@0.2.2
  - @n-dx/rex@0.2.2

## 0.2.1

### Patch Changes

- [#126](https://github.com/en-dash-consulting/n-dx/pull/126) [`6c88d23`](https://github.com/en-dash-consulting/n-dx/commit/6c88d237f83594c4877f0f975b383e880fd656bf) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix ndx work failing when .hench/runs/ directory is missing after a fresh clone. Add generated rex files to .gitignore on init. Exclude source map files from published packages.

- Updated dependencies [[`6c88d23`](https://github.com/en-dash-consulting/n-dx/commit/6c88d237f83594c4877f0f975b383e880fd656bf)]:
  - @n-dx/rex@0.2.1
  - @n-dx/llm-client@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @n-dx/rex@0.2.0
  - @n-dx/llm-client@0.2.0

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

- Updated dependencies [[`616c799`](https://github.com/en-dash-consulting/n-dx/commit/616c799ef0ef2ed9f96acadb6ba5540270a07a82), [`d940a48`](https://github.com/en-dash-consulting/n-dx/commit/d940a48af8ca288642efebf90a5786ee59bf6a88), [`9c2963f`](https://github.com/en-dash-consulting/n-dx/commit/9c2963fcb95e9e80c4702878c958f486bf5f9fbb), [`17e486a`](https://github.com/en-dash-consulting/n-dx/commit/17e486a391d85a65e62d231539bff0a2ee212dc8)]:
  - @n-dx/rex@0.1.9
  - @n-dx/llm-client@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [[`e83e960`](https://github.com/en-dash-consulting/n-dx/commit/e83e9601f179855b69d49a3557ce1b29bdc082f9)]:
  - @n-dx/rex@0.1.8
  - @n-dx/llm-client@0.1.8
