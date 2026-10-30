# @n-dx/llm-client

## 0.10.2

### Patch Changes

- [#931](https://github.com/en-dash-consulting/n-dx/pull/931) [`e147a8f`](https://github.com/en-dash-consulting/n-dx/commit/e147a8fd658bb12dd687592b9d983a88697ebdfc) Thanks [@endash-shal](https://github.com/endash-shal)! - API and local agents edit files without rewriting them whole. hench's tool set for the API, local and Gemini loops gains `edit_file` (replace an exact `old_string` with `new_string`; it must match once unless `replace_all` is set, the error names the count, and CRLF files keep their line endings), and the system prompt tells those agents to use it for existing files. `write_file` now refuses to replace an existing file larger than `hench.guard.writeShrinkMinBytes` (default 1024) with content under `hench.guard.writeShrinkRatio` of its size (default 0.5, 0 disables) unless the call passes `rewrite: true`, and points the model at `edit_file`. Livelock, plan-only and completion checks, run summaries and run events count `edit_file` as a file change. Both keys are documented in `ndx config --help`, offered by `hench config` and the dashboard, and checked by the repository trust review.

- [#931](https://github.com/en-dash-consulting/n-dx/pull/931) [`c5a6067`](https://github.com/en-dash-consulting/n-dx/commit/c5a6067cfe5db0239e428ecb218a0dc8f92c3a98) Thanks [@endash-shal](https://github.com/endash-shal)! - Local-model runs survive a dropped LM Studio connection. A refused or dropped connection to the local server (`fetch failed`, `ECONNREFUSED`, `ECONNRESET`, `UND_ERR_SOCKET`, …) is retried with capped exponential backoff on the provider's blocking and streaming paths and in hench's local tool loop, configured by the new `llm.local.maxRetries` (default 6), `llm.local.retryBaseDelayMs` (default 2000) and `llm.local.retryMaxDelayMs` (default 60000) — about two minutes, long enough for a model reload. When those run out the error is a retryable `ClaudeClientError` with the new reason `"network"`, naming the server, the attempts made and the settings to raise, and hench's local loop retries the turn again on `hench.retry.*` before failing the task. A request that hits `llm.local.timeoutMs` still fails without a retry. The settings are listed and validated by `ndx config`.

- [#931](https://github.com/en-dash-consulting/n-dx/pull/931) [`95875df`](https://github.com/en-dash-consulting/n-dx/commit/95875df8e3ddd5fb6a931df791fa6891c1c0fc07) Thanks [@endash-shal](https://github.com/endash-shal)! - Local-model runs no longer die on a slow turn or a malformed reply. Node's fetch waits at most 300 s for response headers, and LM Studio sends none for a non-streamed completion until generation finishes, so a slow model's turn failed with `UND_ERR_HEADERS_TIMEOUT` whatever `llm.local.timeoutMs` said — and the connection retries then resent the same slow request. Local completions (the provider's blocking path, and hench's local tool loop, context summarizer and verifier) are now requested with `stream: true` and `stream_options.include_usage`, so the headers arrive at once, and the server-sent chunks are assembled back into the non-streamed response — content and reasoning concatenated, tool calls merged by index, the finish reason and the usage chunk — so tool-call parsing and token accounting read the same shape as before. `llm.local.timeoutMs` still bounds the whole request (0 = no limit), and a connection dropped mid-stream is retried like a refused one. No new dependency. A 400/500 from the local server saying the model produced malformed output (LM Studio: "The model produced output that does not match the expected … format", and similar) — or the same error arriving inside the stream as an error event — is now resent up to the new `llm.local.maxFormatRetries` times (default 3; 0 disables), one log line per resend; ordinary 400s such as a context-length error, streamed or not, are not resent. When the resends run out the error says what happened and names the setting. `parseLmStudioError` reads LM Studio's string-valued `error`. `ndx config` validates and documents `llm.local.maxFormatRetries`, and the dashboard's Local server settings gain a Retries row for it and the three connection-retry settings.

## 0.10.1

### Patch Changes

- [#881](https://github.com/en-dash-consulting/n-dx/pull/881) [`3668341`](https://github.com/en-dash-consulting/n-dx/commit/3668341ec83e50ded68f9697fb5880833235d8fc) Thanks [@endash-shal](https://github.com/endash-shal)! - The hub's `/x/<name>/` proxy now keeps the per-user token away from extension sidecars: the `X-Ndx-Token` header, the `ndx_token` cookie and a bearer carrying the token are removed from forwarded HTTP and WebSocket requests, and `X-Ndx-Base-Path: /x/<name>/` is added. The bare `/x/<name>` redirects to `/x/<name>/`. A disabled or unapproved extension answers 404 with the reason, as an unknown one does. `x` is reserved as a project id: the hub refuses to register it, and a repository named `x` gets a hashed id.
  
  The proxy strips the hub token from query parameters as well as headers and cookies, preserves redirects already under the mount, and replaces client-supplied sidecar credentials. Each hub launch uses a separate random NDX_SIDECAR_SECRET checked by the sidecar on HTTP, health and WebSocket requests. Running sidecars revalidate approval, stop on revocation even with open sockets, and exit when the hub lifetime pipe closes. The hub accounts for cold-request disconnects, stopped-instance connections, health-port races and crash backoff.

- [#881](https://github.com/en-dash-consulting/n-dx/pull/881) [`fd0913b`](https://github.com/en-dash-consulting/n-dx/commit/fd0913b4cae9d925f39ed90b9479bdf99b974e1e) Thanks [@endash-shal](https://github.com/endash-shal)! - The hub now runs extension sidecars at `/x/<name>/`. The first request starts the sidecar on an ephemeral loopback port and waits up to 20 s for its `health` path; past that it answers 503 naming the log file under `<ndx home>/ext/<name>/logs/`. A sidecar with no request and no open WebSocket for `idleStopMinutes` is stopped, and `ndx hub stop` stops every one. A crashed sidecar restarts on the next request, backing off after three crashes in five minutes. None starts while available memory is at or below the hub's memory floor. The hub learns how to start each one from the new `ndx extensions sidecar <name> --json`, so discovery, approval and the config check stay in n-dx. `spawnManaged` gains a `logFile` option that appends a child's output to a file.

- [#867](https://github.com/en-dash-consulting/n-dx/pull/867) [`de8bc93`](https://github.com/en-dash-consulting/n-dx/commit/de8bc939849ed25a4376dca29ec18646cc906954) Thanks [@dependabot](https://github.com/apps/dependabot)! - Dependency updates: `@anthropic-ai/sdk` ^0.133.0 → ^0.137.0 (llm-client, hench), `web-tree-sitter` 0.27.0 → 0.27.1 (lang-runtime), and `react` / `react-dom` ^19.3.0 → ^19.3.1 (core, graview-face).

- [#816](https://github.com/en-dash-consulting/n-dx/pull/816) [`c101993`](https://github.com/en-dash-consulting/n-dx/commit/c101993d87650ef58470c03e85584a0ecc3a4481) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Every child process gets the sanitized environment ([#686](https://github.com/en-dash-consulting/n-dx/issues/686), [#635](https://github.com/en-dash-consulting/n-dx/issues/635)).
  
  - A run can no longer leave n-dx's own config files changed, whichever vendor, provider or tool wrote them. `ndx work` snapshots `.n-dx.json`, `.n-dx.local.json`, `.ndx/config.json`, `.ndx/config.local.json`, `.mcp.json`, `.claude/settings.json`, `.claude/settings.local.json` and `.codex/config.toml` before the agent starts. It puts back any that changed after every vendor CLI exits, after every API-loop tool call, and before the test gate. This covers a Codex agent (`codex exec` has no per-path deny), an allowed command such as `node -e` or `npm` under either vendor, and a write under another spelling such as `.N-DX.local.json`. The run fails, and its record (`protectedConfigWrites`) and output name each path and what happened to it, never the content. Don't run `ndx config` or save dashboard settings while `ndx work` is running: an edit made during the run is put back too. The finding says the file changed during the run, without claiming the agent did it, and tells you to save your own change again after the run. A `.claude/`, `.codex/` or `.ndx/` that the agent swapped for a link out of the project is replaced by a directory before anything is put back, so the restore never writes or deletes outside the project, and the run reports the swap as `replaced`. A `.ndx/` created during a run on a legacy-layout project is removed, so the next command reads the same layout and config. A protected directory that cannot be read, such as a link loop, refuses the run at start with a message naming it.
  
  - Commands the repository owns no longer see your credentials. The test gate, post-task tests, `pnpm audit` / `pnpm outdated`, requirement validation commands, the cleanup typecheck, completion validation, rex's `verify_criteria` test command, the pair reviewer's fallback test run and `ndx ci`'s `pnpm docs:build` now run with the same credential filter as the agent's shell (`guard.env`), instead of inheriting the whole parent environment. A `guard.env.allow` entry the repository ships (`.hench/config.json` or the `hench` section of `.n-dx.json`) reaches these commands only while you trust the repository (`ndx trust accept .`). Entries in your git-ignored `.n-dx.local.json` always apply.
  - The cross-vendor pair reviewer's CLI follows the same rule: in an untrusted checkout it keeps the `hench.guard.env.allow` entries in your `.n-dx.local.json` and drops only the repository's, and its warning names only the dropped entries.
  - The same rule now covers the agent's own shell. An untrusted checkout's `guard.env.allow` no longer reaches `run_command`, git or the vendor CLI during `ndx work`; the trust warning says to move a variable your own tests need to `hench.guard.env.allow` in `.n-dx.local.json`, or to run `ndx trust accept .`.
  - Vendor CLI environments keep each vendor mode's credentials from one table. Codex keeps the variable named by the `env_key` of the model provider your own Codex config selects (`$CODEX_HOME/config.toml`, default `~/.codex/config.toml`), so Codex on Azure OpenAI starts with its key; a repository's `.codex/config.toml` and its n-dx config are never read for it. The Gemini CLI on Vertex AI (`GOOGLE_GENAI_USE_VERTEXAI` on) keeps `GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`. A mode's names are kept only while that mode is active, and `ndx work` reports by name when an active mode has none of its credentials (for the executor and the pair reviewer alike), without promising a fallback the vendor may not have. Two configurations are not detected yet and still read as mode-off, so their credentials are stripped: the Gemini CLI on Vertex AI selected through `selectedAuthType` in its `settings.json` rather than `GOOGLE_GENAI_USE_VERTEXAI`, and Codex profiles kept in the `--profile` file layout rather than `config.toml`. Until they are covered, list the variables they need in `hench.guard.env.allow` in your `.n-dx.local.json`.
  - A repository cannot choose which variable is sent as an API key, or where it is sent. `api_endpoint` (Claude, Codex, Google, and the legacy `claude` block) and `llm.google.apiKeyEnv` in the shared `.n-dx.json` apply only once you trust the repository; until then they are ignored with a warning, and the trust review lists them. The same fields in your `.n-dx.local.json` always apply, and `ndx config` now writes them there. A repository you trusted before that sets one of them reads as changed and asks again. `llm.google.apiKeyEnv` is now read by every loader, not only the auth preflight. `ndx config --test-connection` follows the same rule, so it no longer sends your Claude API key to an untrusted repository's endpoint. So does the Google auth check in `ndx auth`, `ndx init` and `ndx config llm.vendor google`: an untrusted repository's `apiKeyEnv` no longer picks which variable it sends.
  - A repository cannot choose the vendor CLI binary n-dx runs. `llm.claude.cli_path`, `llm.codex.cli_path` and the legacy `claude.cli_path` in the shared `.n-dx.json` apply only once you trust the repository, for `ndx auth`, `ndx init`, `ndx config llm.vendor`, `ndx work` and the cross-vendor reviewer; until then they are ignored with a warning naming the field, and the trust review lists them. `.n-dx.local.json`, where `ndx config` writes `cli_path`, always applies. A repository you trusted before that sets one reads as changed.
  - Nor can it through hench's `claudePath` or the dashboard's CLI version probe. A `claudePath` other than the bare `claude` in `.hench/config.json` or the `hench` section of `.n-dx.json` is listed by the trust review, including when an override of the wrong type in `.n-dx.json` or a tracked `.n-dx.local.json` sits over it, and `ndx work` spawns it only once you trust the repository; `hench.claudePath` in `.n-dx.local.json` always applies, and `ndx init` (for a discovered install path), `ndx config hench.claudePath`, `hench config claudePath` and the dashboard's "Claude CLI Path" now write it there instead of `.hench/config.json`. A checkout an older `ndx init` wrote such a path into reads as untrusted after upgrade; re-running `ndx init` moves it to `.n-dx.local.json` and the checkout reads as baseline again, however init finds Claude (`CLAUDE_CLI_PATH`, a local `cli.claudePath`, `PATH`) and with `--no-claude`. A `hench.claudePath` already in `.n-dx.local.json` is kept. A `claudePath` that is not a well-known install location was set by hand and stays where it is. The dashboard's model catalog probes the binary runs use (`CLAUDE_CLI_PATH`, then the trust-gated `cli_path`) instead of reading `cli.claudePath` and `llm.codex.cli_path` raw from the project config.
  - Nor can it choose the variable hench's API loop sends as the Anthropic key. An `apiKeyEnv` other than `ANTHROPIC_API_KEY` in `.hench/config.json` or the `hench` section of `.n-dx.json` is listed by the trust review and applies only once you trust the repository; until then `ndx work` sends `ANTHROPIC_API_KEY`. `hench.apiKeyEnv` in `.n-dx.local.json` always applies, and `ndx config hench.apiKeyEnv`, `hench config apiKeyEnv` and the dashboard's "API Key Env Var" now write it there, so setting your own no longer marks the checkout untrusted. A repository you trusted before that sets one reads as changed.
  - Nor through `cli.claudePath`. `ndx init` probes and registers MCP servers with the Claude binary before the trust review, so it reads `cli.claudePath` only from `.n-dx.local.json`, where `ndx config cli.claudePath` now writes it. One in the shared `.n-dx.json` is never run and is listed by the trust review; a repository you trusted before that sets one reads as changed. Move a hand-set shared value to `.n-dx.local.json`; `ndx init` names the field and the move while the shared one is skipped.
  - Vendor CLI checks outside `ndx work` get the same environment as `ndx work`'s vendor CLI, no longer your whole shell. That covers the auth check in `ndx auth`, `ndx init` and `ndx config llm.vendor`, the `cli_path` check in `ndx config --test-connection` and `ndx config llm.codex.cli_path`, and the dashboard's CLI version probe. A credential outside the vendor's mode, such as `GITHUB_TOKEN` or the other vendor's key, no longer reaches the binary. The dashboard's probe also applies your `hench.guard.env.deny`, and when the repository's `hench.guard.env` is malformed, the CLI checks ignore only the malformed field and keep every valid deny list, yours included.
  - Nor through `graview.bin`. `ndx graview check|describe|serve|mcp` spawns a `graview.bin` from the shared `.n-dx.json` (or a committed `.n-dx.local.json`) only once you trust the repository; until then it is ignored with a warning and the next source (`NDX_GRAVIEW_BIN`, `PATH`, the product face, npx) is used. The trust review lists it with the vendor CLI paths. One in your untracked `.n-dx.local.json`, and `NDX_GRAVIEW_BIN`, always apply. A repository you trusted before that sets one reads as changed.
  - Nor through its own `node_modules`. When nothing else provides graview, `ndx graview` falls back to `npx -y graview@<pinned>`. That now runs in a directory n-dx owns under the ndx home rather than the project root, so a `graview` the repository installs in `node_modules` is never run, and the repository's `.npmrc` is never read.
  - Nor through `graview.app`. `ndx graview serve` runs the product face a shared `.n-dx.json` (or a committed `.n-dx.local.json`) names only once you trust the repository; until then it is ignored with a warning and the installed `@n-dx/graview-face` is used. The trust review lists it with the vendor CLI paths. One in your untracked `.n-dx.local.json` always applies. A repository you trusted before that sets one reads as changed.
  - `ndx graview` no longer hands your shell's credentials to graview. A graview from `PATH` or the product face, the `npx -y graview@<pinned>` fallback (a binary fetched from the registry) and the product face's server get the same filtered environment as repository commands, instead of the whole parent environment. `PATH`, `HOME` and npm's own config still reach them; npm auth tokens do not.
  - A `guard.env.deny` in `.hench/config.json` now reaches repository commands when the `hench` section of `.n-dx.json` also carries a `guard`. The trust review merged the two `guard` objects shallowly, so a project-config `guard` without `env` dropped the deny entry; it now deep-merges them as hench and `ndx config` do. A trusted repository whose two files both carry a `guard` may read as changed once and ask again.
  - A `.n-dx.local.json` the repository commits is no longer read as yours. Every gate that applied the local file regardless of trust (the agent's shell and repository commands' `guard.env.allow`, the pair reviewer's CLI environment, `cli_path`, `api_endpoint`, `apiKeyEnv`, `hench.claudePath`) now asks git whether the file is tracked. A tracked one is repository config: the trust review lists it (`local-config-tracked`) with what it sets, and none of it applies until you run `ndx trust accept .`; `ndx init` never probes a `cli.claudePath` from it. An untracked file keeps applying everywhere, and in a checkout that is not a git repository nothing is tracked, so the file applies as before. Inside a git checkout where git cannot answer (`detected dubious ownership`, git missing, a corrupt index), the file counts as tracked and waits for `ndx trust accept .`. A file committed under a case variant (`.N-DX.local.json` on macOS or Windows), or reached through a symlink the repository commits (a symlinked `.ndx`, or a local file linking to a committed one), counts as tracked too, and `ndx init` asks the same check through `hench trust status`. So does a local config inside a submodule (a `.ndx` submodule's `config.local.json`, delivered by `git clone --recursive`) or any other nested git work tree, which git in the superproject cannot see; its finding names that directory and gives no `git rm --cached` advice. The finding and its `git rm --cached` advice name the paths git tracks (the case variant as committed, or the symlink and its target), so the advice matches.

- [#816](https://github.com/en-dash-consulting/n-dx/pull/816) [`916ed4e`](https://github.com/en-dash-consulting/n-dx/commit/916ed4e7925e23a5f0bd2c059340f733f0a975ab) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Repository trust can no longer be steered by the repository ([#686](https://github.com/en-dash-consulting/n-dx/issues/686)).
  
  - The guard baseline comes from marker files (`go.mod`, `Package.swift`, an Xcode project), not from the `language` the repository declares. A JS/TS checkout declaring `swift` no longer gets `xcodebuild` and `xcrun` without trust: it reports a `language-mismatch` warning, needs `ndx trust accept .`, and hench clamps it to the JS/TS baseline until then.
  - Every guard baseline blocks every ecosystem's dependency directories at any depth (`**/node_modules/**`, `**/vendor/**`, `**/.build/**`, `**/DerivedData/**`, `**/Pods/**`, `**/Carthage/**`); only the allowed commands depend on the language. A marker file such as a zero-byte `Package.swift`, or a polyglot checkout's root `go.mod`, can no longer drop `node_modules` from an untrusted checkout's clamp, and the clamp keeps the agent out of `web/node_modules/` or a workspace package's `node_modules/` as well as the root's. New hench defaults block all of them; existing configs, including root-only `node_modules/**`, still read as baseline, and hench widens such a root-only entry to any depth when it runs an untrusted checkout.
  - A repository guard that drops its own ecosystem's dependency directory (`node_modules/**` in a JS/TS checkout, `vendor/**` in Go, the Swift set in Swift) now raises a `dependency-paths-removed` warning, so the checkout needs `ndx trust accept .` and is clamped until then. Before, such a guard read as baseline and was never clamped.
  - `verify_criteria` runs a repository's test command only once the user has accepted this exact execution config with `ndx trust accept .`. Before, a plain command such as `pnpm test` ran on any checkout that was otherwise at the defaults. The command rex actually runs is what the trust digest covers, including a `rex.test` override in the project config; a non-string `test` never runs. Soft freeze: `verify_criteria` keeps its result shape, but `runTests: true` is now refused, with the existing `testsSkipped` note and `trust` field, on a checkout that has a test command and no matching trust record.
  - The commands hench's test gate runs — `hench.testGate.command`, `hench.testGate.rerunCommand` and `hench.fullTestCommand`, from `.hench/config.json` or the project config — are reviewed like `rex.test`: each is a `test-command` finding (a warning when it chains or fetches) and is in the trust digest, so swapping one after `ndx trust accept .` reads as `changed`. An invalid-typed override cannot hide the value beneath it. While a checkout is untrusted or changed, hench withholds these commands and the gate auto-detects one instead. Checkouts that set none keep their digest.
  - `rex verify` applies the same rule. It still runs tests unless `--dry-run`, but a repository's test command runs only after `ndx trust accept .`; until then it prints the mapping, says to accept, and exits 1, so a CI step with no trust record fails rather than passing without running tests. `--format=json` carries the same `testsSkipped` and `trust` fields as `verify_criteria`.
  - `ndx trust accept .` on a checkout whose only deviation is a test command names the command and says verify_criteria and `rex verify` can now run it, instead of "Nothing to trust".
  - `ndx trust .` on such a checkout says whether its test command is accepted, naming the accept command until it is, instead of "nothing to trust". `ndx init` prints that full report too rather than its one-line baseline summary.
  - Trust output escapes terminal control characters from repository values. `ndx trust .`, `ndx trust accept .` and the run-time trust warning show ESC, CR, other C0/C1 controls and bidi overrides as `\xNN` / `\uNNNN`, so a test command, allowed command or MCP server entry cannot erase or rewrite the line the user is reviewing. Finding `message` strings carry the escaped form; `values`, the evaluated config and the trust digest keep the raw values.
  - The trust review reads the project config's `hench` section the way hench does: deep-merged over `.hench/config.json`, with a field of the wrong type falling back to the layer below. Before, an override such as `"allowedCommands": 0` read as an empty allowlist in the review while hench ran the wide `.hench/config.json` guard beneath it, so the checkout read as baseline and was never clamped, and a later change to `.hench/config.json` did not move the trust digest. hench now also reverts an invalid `.n-dx.local.json` field to the `.n-dx.json` value beneath it rather than to `.hench/config.json`.
  - The agent can no longer write n-dx's own config files. hench's guard refuses `.n-dx.json`, `.n-dx.local.json`, `.ndx/config.json`, `.ndx/config.local.json`, `.mcp.json`, `.claude/**` and `.codex/**` whatever the configured guard says, trusted or not, and every guard baseline lists them (`NDX_CONFIG_BLOCKED_PATHS`). Blocked paths now match regardless of case, so `.N-DX.local.json` or `.ENV` no longer reaches the blocked file on macOS or Windows. Under `provider=cli` the Claude CLI is spawned with `--disallowed-tools` `Edit(...)` rules for the same paths. Before, PRD content or a README could steer the agent into writing `.n-dx.local.json` with `hench.guard.env.allow: ["*"]`, a `cli_path` or an endpoint, which applied with no trust review because that file is read as the user's own.

## 0.10.0

### Patch Changes

- [#846](https://github.com/en-dash-consulting/n-dx/pull/846) [`6144a9c`](https://github.com/en-dash-consulting/n-dx/commit/6144a9cd36eb62a872b0578dda68016c01f314e9) Thanks [@endash-shal](https://github.com/endash-shal)! - A wrong Gemini API key is now an authentication failure. Google answers a bad key with HTTP 400 (not 401) and a body carrying the `API_KEY_INVALID` reason; the Google provider routed only 401 and 403 to the auth classifier, so a mistyped `GEMINI_API_KEY` surfaced as a generic failure. `complete()`, `stream()` and `generateContentWithTools()` now throw an `AuthFailureError` with the re-authentication guidance for that 400, `validateAuth()` answers `false` for it, and the shared auth signature recognises `API_KEY_INVALID`, so hench's auth halt sees it too. A 400 that does not name the key is still a non-auth failure.
  
  `AuthFailureError.authReason` for a plain-text auth error is now a normalized reason — `invalid API key`, `token expired`, `not logged in`, `401 Unauthorized`, `403 Forbidden`, `unauthorized` or `authentication failed` — instead of the raw message echoed back; the provider detail is taken as the reason only when it was built from a JSON error body, where the extracted `error.message` is kept as before. The user-facing `message` is unchanged.

- [#846](https://github.com/en-dash-consulting/n-dx/pull/846) [`4443ec0`](https://github.com/en-dash-consulting/n-dx/commit/4443ec08e1432dd0648c5e1c8f972408d3bff5c9) Thanks [@endash-shal](https://github.com/endash-shal)! - The LLM error classifier no longer takes cubic time deciding whether a long provider error body is an authentication failure, and `parseLmStudioError` no longer takes cubic time on a long LM Studio body that repeats "model not". The auth signatures read the first 4 KB of the message and allow at most 80 characters between the words of a phrase; the model-not-loaded signature allows 200. A JSON body longer than the window still yields its `error.message`. Finding the `[ndx-debug:<path>]` sentinel no longer takes quadratic time on a message full of unclosed openings. Results are otherwise unchanged.

- [#846](https://github.com/en-dash-consulting/n-dx/pull/846) [`166e33f`](https://github.com/en-dash-consulting/n-dx/commit/166e33fc06eee3b00482fa5283eb0e3731af6efe) Thanks [@endash-shal](https://github.com/endash-shal)! - One host and port shape rule for the local LLM endpoint. `@n-dx/llm-client` exports `isPlausibleLlmHost`, `isValidPort` and `describeLocalEndpointProblem`, and the local inference provider refuses a saved `llm.local.host` or `llm.local.port` that fails them before building its URL — a hand-edited `.n-dx.json` used to reach `fetch` unchecked. The dashboard imports the rule instead of carrying a copy, and reports a saved port written as a string as invalid rather than silently probing 1234. `ndx config llm.local.host` (and `llm.local.verifier.host`) refuses a host carrying a path, credentials, a second port or whitespace, and accepts `localhost`, `127.1`, `[::1]` and a LAN name — `127.1` was previously coerced to a number and refused. A parity test holds core's inline copy equal to llm-client's.

- [#749](https://github.com/en-dash-consulting/n-dx/pull/749) [`2b00932`](https://github.com/en-dash-consulting/n-dx/commit/2b00932c9219ba7eb18f446493e2549170aafe48) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx migrate --plan` shows the preflight banner and a run summary that lists the `--out` plan as written and says model calls are not counted. `llm.routes` for `prd.migrate.judge` (or `*`) turns the Jev review off.
  
  Adds a config key under the soft freeze: `llm.routes` accepts `prd.migrate.judge` (the migration's Jev review), and a route to a tier turns that review off. `ndx migrate --plan` prints the preflight banner and run summary. No flag or MCP tool changes shape.
  
  On Windows, the guard that keeps `rex export`, `rex migrate-plan --out`/`--summary` and `rex tree-diff` from writing inside the rex directory now sees through 8.3 short-name aliases such as `RUNNER~1`. It resolved paths with `fs.realpathSync`, which leaves short names unexpanded, so a project or output path written in short form slipped past the check. It now uses `realpathSync.native`; macOS and Linux behave as before.
  
  Fixes a CLI guard under the soft freeze (Windows only): the same commands refuse a path they already meant to refuse. No flag or MCP tool changes shape.

- [#846](https://github.com/en-dash-consulting/n-dx/pull/846) [`2471bd7`](https://github.com/en-dash-consulting/n-dx/commit/2471bd7263746886671f0c29cb8abe94bf28b8c1) Thanks [@endash-shal](https://github.com/endash-shal)! - The Windows spawn guard now refuses what cmd.exe would actually expand. [#790](https://github.com/en-dash-consulting/n-dx/issues/790) refused a `%NAME%` token only when `NAME` was in the environment, but cmd.exe also expands variables it computes itself (`%CD%`, `%RANDOM%`, `%CMDCMDLINE%`, the undocumented `%__APPDIR__%` and `%__CD__%`, …) and reads the name before a `:~` or `:a=b` modifier, so `%CMDCMDLINE:~-1%` slipped through and expanded to a bare `"` that ended the argument. A token carrying a line break is refused too, since cmd.exe silently drops everything after it. Every cmd.exe invocation passes `/v:off`, and sourcevision's `execFileSyncCli` is llm-client's, so there is one recipe. Those sourcevision spawns (`rex tree`, `ps`) now appear in `claude_commands.log` like every other spawn through these helpers.

- [#839](https://github.com/en-dash-consulting/n-dx/pull/839) [`0e03074`](https://github.com/en-dash-consulting/n-dx/commit/0e0307419bbbf9a6a8a0222908f523ebdfac06ea) Thanks [@endash-shal](https://github.com/endash-shal)! - Windows: no more console windows from n-dx's child processes. `exec()` and `spawnCli` in llm-client gain a `windowsHide` option that defaults to true, and every other production spawn in the monorepo passes it; a new root policy test (`windows-hide-policy`) fails any spawn that does not. The vendor-CLI log `claude_commands.log` is now gitignored by `ndx init` and discounted by hench's uncommitted-work gate, so a fresh project's first agent run no longer refuses completion over it. The Overview page's isometric hero shows its Options button again.

## 0.9.1

### Patch Changes

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`02aa8af`](https://github.com/en-dash-consulting/n-dx/commit/02aa8afe08842e6d56b65f52d3364007485b72c2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The v2 agent brief is built from the change and the product nodes it affects. `buildChangeBrief` renders the work, the change's intent and amendments (proposed text included), each amended or touched capability with its own and inherited capability criteria, requirements, health and whether its spec was reviewed, the constraints that bind them, depends-on neighbours one hop out, where the capabilities live in code, the last three changes to those nodes, and the project's commands, workflow and log.
  
  One measured 4,000-token budget covers the whole brief. Sections are admitted capabilities-and-constraints first; a list that does not fit is trimmed in place — falling back to a compact form that still names every capability — rather than dropped, and every trim says what it left out. Nothing takes a vendor or model, and the sectioned and flat renders are byte-identical, so a CLI run and an API run send the same brief.
  
  `@n-dx/llm-client` exports `estimateTokens` and `CHARS_PER_TOKEN`, the model-independent half of `budgetPreflight`, so a caller sizing text against its own budget needs no model id.
  
  The two sections the budget never trims, `task` and `change`, bound every free-text field and every list they render — description, failure reason, done-when criteria, tags, blockers, an amendment's summary, proposed text and criteria, and the touched-without-amending list. An unbounded one would not have made the brief long, it would have made the brief exceed its budget and drop the capabilities section the budget exists to protect.

- [#675](https://github.com/en-dash-consulting/n-dx/pull/675) [`0fa0251`](https://github.com/en-dash-consulting/n-dx/commit/0fa0251bb16de71d69aabbe9243a86bf2325dadb) Thanks [@endash-shal](https://github.com/endash-shal)! - Bitbucket and Atlassian credentials are redacted in full, not up to their
  first `-`, `_`, `+` or `/`.
  
  The four Atlassian patterns in `redact.ts` were written from memory with no
  network access, and their body character classes were too narrow. A body
  character outside the class ends the match, so the prefix was replaced and
  everything after that character stayed in the run record in plain text — the
  worst shape a redaction bug can take, because the output looks redacted.
  
  Each class is now taken from a published detector ruleset, cited in the code:
  
  - `ATBB` (Bitbucket Cloud app password) — trufflehog's
    `bitbucketapppassword` detector, whose own fixture `ATBBa9iO-tyg7u_op`
    carries both `-` and `_`. The length floor also came down: real app
    passwords are far shorter than the previous 20-character body minimum, so
    one was not matched at all.
  - `ATATT` / `ATCTT` — gitleaks' `atlassian-api-token` and trufflehog's
    `atlassian/v2`. Both show `+` and `/` in the body; neither was in the class.
  - `BBDC-` (Bitbucket Data Center, prefixed since Data Center 8) — the body is
    plain base64, so `+`, `/` and `=` belong in it.
  
  The unit-test fixtures were runs of a single repeated letter built to clear
  each regex's own floor, so they could only ever confirm the regex against
  itself. They now carry the documented body characters, and a new test checks
  the *suffix* after each one rather than the whole token — the old assertion
  (`not.toContain(secret)`) passed even when half the credential survived.

- [#675](https://github.com/en-dash-consulting/n-dx/pull/675) [`1923d4d`](https://github.com/en-dash-consulting/n-dx/commit/1923d4d06a947f1d6b296acbf7418e694c304cad) Thanks [@endash-shal](https://github.com/endash-shal)! - Claude Code CLI runs now honour `llm.effort`, passing it as `--effort <level>`.
  
  The Messages API paths have sent `llm.effort` as `output_config.effort` since
  the effort work landed, but CLI runs dropped it: the llm-client CLI provider
  ignored `CompletionRequest.effort` and hench's CLI agent loop passed no
  `--effort` at all. A project that set `llm.effort` got it on API runs and
  silently not on CLI runs.
  
  Both now resolve through `resolveClaudeCliEffort`, which shares the API path's
  validation — an unknown level or a model that does not accept effort is
  dropped with the same warning — and stops before its per-model default.
  `CLAUDE_DEFAULT_EFFORT` exists to hold the API's heavy tier at the depth it
  had before Opus 5.5 lowered its own API default; Claude Code picks its own
  default per model, so sending ours unasked would override that choice on every
  run nobody configured. With no rule matched the flag is omitted and the CLI
  decides.
  
  `agent/lifecycle/api-effort.ts` is now `agent-effort.ts`, since it serves both
  of hench's loops.

- [#809](https://github.com/en-dash-consulting/n-dx/pull/809) [`cb236e9`](https://github.com/en-dash-consulting/n-dx/commit/cb236e93e169b0f10301f47ffa26e0bf681c9259) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Update `@anthropic-ai/sdk` to 0.133 (hench, llm-client) and `zod` to 4.6.7 (hench, rex, sourcevision, web). Both are additive releases with no change to n-dx behaviour.

- [#627](https://github.com/en-dash-consulting/n-dx/pull/627) [`8507518`](https://github.com/en-dash-consulting/n-dx/commit/8507518864af56e93cf8a6c2aad6c3bb9a9236a1) Thanks [@dependabot](https://github.com/apps/dependabot)! - Dev dependencies bumped, including vitest 5. No runtime change: the published packages ship the same code, and the one test that vitest 5 rejected (a `vi.mock` written inside a test body) now declares its mock at module scope.

- [#787](https://github.com/en-dash-consulting/n-dx/pull/787) [`d7c49c3`](https://github.com/en-dash-consulting/n-dx/commit/d7c49c3927f08f5743f43274034dee29f6843ecb) Thanks [@endash-shal](https://github.com/endash-shal)! - Fail-forward mode: a settings toggle that commits work as it happens instead of letting it pile up uncommitted.
  
  With it on, an autonomous loop that finds work left in the tree after an iteration commits it and carries on, rather than refusing to continue — so an interrupted loop still leaves each finished iteration committed. Settings changes commit too, including ones made from the pre-run menu, which writes the same file through the same handler as the settings page. `--allow-dirty` suppresses it: the operator asked for their tree to be left alone.
  
  Every commit it makes is scoped to the paths that step touched and uses a constant message for its kind. Work that belongs to the operator is refused outright rather than committed: anything already staged (including a `git add -p` hunk selection), and anything at all while a merge, rebase, cherry-pick or revert is in progress — `git add` on a conflicted path marks it resolved, and mid-rebase the commit then succeeds with the conflict markers in it. A failed commit unstages whatever it had staged, so it leaves the index as it found it. It also refuses to commit a config that carries a credential. Commits carry the usual `N-DX` trailers. Nothing is ever pushed. Off by default, and with it off behaviour is unchanged.
  
  The toggle is read through `isFailForwardEnabled` in `@n-dx/llm-client` rather than from the dashboard's feature registry, because `ndx work` and the hench run loop are separate processes that never reach the web server — two readers of one toggle would have drifted. The value is re-read at each decision point, so turning it off mid-run is obeyed at the next boundary rather than after a restart.
  
  The toggle also carries an info control on the settings page explaining what is committed and when; `FeatureDefinition` gains an optional `details` field for toggles whose effects reach outside the dashboard.

- [#647](https://github.com/en-dash-consulting/n-dx/pull/647) [`2cd2e40`](https://github.com/en-dash-consulting/n-dx/commit/2cd2e40b5927eb23a9633aaddc37bbce559c3101) Thanks [@dnaniel](https://github.com/dnaniel)! - New package `@n-dx/graview`: a read-only projection of an n-dx project into [Graview](https://graview.dev). `ndx graview emit .` writes a `graview-document` declaration (the kinds area, capability, constraint, change, task, release, zone, component, run and commit, with every stored and derived rex relation as a typed edge, five titled lenses and two rules) and a `{nodes, edges}` seed snapshot built from the rex PRD model, sourcevision's zones and components, and hench's run records. `ndx graview check|describe|serve|mcp .` re-emit and spawn the `graview` CLI on the files, so the graph is never older than the tree on disk; `serve` is the store's HTTP and live WebSocket wire that a Graview face connects to, and `mcp` is read-only.
  
  No n-dx package depends on `@graview/*`: the binary is a peer tool resolved from `graview.bin` in the project config, `NDX_GRAVIEW_BIN`, PATH, the installed product face's own `graview`, then `npx -y graview@0.1.20`. Output lands under the layout's new `graviewDir` (`.ndx/graview` or `.graview`), which `ndx init` now gitignores; nothing is written under the rex, sourcevision or hench directories, and the N-DX-Item trailer cache `computeRealizedBy` keeps goes under the graview dir too. File nodes are opt-in (`--files`).
  
  Commits and releases come from git for every tree, v1 included: each commit on main whose `N-DX-Item` trailer names a change or task is a `commit` node (subject, author, date) that `landedFor` it, and a finished change with no stamped `shippedIn` ships with the first release tag containing its landing, so each `release` is dated by its tag and counts what it shipped. The caches go under the graview dir.
  
  A v1 tree projects the product layer rex's migration plan proposes (the plan's rules stage, pure and deterministic): an epic is an area, a feature with completed work a capability with a template statement, a constraint-shaped feature a constraint, the work under them changes placed on them, the rest in the Inbox. Every product node from the plan says `proposed`, and `graview.proposeProductLayer: false` projects the tree as changes only.

- [#623](https://github.com/en-dash-consulting/n-dx/pull/623) [`090e111`](https://github.com/en-dash-consulting/n-dx/commit/090e111efc45edac8a0bcdf420fd55b2baabc117) Thanks [@mikemikimike](https://github.com/mikemikimike)! - Filter credential-shaped environment variables before launching vendor CLIs,
  including retries and cross-vendor reviewers, while retaining the active
  vendor's authentication, including Claude's active Bedrock and Vertex modes.
  An explicit `hench.guard.env.allow` entry permits the matching variables to
  reach hench runs and the cross-vendor reviewer; projects that need additional
  credentials for tests or MCP servers must opt in there. One-shot completions
  from rex, sourcevision and the dashboard always use the default filter.

- [#662](https://github.com/en-dash-consulting/n-dx/pull/662) [`0562de4`](https://github.com/en-dash-consulting/n-dx/commit/0562de42cb52dda567b9b1358d987e380519b51a) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `POST /api/llm/config/preview` resolves unsaved edits without writing them. It
  takes `PUT /api/llm/config`'s body, plus an optional `provider` (the field the
  page saves through `/api/hench/config`), and returns `effective`,
  `effectiveProblems`, `tiers`, `failover` and `review` for the saved config with
  those edits applied in memory. Refused edits come back in `editProblems`
  instead of failing the request. `GET` and the preview now share one resolver;
  `@n-dx/llm-client` exports `parseLLMConfig`, the in-memory half of
  `loadLLMConfig`.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`65731af`](https://github.com/en-dash-consulting/n-dx/commit/65731afcf429ea011d2bb1ee4e5f537a6739b0e4) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The v2 migration plan can have Jev review it. Review runs when `rex.placement.models` is `jev` or `both`, or the `jevReview` option is set, and needs a TypeSafe key. Without a key the pass is skipped with one warning. Each item gets one Jev request (task class `prd.migrate.judge`) that batches its questions: a held item's kind and placement, whether an area's title names a job a user does, whether each criterion states product behaviour, and whether each linked test exercises its criterion. Each judged entry records its lowest confidence. The plan summary gains a review queue (held items first, then entries by ascending confidence) and counts of what Jev flagged and dropped. A test link Jev judges irrelevant is dropped only under `autoAccept: confident`. Otherwise it is flagged. A different kind or a process criterion is flagged, never applied. After Jev drops a link, review is re-checked against the approved spec hash, as after any redraft. Migrations may define `summarize`, which rebuilds the summary after every pass.

- [#627](https://github.com/en-dash-consulting/n-dx/pull/627) [`00e7462`](https://github.com/en-dash-consulting/n-dx/commit/00e74627b65fe3bcc453d4330ef5d9969b82d177) Thanks [@dependabot](https://github.com/apps/dependabot)! - Production dependencies bumped: zod 4, ink 8, react 19.3, @anthropic-ai/sdk 0.131, @modelcontextprotocol/sdk 1.32.1 and pdfkit 0.20. TypeScript stays on 6.x because sourcevision parses source with its compiler API, which TypeScript 7 does not ship, and preact stays on 10.x until its web test and leave-guard changes are worked through. Schemas move to zod 4's two-argument `z.record`; reserved and loosely-typed state keys are declared optional, since zod 4 no longer treats a missing `z.unknown()` key as optional; and the SDLC evidence list keeps its at-least-one rule as a tuple so it still infers the non-empty type.

- [#694](https://github.com/en-dash-consulting/n-dx/pull/694) [`8228a7e`](https://github.com/en-dash-consulting/n-dx/commit/8228a7eb48c34ea6eb394a1b56d2736c7e759553) Thanks [@endash-shal](https://github.com/endash-shal)! - Test-only: each package's vitest config splits its files into a shared-worker project and an isolated one for files that mock modules or globals, through `tests/vitest-isolation.mjs`. Same tests, less per-file worker and module-graph cost. No production code changed.

- [#694](https://github.com/en-dash-consulting/n-dx/pull/694) [`173f13e`](https://github.com/en-dash-consulting/n-dx/commit/173f13e17743c32f839c1619fc221e7d8c584148) Thanks [@endash-shal](https://github.com/endash-shal)! - Test-only: vitest keeps console output for failing tests and drops it for passing ones (`silent: "passed-only"`). A green run of the monorepo no longer prints thousands of lines of task briefs, init summaries and fixture warnings. No production code changed.

- [#675](https://github.com/en-dash-consulting/n-dx/pull/675) [`7a6eeab`](https://github.com/en-dash-consulting/n-dx/commit/7a6eeabfe2a97d511ebbc980f0e1155134e88d48) Thanks [@endash-shal](https://github.com/endash-shal)! - Count each assistant message's tokens once, and price a task's runs in the dashboard.
  
  Claude's `--output-format stream-json` emits one `assistant` line per *content block*, not per message, and every line repeats the finished message in full — `usage` included. A turn that writes a sentence and calls three tools arrives as four lines carrying one turn's tokens four times. Claude Code's session transcripts have the same shape. Both of hench's live ingestion paths summed line by line, so every run's totals were multiplied by the turn's average block count: on a measured session, 234 usage-bearing lines carrying 57 distinct messages, a 4.27x over-count that recorded 23.5M cache-read tokens against the 5.5M actually read.
  
  `UsageMessageFilter` in `@n-dx/llm-client` holds the identity rule — the first sighting of a `message.id` counts, later ones do not. It is applied in `cli-loop`'s token extraction (both the event-pipeline and legacy paths) and in the transcript reader behind `hench record`. Repeats are flagged rather than dropped in the transcript, because cursors and marks address positions by the per-line uuid; removing lines would move every boundary and invalidate every cursor file on disk. Usage carrying no message id is still counted — a vendor that stamps none would otherwise lose its tokens entirely.
  
  The dashboard then had a second problem: it led with a single token total that counted cache reads alongside everything else. Cache reads bill at roughly a tenth of the input rate and outnumber the other three classes by an order of magnitude, so the figure read as tens of millions for work that cost a few dollars. The per-task aggregator now keeps the four billed classes apart instead of collapsing them to one number, and prices each run at the model that run recorded — one task's Haiku and Opus runs are no longer billed at a single blended rate. Cost rolls up through the PRD tree alongside tokens, and the tree's usage column leads with it; the token accounting moves to the cell tooltip, which reports newly-processed tokens and cache reads separately so the price and the token count can be reconciled.
  
  Two errors in the price table itself turned up on the way. `claude-sonnet-5` was priced at $3/$15 — the rates of the Sonnet 4.6 it replaced — overstating every Sonnet 5 figure by 50%; it is the toolkit's standard tier *and* the fallback every unrecognised model is priced at, so the error reached far more surfaces than the runs that named it. And `claude-fable-5-1` was absent, so a Fable 5.1 run silently priced at the Sonnet fallback; its cache-read rate is $0.25/MTok rather than the 0.1x the other Claude rows follow.
  
  Runs already recorded keep the totals they were written with — the run files do not retain message ids, so the over-count cannot be undone after the fact. Runs recorded from here on are correct.

- [#625](https://github.com/en-dash-consulting/n-dx/pull/625) [`e41d31f`](https://github.com/en-dash-consulting/n-dx/commit/e41d31fff91f9599ffc1e85d38cf1fad8da9e162) Thanks [@endash-shal](https://github.com/endash-shal)! - Repository trust now covers `guard.env.allow`. A tracked `.hench/config.json`
  (or a `.n-dx.json` hench override) that passes credential-shaped environment
  variables through to the agent's processes changes the trust digest and raises
  an `env-allow-added` warning in the trust review, instead of taking effect
  unseen on an already-trusted checkout. `guard.env.deny` is not collected — it
  can only remove variables, so it never widens what the agent can read.
  
  A repository that ships no `guard.env.allow` keeps the digest it already had,
  so the upgrade does not re-open trust on checkouts the user has approved.

- [#658](https://github.com/en-dash-consulting/n-dx/pull/658) [`c357d36`](https://github.com/en-dash-consulting/n-dx/commit/c357d364ff0609368c12f8a797e468960fed53f6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Follow-ups to the vendor CLI credential filter:
  
  - Claude on Bedrock keeps its role and container credentials: the IRSA names
    (`AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_ROLE_ARN`, `AWS_ROLE_SESSION_NAME`), the
    ECS/Fargate `AWS_CONTAINER_*` names and `AWS_CA_BUNDLE` reach the CLI when
    `CLAUDE_CODE_USE_BEDROCK` is on, and are stripped when it is off. When Bedrock
    or Vertex mode is on and none of its credential variables are set, `ndx work`
    says so once, by name only.
  - The cross-vendor reviewer falls back to the shell test command when its
    environment cannot be resolved (for example, an unreadable config), instead of
    failing the review.
  - The reviewer's shell test command no longer inherits the raw environment. It
    gets the project's `hench.guard.env` policy, without the reviewer vendor's
    authentication variables. If that policy cannot be loaded, the default filter
    applies and the review banner says so.
  - `ndx start --open` on Windows opens the dashboard without `cmd.exe`, so a
    `%NAME%`-shaped sequence in the URL's token or project id is no longer
    expanded.

- [#790](https://github.com/en-dash-consulting/n-dx/pull/790) [`6f9db39`](https://github.com/en-dash-consulting/n-dx/commit/6f9db391476e7a2afff41389cb7f6d6dd85f6fa1) Thanks [@endash-shal](https://github.com/endash-shal)! - The Windows CLI spawn now refuses a command line that `cmd.exe` would rewrite before running it.
  
  `quoteWindowsToken` neutralises every `cmd.exe` metacharacter except one, and said so in its own comment: `%VAR%` is expanded *inside* double quotes, and the substituted text is then parsed as part of the command line. An expanded value holding a double quote therefore ends the argument early, and an `&` after it starts a second command. `cmd.exe` offers no escape for `%` outside a batch file, so quoting cannot close this — the limitation was written down as a caller contract instead, with nothing enforcing it.
  
  `spawnCli`, and the `spawnCli`/`execFileSyncCli` twins in `@n-dx/core`, now check the tokens against the environment they are about to pass and throw rather than spawn. The check is deliberately narrow: `cmd.exe` expands only a name it can resolve and leaves anything else literal, so a path that merely contains a percent sign (`C:\Users\100%cool\bin`) still spawns, and so does one naming a variable that is not set. Only a token that would actually be rewritten is refused, and no CLI the toolkit spawns passes one. Matching is case-insensitive, as Windows environment lookup is.
  
  POSIX spawns are unaffected — they never go through `cmd.exe`.

## 0.9.0

### Patch Changes

- [#588](https://github.com/en-dash-consulting/n-dx/pull/588) [`1dfc0c7`](https://github.com/en-dash-consulting/n-dx/commit/1dfc0c7e7947ffa6054cb6ef9efc214805253a16) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Each package's full build now ends by writing `dist/.build-stamp.json`, a hash of the source it compiled. The repository's affected test gate uses it to tell a current build from a stale one by content rather than by file times, so a partial build no longer hides stale compiled code and an identical-content rewrite no longer demands a rebuild.
   The stamp is excluded from the published tarballs.

- [#532](https://github.com/en-dash-consulting/n-dx/pull/532) [`eff0f79`](https://github.com/en-dash-consulting/n-dx/commit/eff0f79db748ee2ec71c27abbde166fdcfbfc722) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Jev client and its judgment cache move from sourcevision into `@n-dx/llm-client`, so rex can ask judgment-shaped questions without importing a sibling domain package. Behaviour, the cache file location and its format are unchanged. Per-call ledger accounting, which a foundation-tier module cannot reach upward for, is now an injection seam: sourcevision registers its run ledger through `setJevObserver` when `sv analyze` starts.

- [#579](https://github.com/en-dash-consulting/n-dx/pull/579) [`cf19d5a`](https://github.com/en-dash-consulting/n-dx/commit/cf19d5a29ffa9ad4df8bb2befb2dd3f266785e05) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the placement decision for a change on the product layer (`core/placement-policy.ts`). `rex.placement.models` (`text`, `jev`, `both`) chooses which tiers run beside the rules, and `rex.placement.autoAccept` (`none`, `agree`, `confident`) decides when a placement is accepted without a person; a change without one gets `needsPlacement`. Jev runs under its own `prd.place.judge` task class, which is not a default judgment route, so exporting `TYPESAFE_API_KEY` alone never turns it on. `confident` needs a Jev pick at confidence 0.8 or higher that is on the rules shortlist. Jev can abstain with a none-of-these option, which is never auto-accepted, and a Jev confidence that is not finite or is outside 0–1 is ignored with a warning. Without Jev, `both` falls back to the text model and `jev` to rules only, each with a warning. Not wired into the store, CLI or MCP yet.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `loadLLMConfig` now keeps `llm.claude.reviewModel`, `llm.codex.reviewModel`, `llm.google.reviewModel` and top-level `llm.reviewModel`. They were dropped on load, so a configured reviewer model was silently ignored for those vendors and `ndx work --resolve` reported the vendor default.

- [#529](https://github.com/en-dash-consulting/n-dx/pull/529) [`f46b952`](https://github.com/en-dash-consulting/n-dx/commit/f46b95235daf551cd0cc7c13ae162204aff74527) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Route core, and the rest of hench and web, through the layout resolver
  
  Every remaining literal `.rex/`, `.hench/`, `.sourcevision/` and `.n-dx*` path
  in the orchestration tier now asks `resolveLayout` where the project keeps its
  state, as do the hench and web files the 0.8.0 sweep left behind. On a project
  that has run `ndx migrate-layout`, these all used to read or write a path
  nothing is there — silently, because a missing file is indistinguishable from
  an empty project. Fixed as part of that:
  
  - `ndx start stop` and `ndx start status` could not find a running dashboard on
    the new layout, and left it running.
  - The staleness notice told a migrated project that all three of its tool
    directories were missing and that it should re-run `ndx init`.
  - `ndx ci`, `ndx export` and `ndx refresh` looked for analysis output, the PRD
    tree and run records under the legacy names; the cross-vendor reviewer found
    no codebase context, no PRD excerpt and no configured test command.
  - The guard baseline every hench run is clamped to blocked `.rex/**` and
    `.hench/**` only, so on the new layout the agent was free to write n-dx's own
    state, PRD tree included.
  - The "Strict Safety" workflow template had drifted from that baseline in both
    copies, dropping half its credential patterns — choosing it left a project
    *less* protected than the default. Both copies now derive from the baseline.
  - Hench classified PRD writes by file extension on the new layout, so run
    summaries reported bookkeeping as documentation changes.
  - The note printed after a completion commit named a gitignore path the
    operator does not have, so following it left the tree dirty and the next run
    still refused to start.
  
  New in `@n-dx/llm-client`: `layoutStateNames()`, for the classifiers that are
  handed a path and must recognise n-dx state under either layout rather than
  resolve one.

- [#582](https://github.com/en-dash-consulting/n-dx/pull/582) [`8bae238`](https://github.com/en-dash-consulting/n-dx/commit/8bae2381270ebcd2c419b4c8d8c90ffd87ac3047) Thanks [@endash-shal](https://github.com/endash-shal)! - Every remaining reader of the project config asks the layout resolver where it lives, so a project on the `.ndx/` layout is read from `.ndx/config.json` (and `.ndx/config.local.json`) instead of a root `.n-dx.json` nothing writes. In `@n-dx/llm-client` that is `loadLLMConfig`, `loadClaudeConfig`, `loadProjectOverrides` and `loadProjectOverrideSources`, whose `file` label is now the root-relative path of the file read; `PROJECT_CONFIG_FILE` and `LOCAL_CONFIG_FILE` keep their legacy names for labels. In `@n-dx/hench`: the project CLI name, the Claude weekly budget, archival and retention settings and `hench.fullTestCommand`. In `@n-dx/web`: the config, LLM, features, CLI-timeout, project-settings, SourceVision (zone pins and Ask timeout), token-usage and usage-cleanup routes, the CLI name, and the dashboard usage ledger, which lands at `.ndx/web-usage.jsonl` on that layout; `GET /api/cli/timeouts` now reports `configFile`, the file the overrides live in, and the CLI Timeouts page shows it. The layout-literal inventory reaches zero.
  
  The same sweep found that hench and rex recovered the project root from their own state directory as its parent, which on the `.ndx/` layout is the container — so `loadConfig`'s project overrides and the `loadClaudeConfig` / `loadLLMConfig` adapters read `.ndx/.n-dx.json`, a file nothing writes, and every override was silently ignored on a migrated project. `projectRootOf` in `@n-dx/llm-client` (exported, and through hench's llm gateway) steps over the container, and `loadProjectOverrideSources` and both packages' adapters use it.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A website open in the user's browser can no longer make the dashboard spawn `ndx` through the prepare routes.
  
  `GET /api/hench/prep/:taskId` and `GET /api/hench/ready` answer 403 to a foreign `Origin` or a `Sec-Fetch-Site` other than `same-origin`/`none`; header-less CLI requests still work. Prep and preview spawns are capped at 4 in flight (429 beyond), identical prep resolves share one spawn, and a client disconnect kills the child. `exec` gains a `signal` option to support this.

- [#579](https://github.com/en-dash-consulting/n-dx/pull/579) [`86751c5`](https://github.com/en-dash-consulting/n-dx/commit/86751c571f74bb04949e8b5cc1007eddf4ea1e21) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Rank placement candidates for a change from rules (package and path mentions, title word overlap, file evidence against realized-by) and an optional text model on the new `prd.place` task class; the model counts as agreeing only when it picks the rules' top candidate.

- [#532](https://github.com/en-dash-consulting/n-dx/pull/532) [`fefc307`](https://github.com/en-dash-consulting/n-dx/commit/fefc3072a4a1f7a902a5f456fa4475faeebb5b71) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Redaction now covers Bitbucket and Atlassian credentials. The prefixed shapes are recognised wherever they appear — `ATBB` (Bitbucket Cloud app password), `ATCTT` (scoped Bitbucket access token), `ATATT` (Atlassian API token) and `BBDC-` (Bitbucket Data Center HTTP access token) — and two rules cover the forms a credential without a prefix of its own travels in: `Authorization: Basic <base64>`, which is how Bitbucket Cloud sends an app password, and the `-u user:password` flag, which keeps the username as URL userinfo already does. A credential printed bare with no prefix, key, flag or header is still out of reach; `redact.ts` says why.
  
  `redactSecretsDetailed().kinds` now names each kind once, as documented. `assignment` is two rules and appeared twice when both fired.

- [#584](https://github.com/en-dash-consulting/n-dx/pull/584) [`5802bc2`](https://github.com/en-dash-consulting/n-dx/commit/5802bc221ecab89d6be697b65e90d6db8c138674) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Rex can re-point recorded commit SHAs that a rebase, cherry-pick or squash rewrote to the commit they became on main (same author date and subject, patch-id, or N-DX-Item trailer and subject, then an optional host pull-request lookup), returning unmatched SHAs with a reason. `exec` gains an `input` option that writes to the child's stdin.

- [#520](https://github.com/en-dash-consulting/n-dx/pull/520) [`0ec098a`](https://github.com/en-dash-consulting/n-dx/commit/0ec098ae8fe51a8f62a7a8e8400eba9e47971a1d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex mcp .` now serves the worktree named by the client's MCP roots, so a Claude desktop session in a linked worktree writes that worktree's PRD rather than the main checkout's ([#499](https://github.com/en-dash-consulting/n-dx/issues/499)). A root naming another worktree of the same repository that has no `.rex/` refuses writes instead of falling back. An explicit directory (`rex mcp /abs/path`) and the dashboard's HTTP MCP keep the directory they were given. `get_capabilities` reports the served `workspace`. `@n-dx/llm-client` exports the shared `resolveWorkspaceFromRoots` helper.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add a shared available-memory reading (`readAvailableMemory`, `getAvailableMemory`).
  
  On macOS it counts free + inactive + speculative + purgeable pages from `vm_stat` and takes health from `kern.memorystatus_vm_pressure_level`, instead of `os.freemem()`, which counts only free pages and read a healthy 16 GB Mac as ~115 MB free. When neither can be read the reading is `availableBytes: null` and `pressure: "unknown"`, never 0. Linux and Windows keep `os.freemem()` unchanged. Readings are cached for 5 s and concurrent refreshes share one spawn.

- [#607](https://github.com/en-dash-consulting/n-dx/pull/607) [`ce25794`](https://github.com/en-dash-consulting/n-dx/commit/ce2579434098c1994c73d91b1964f2b54b8f202f) Thanks [@endash-shal](https://github.com/endash-shal)! - One host-neutral git-remote-URL parser, in `@n-dx/llm-client`
  
  `parseGitRemoteUrl` splits an origin remote into `{ host, owner, repo, path, kind }`
  for https, ssh and scp-style forms, where `kind` distinguishes `github`,
  `bitbucket-cloud`, a self-hosted `bitbucket-dc` and `other`. Data Center's `/scm/`
  clone prefix is dropped from the identity path, so the same repository parses the
  same way over https and ssh.
  
  The three readers that each had their own regex now share it: sourcevision's
  analysis manifest and iso export, and the web dashboard's project route. They
  disagreed — web's split on `[/:]` read `ssh://git@host:7999/PROJ/repo.git` as the
  repo `repo` with no owner, while sourcevision's could not parse that form at all.
  A new architecture-policy rule fails the build on a second parser.
  
  An scp-style remote does not need a dotted host: `git@work-github:acme/widget.git`
  (an ssh config alias) and `git@bitbucket:PROJ/widget.git` (a short internal
  hostname) parse like any other. Only a one-character host is refused, because
  that is a Windows drive letter and git reads `C:\src\repo` as a local path.

- [#602](https://github.com/en-dash-consulting/n-dx/pull/602) [`b671123`](https://github.com/en-dash-consulting/n-dx/commit/b6711238559f132c7f0f7099b525d08108cfc445) Thanks [@endash-shal](https://github.com/endash-shal)! - Child processes no longer open console windows on Windows. The shared `exec`
  wrapper defaults `windowsHide` to true, and the core CLI spawn shim, the vitest
  launcher and the e2e helpers set it, so a test suite or an agent run no longer
  flashes a console per spawn across the screen and steals keyboard focus.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx work --task=<id> --resolve [flags] <dir>` (`hench run --resolve`) prints one JSON object describing the run those flags would start, without starting it: the task, the workspace, every setting (vendor, model, provider, permission mode, review and review model, test gate, budgets, fresh, allow-dirty, reset-deferred) with the config key that supplied it, the per-run options with their flags, types and allowed values, the equivalent `ndx work` command, and each reason the run would refuse — task-not-found, not-actionable, claimed-elsewhere, tree-not-conformant, vendor-unset, vendor-cli-missing, provider-unsupported, model-vendor-mismatch, dirty-tree. It exits 0 when it reports refusals, and takes no claim, writes no PRD or git state and starts no vendor CLI. Resolution uses the run's own flag parsing and model chain, so the reported model is the one the run uses. `resolveTaskModel` now also returns the `source` key that supplied its model.

## 0.8.0

### Minor Changes

- [#459](https://github.com/en-dash-consulting/n-dx/pull/459) [`0e3623e`](https://github.com/en-dash-consulting/n-dx/commit/0e3623edbc25e417982a93db53aa7ae6b70fae2f) Thanks [@endash-shal](https://github.com/endash-shal)! - 0.8.0 — Find your way
  
  A single `.ndx/` directory for project state, with `ndx migrate-layout` to move
  an existing project onto it. A reorganised dashboard: views are stages, Analysis
  opens on the codebase map, settings are three pages (Robot Wrangler, Workflow,
  Project) on a shared save frame, and every moved path redirects. A Live tab for
  watching every run across a repository's worktrees. A per-user token on the hub
  and dashboard, and repository trust gating what a checkout's execution config
  may widen. New Claude model defaults, per-vendor agent models, per-field
  resolution of the legacy `claude.*` keys, and effects declared for every command
  and shown in a preflight banner.
  
  Every other changeset in this release is a `patch`, which is the repo default
  and correct for each change on its own. This one makes the aggregate a minor, as
  the 0.8.0 epic requires.

### Patch Changes

- [#434](https://github.com/en-dash-consulting/n-dx/pull/434) [`66705e6`](https://github.com/en-dash-consulting/n-dx/commit/66705e69a1d66651644ef9a5f5ff684669ebf2e9) Thanks [@endash-shal](https://github.com/endash-shal)! - Carry the token parser's verdict on the runtime event, and serialize session-cache writes.
  
  `RuntimeEvent` now carries `tokenDiagnosticStatus` and `tokenCacheProvenance`. Both were computed by `parseTokenUsageWithDiagnostic` and then discarded when the event was built, so the event pipeline re-derived them from the parsed numbers. That inference cannot match the parser: the parser decides from field presence, while the numbers only show values. An explicit `input_tokens: 0` is a complete measurement that inferred as `partial`, and a zero-valued cache count is omitted from `TokenUsage` entirely, so it inferred as `unavailable` where the parser said `measured` — a parity gap between legacy and event-pipeline run records. Consumers prefer the carried values and keep the inference as a fallback for events produced before the fields existed.
  
  Session-cache mutations now hold an exclusive lock for the whole read-modify-write, and write through a temp file and a rename. `maxConcurrentProcesses` defaults to 3, so concurrent runs in one checkout are normal: two tasks advancing the same batch chain each persisted their own `tasksUsed` and session id over the other's, and `clearSessionCache` could delete a chain written between its own read and its `rm`, breaking the preservation contract it documents. The lock is best-effort by design — a cache is an optimisation, so it proceeds unlocked after a timeout rather than failing a run, and steals a lock left behind by a killed process.

- [#505](https://github.com/en-dash-consulting/n-dx/pull/505) [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add Claude Opus 5.5, Sonnet 5.5 and Fable 5.1, and move the Claude defaults onto them
  
  **The defaults have changed.** The standard tier (and the default when no model is
  configured) is now `claude-sonnet-5-5`. The heavy tier and the review model are now
  `claude-opus-5-5`. The `opus` alias now resolves to `claude-opus-5-5` and `fable`
  to `claude-fable-5-1`. `ndx init` offers Sonnet 5.5 (recommended), Opus 5.5,
  Fable 5.1 and Haiku 4.5.
  
  All three new models have a 1M context window and list pricing, so budget
  preflight, `ndx usage` and the dashboard spend views price them as known. That
  includes dated `-YYYYMMDD` snapshots. Previously they fell back to estimated
  rates and showed `known: false`.
  
  `claude-sonnet-5`, `claude-opus-5` and `claude-fable-5` are still priced and
  resolvable, and `ndx init` accepts them without an unknown-model warning.
  
  The dashboard config footer now shows every version part: `sonnet 5.5`,
  `fable 5.1`, `haiku 4.5`. Before, it showed `sonnet 5` and `haiku 4`.
  
  **Pinning back.** Older Claude Code releases can reject the new model ids on
  CLI-provider runs. If yours does, upgrade Claude Code, or pin the previous model:
  `ndx config llm.claude.model claude-sonnet-5 .`. For the heavy tier and review,
  also set `llm.tiers.claude.heavy` and `llm.claude.reviewModel` to
  `claude-opus-5`.

- [#505](https://github.com/en-dash-consulting/n-dx/pull/505) [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Claude API requests now send `llm.effort` as `output_config.effort`, and Claude Opus 5.5 defaults to `high` effort. `llm.effort` was parsed but never sent. With no matching rule, `claude-opus-5-5` gets `high` so the move from Opus 5 keeps its reasoning depth (Opus 5.5's API default is `medium`), and other models are unchanged. Effort is never sent to a model that rejects it (Haiku 4.5, Sonnet 4.5 and older) or when the value is not `low`, `medium`, `high`, `xhigh` or `max`; both cases print a warning. Claude Code CLI runs are unchanged.

- [#505](https://github.com/en-dash-consulting/n-dx/pull/505) [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Price `claude-sonnet-5` at $2 input / $10 output / $2.50 cache write / $0.20 cache read per MTok. Anthropic made the launch price standard and cancelled the planned rise to $3/$15, so `ndx usage`, budget preflight and the dashboard spend views were over-reporting Sonnet 5 runs by 50%.

- [#489](https://github.com/en-dash-consulting/n-dx/pull/489) [`05a8115`](https://github.com/en-dash-consulting/n-dx/commit/05a811560a19baf95e69bc19a8c906dad2b3fea9) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `auth-token.ts`: `resolveAuthTokenPath`, `readAuthToken`, `ensureAuthToken` and `hasAuthToken` manage the per-user dashboard token file (`<ndx home>/auth.token`, created with owner-only modes) that the hub and project servers require. An existing token file that is readable by others has its mode tightened to 0600 before it is returned.

- [#439](https://github.com/en-dash-consulting/n-dx/pull/439) [`39c6d80`](https://github.com/en-dash-consulting/n-dx/commit/39c6d80441aba2c3dd71d94494b58bf42fc5a4a0) Thanks [@endash-shal](https://github.com/endash-shal)! - The per-user directory the hub keeps its registry, pid and config in is now `~/.ndx/`, resolved by `resolveNdxHome` alongside the project-layout resolver rather than spelled out at each site.
  
  Nothing moves on an existing machine: the lookup takes `$NDX_HOME`, then `$N_DX_HOME`, then `~/.ndx` if it exists, then `~/.n-dx` if it exists, and only a machine with neither starts on `~/.ndx`. A 0.7.x install keeps using `~/.n-dx` until it is migrated. An empty override is treated as unset.
  
  `ndx start` now passes the resolved directory to a hub it spawns as `$NDX_HOME`, and the hub reports a bad config key by naming the resolved file rather than a tilde path that may not be the one in force.

- [#482](https://github.com/en-dash-consulting/n-dx/pull/482) [`29c576a`](https://github.com/en-dash-consulting/n-dx/commit/29c576a196ed033d77a35a2dd87952ca6f32902f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `listVendorModels` and `isChatModelId`.
  
  `listVendorModels` asks Anthropic's Models API (Claude) or OpenAI's `/v1/models`
  (Codex) for the models a key can use, with the key resolved as the rest of
  llm-client does (config, then `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`). It
  never throws: it returns the models or a reason, and no reason contains the key.
  Ids are filtered with `isModelCompatibleWithVendor` and the new `isChatModelId`,
  which drops embedding, audio, image, moderation, realtime and transcription
  models.

- [#449](https://github.com/en-dash-consulting/n-dx/pull/449) [`ccad056`](https://github.com/en-dash-consulting/n-dx/commit/ccad05698ce562b0ae47b283a59854b299884f5c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `hench-override` to the vendor/model header's model-source union, and
  export the union as `ModelSource`.
  
  The header could describe a model as coming from a CLI flag, an `llm.*` field
  or the vendor default. `ndx work` now also resolves an agent-only override
  from `hench.models.<vendor>`, which is none of those three — reporting it as
  `configured` would have pointed operators at an `llm.*` key that lost.
  
  An explicitly pinned model now suppresses the tier label whichever rung pinned
  it: a `hench-override` model was not chosen by the tier table, so annotating it
  with a tier would misreport how it was selected. This already applied to
  `cli-override` and is unchanged for every other source.
  
  `ModelSource` is exported so callers can type their own resolution result
  against the header's union rather than restating the string literals.

- [#440](https://github.com/en-dash-consulting/n-dx/pull/440) [`2b144b8`](https://github.com/en-dash-consulting/n-dx/commit/2b144b897262afc597ab9e964febb6cd6c7d9f91) Thanks [@endash-shal](https://github.com/endash-shal)! - Price a dated model snapshot at its base model
  
  Vendors ship ids like `claude-haiku-4-5-20251001` while the price table is keyed
  on `claude-haiku-4-5`, so the lookup missed and fell back — and the fallback is
  `claude-sonnet-5`, a real catalogue entry at roughly three times haiku's input
  rate. Every haiku call was therefore priced at sonnet's rates, and the figure
  looked measured rather than wrong.
  
  `resolveModelPricing` now also tries the id with a trailing eight-digit date
  removed. Only pricing is affected; model *selection* keeps the id it was given,
  and a version suffix that is not a date (`jev-1.13.0`) stays unknown rather than
  being trimmed into something that happens to match.

- [#469](https://github.com/en-dash-consulting/n-dx/pull/469) [`aa0ca02`](https://github.com/en-dash-consulting/n-dx/commit/aa0ca024713788ec46248f12df84e7390c64e2c7) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Resolve the legacy top-level `claude.*` keys against `llm.claude.*` **per
  field**, and stop writing the legacy copies.
  
  **Behaviour change.** A project carrying both an `llm.claude` block and legacy
  `claude.*` keys now honours each legacy field the new block leaves unset. The
  fallback used to be block-level (`llmClaude ?? legacyClaude`), so a modern block
  holding a single field discarded every legacy field beside it — a project that
  set `claude.api_key` once and later pinned `llm.claude.model` silently lost the
  key, and `claude.lightModel` silently reverted to the tier default. Nothing said
  so, because both states are valid config.
  
  `resolveClaudeConfig` in `@n-dx/llm-client` is the one implementation of that
  rule, exported alongside a `sources` map saying where each resolved field came
  from. `loadLLMConfig`, `GET /api/llm/config` and `GET /api/ndx-config` all use
  it, so the CLI, the dashboard and the footer can no longer disagree about which
  value is live.
  
  Two further consequences of reading the resolved view:
  
  - The dashboard footer's auth check (`GET /api/ndx-config`) now counts a
    credential set under `llm.claude.api_key` / `llm.claude.cli_path`. It read
    only the legacy block before, and reported `authMethod: "none"` for a
    perfectly configured project — it happened to work solely because
    `packages/core/config.js` mirrored modern writes back into the legacy keys.
  - That mirror is gone. `ndx config llm.claude.<field>` now writes only
    `llm.claude.<field>`. Existing `claude.*` values are deliberately left where
    they are: they are still read until 1.0.0, so rewriting or removing them would
    change what a project resolves without being asked to. The local-file
    migration still clears a legacy *secret* from the shared file, because a key
    mirrored there by an older version must not stay committed.
  
  Readers that leaned on that mirror move with it. `ndx config --test-connection`
  resolves both locations per field, so it tests a credential stored under
  `llm.claude.cli_path` / `llm.claude.api_key` instead of reporting "No Claude
  configuration set" for a fully configured project. `ndx auth` already resolved
  both and is unchanged. `loadClaudeConfig` in `@n-dx/llm-client`, which supplies
  the API key, CLI path and endpoint to `ndx work` on the API provider and to rex's
  LLM commands, resolves both locations the same way, so a key set with
  `ndx config llm.claude.api_key` reaches them.
  
  Not yet moved: `ndx config claude.<field>` as a *read*, the whole-section
  `ndx config claude`, and the `claude` block in `ndx config --json` still answer
  from the legacy key alone, so they no longer surface a value set under
  `llm.claude.*`. Read it under its own name (`ndx config llm.claude.<field>`)
  until that migration lands.
  
  Writes go to the modern keys only. `PUT /api/llm/config` refuses `claude.model`
  and `claude.lightModel` with a 400 naming the `llm.claude.*` replacement, rather
  than the generic unknown-path error those keys would otherwise get.
  
  `GET /api/ndx-config` also stops falling back to `hench.model` for the displayed
  model. `ndx work` has never read that key, so the footer could name a model
  nothing would run.
  
  One sharp edge worth stating: a legacy `claude.model` that is incompatible with
  the active vendor was previously masked whenever any `llm.claude` block existed,
  and is now resolved — so `ndx work` reports it with the same actionable error a
  bad `llm.claude.model` already gets, instead of silently running the default.

- [#505](https://github.com/en-dash-consulting/n-dx/pull/505) [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Pin the `opus`, `haiku` and `fable` model aliases to literal model ids, so re-pointing a tier can no longer change which model family an alias resolves to.

- [#490](https://github.com/en-dash-consulting/n-dx/pull/490) [`d3c2169`](https://github.com/en-dash-consulting/n-dx/commit/d3c21692f2a8f7582a114fc69fba1c88a7a0205e) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `redactSecrets`, `redactSecretsDetailed` and `redactDeep`: credential redaction for text that is persisted or shown. Well-known token shapes (vendor API-key prefixes, JWTs, private-key blocks, bearer headers, URL passwords) and credential-shaped assignments (`GITHUB_TOKEN=…`, `api_key: …`) are replaced with `[redacted:…]` markers; run-record fields such as token counts are left alone. An assignment's value is taken whole — a quoted value to its closing quote, an unquoted one to the end of the line — so a passphrase containing spaces no longer survives in the clear. `createLineRedactor` is the stateful, line-at-a-time form for callers that never hold the whole text, such as a streaming log writer: it catches a private-key block whose BEGIN and END markers fall on different lines.

- [#491](https://github.com/en-dash-consulting/n-dx/pull/491) [`161da3d`](https://github.com/en-dash-consulting/n-dx/commit/161da3d04bb668f80ffe1a52c3be880cdeafbab1) Thanks [@endash-shal](https://github.com/endash-shal)! - Add repository trust: `evaluateRepoTrust` reads what a checkout ships as execution config (`.hench/config.json` guard and permission mode, `.rex/config.json` test command, `.mcp.json` servers), compares it to the guard baseline for the project's language, and reports whether this user has accepted it. The trust record lives in `<ndx home>/trust/` with owner-only modes, never in the repository. `guardBaselineForLanguage` is now the single source of hench's default allowlists and blocked paths, and the baseline blocks credential files (`.env`, keys, `.npmrc`, `.netrc`, `.aws/`, `.ssh/`) for every language. `clampGuardToBaseline` narrows a guard to that baseline.

- [#500](https://github.com/en-dash-consulting/n-dx/pull/500) [`0bca3ea`](https://github.com/en-dash-consulting/n-dx/commit/0bca3ea0f0336ec4f317504fb518320c6ac6856d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add a shared available-memory reading (`readAvailableMemory`, `getAvailableMemory`).
  
  On macOS it counts free + inactive + speculative + purgeable pages from `vm_stat` and takes health from `kern.memorystatus_vm_pressure_level`, instead of `os.freemem()`, which counts only free pages and read a healthy 16 GB Mac as ~115 MB free. When neither can be read the reading is `availableBytes: null` and `pressure: "unknown"`, never 0. Linux and Windows keep `os.freemem()` unchanged. Readings are cached for 5 s and concurrent refreshes share one spawn.

- [#436](https://github.com/en-dash-consulting/n-dx/pull/436) [`03590e4`](https://github.com/en-dash-consulting/n-dx/commit/03590e4fa8069232774dce4e1d0fe460b969e530) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a folder-layout resolver and a paths module per package.
  
  n-dx keeps its state in three dot-directories and five loose `.n-dx*` files, named
  directly at roughly 380 source files. `resolveLayout` in `@n-dx/llm-client` makes that
  one decision in one place: it reads a `.ndx/` container first and falls back to the
  legacy layout silently, so existing projects keep working untouched. Each package gains
  a paths module (`resolveRexPaths`, `resolveSourcevisionPaths`, `resolveHenchPaths`,
  `resolveWebPaths`) as the single home for its own folder names, and the orchestration
  tier gets a hand-written twin in `packages/core/layout.js` — it may not import from any
  package tier — pinned to the canonical implementation by a contract test.
  
  No call sites are rewired yet, so behaviour is unchanged.

- [#434](https://github.com/en-dash-consulting/n-dx/pull/434) [`66705e6`](https://github.com/en-dash-consulting/n-dx/commit/66705e69a1d66651644ef9a5f5ff684669ebf2e9) Thanks [@endash-shal](https://github.com/endash-shal)! - Record the session strategy, hit/miss reason and token-data provenance on every run.
  
  Every run record now carries a `session` field naming which session strategy ran
  (`fork` / `batch` / `cold`), whether the cache served it, the named reason it did or
  did not, and how old the entry was. `hench show` and the end-of-run summary print it
  as one line; the dashboard's run detail gains a Session section. Until now the only
  trace of that decision was a terminal line nobody was capturing, so "is batching
  actually hitting?" could not be answered from run history.
  
  API-provider runs record the decision too, as `cold` / `api-provider` — that path holds
  no session resumable by id, and saying so is not the same as saying nothing, which is
  also what a run that died before reaching the decision looks like.
  
  Cache token counts now say where they came from. `tokens.cachedProvenance` and the
  per-turn `cacheProvenance` distinguish a vendor that accounted for caching and
  reported none from a vendor that never reported it at all — both of which used to
  read as a confident `cached: 0`.
  
  Fixes two places where Codex cache data was dropped: the token parsers ignored
  Codex's `cached_input_tokens` / `cache_write_input_tokens` field names, and the Codex
  JSONL event parser kept only input and output from a turn's `usage`. A Codex turn
  reporting 45,472 input with 35,072 cached is now split correctly rather than counted
  entirely as uncached input — the total is unchanged, the attribution and the price
  are not.
  
  All fields are additive; run records written before this change load unchanged.

- [#449](https://github.com/en-dash-consulting/n-dx/pull/449) [`ccad056`](https://github.com/en-dash-consulting/n-dx/commit/ccad05698ce562b0ae47b283a59854b299884f5c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Validate `.n-dx.json`/`.n-dx.local.json` hench overrides (and workflow template
  overlays) against `HenchConfigSchema` instead of merging them in unchecked.
  
  `loadConfig` validated `.hench/config.json` but then deep-merged the project
  overrides on top with no validation, so `hench.maxTurns: -5` produced a run
  that "completed" having executed no turn, `promptCacheTtl: "1hour"` silently
  degraded to a 5-minute cache marker, and an invalid `prune` group crashed the
  pruner. Workflow templates hit the same gap through `applyTemplate`.
  
  `loadConfig` now re-validates the merged result. An invalid top-level override
  field reverts to its value in the already-validated base config (or the
  schema default) with a warning naming the field and the file it came from
  (`.n-dx.json` or `.n-dx.local.json`) — it never stops the run, matching how a
  malformed `.hench/config.json` is already salvaged. `hench template apply`
  gets the same treatment: an invalid template scalar now warns and falls back
  instead of refusing the whole template.
  
  `@n-dx/llm-client` gains `loadProjectOverrideSources`, exposing each
  project-config file's section separately so a caller can attribute a bad
  value to the file it came from.

- [#445](https://github.com/en-dash-consulting/n-dx/pull/445) [`cceceb5`](https://github.com/en-dash-consulting/n-dx/commit/cceceb563ba1650f4e70b9cbe63eec9bbd954e4d) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx init` now starts new projects on the `.ndx/` layout
  
  A project with no n-dx state gets a single `.ndx/` container holding `rex/`,
  `hench/`, `sourcevision/` and `config.json`, instead of three dot-directories
  and a `.n-dx.json` scattered across the root. `.mcp.json` stays at the
  repository root, because the vendor CLIs read it there.
  
  A project that already has n-dx state keeps the layout it has. Re-running init
  is how people pick up new assistant surfaces and repaired config, and it must
  not turn into a migration nobody asked for — moving an existing project is
  `ndx migrate-layout`'s job, where it can snapshot first and `git mv` so history
  follows.
  
  The mechanism is that init creates the container before it spawns the sub-CLIs,
  so each one resolves its own paths and they cannot disagree. Alongside it, the
  paths that `ndx init` writes and that every later command reads now come from
  the resolver rather than from literals: the project and package config files,
  the `requireInit` check, the `.gitignore` and `.gitattributes` blocks, the git
  baseline commit, and hench's own state directory across its CLI.
  
  `relativeToRoot(layout, path)` is new in `@n-dx/llm-client` (and its
  orchestration-tier twin), for the several places that need a resolved path as
  `.gitignore` spells it — root-relative, forward slashes.

## 0.7.2

## 0.7.1

### Patch Changes

- [#410](https://github.com/en-dash-consulting/n-dx/pull/410) [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4) Thanks [@dnaniel](https://github.com/dnaniel)! - Sourcevision can send file archetype classification (`code.classify`) to TypeSafe's Jev, a System One model that answers a Choice over the archetype catalog with a probability per option instead of free-text JSON. Setting `TYPESAFE_API_KEY` opts in; `llm.routes["code.classify"] = "light"` sends the class back to the vendor tier, and `llm.routes["<class>"] = "typesafe"` names the route explicitly. Classifications made this way carry Jev's probability as their confidence rather than a fixed 0.7. A confident `none` leaves the file unclassified; a low-confidence answer is escalated to the text classifier with the file's doc comment. Without the key nothing changes. `@n-dx/llm-client` gains `resolveJudgmentRoute` and `DEFAULT_JUDGMENT_ROUTES`; `LLM_VENDOR` and `ClaudeClient.complete` are untouched.
  
  With the same key, finding severity and category are graded by Jev (`finding.judge`: a Score and a Choice per finding, applied when confidence clears 0.5, with the confidence recorded on the finding) and each enriched zone gets two fragility Nouls (`zone.judge`) that become structural observations above 0.7. The enrichment prompts, including the meta pass, stop asking the text model for severity and category when the route is active; without the key every prompt is byte-identical to before. `enforceSeverityRules` still runs last.
  
  With the key present, `analyze` now runs a judgment-first cascade by default: zone names are selected by Jev from deterministic candidates (package, directory, archetype) and merged by a pair judgment; descriptions are templated from facts; fragility is judged once and only zones inside the 0.4–0.6 band, at most six per run (measured on three repositories), are escalated to generative narration; every generated finding is then judged for evidential support, metric paraphrase, anchor file, type and scope, and dropped or annotated accordingly. `--narrate` restores the full generative pass. Jev answers are cached per question in `.sourcevision/.cache/judgments.json`, and every run records per-phase and per-task-class cost on `manifest.lastAnalysis` and in `.sourcevision/.cache/analyses.jsonl`. Without the key, nothing changes.
  
  Also: warning- and critical-level heuristic (pass 0) findings are judged real-problem-or-artifact and demoted to `info` at 0.3 or below; the most cross-linked files get a `move-file` finding (`moveReason: "zone-judgment"`) when Jev places them confidently in another zone; a finding emitted under both a zone and `global` is kept once; `--per-zone` now reaches the analyzer.
  
  Re-runs are idempotent: a zone whose generated-name fallback already failed on the same files is not asked again, an escalated zone the previous run narrated on (nearly) the same files keeps its insights instead of being narrated again, and judged state carries no zone names so cache keys are stable across renames. Naming prints progress per Jev batch and per chunk of generated names.
  
  Generation is now one call per kind and off the critical path: `zone-naming` proposes names for the `none` zones in one prompt per chunk of up to 20 and verifies each chunk in one Jev request; `enrich-multiplex` narrates every escalated zone in one prompt; and `analyze` returns once its judged results are written, leaving narration to a detached `sv narrate` child (`manifest.narration`, `.sourcevision/.cache/narration.log`; `--wait` narrates inline).

- [#414](https://github.com/en-dash-consulting/n-dx/pull/414) [`fdd864c`](https://github.com/en-dash-consulting/n-dx/commit/fdd864c4db245e5d69a0ae78534f07c0cc752c0e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Retries now print as their own `retry n/m: <reason>` line across the LLM
  providers and hench, and `@n-dx/llm-client` gains a monotonic progress
  reporter for counters that span phases or batches.
  
  `@n-dx/llm-client` adds a `ProgressReporter` (`createProgressReporter`) that
  turns phase-qualified counters into a running total — switching phases or
  batches never produces a lower displayed number than was already shown — plus
  `printRetryLine`/`formatRetryLine`, which print rate-limit retries in the
  `retry n/m: <reason>` form on their own line and redraw the active progress
  line afterward. `api-provider.ts`, `cli-provider.ts` and
  `codex-cli-provider.ts` all route their default rate-limit message through
  it, replacing the old `Rate limited — retry in Ns… (attempt n of m)` text.
  
  `sourcevision analyze` registers a reporter for the life of the command
  (including recursive `--deep` sub-analyses), and its spinners register
  themselves as the active reporter while they own the terminal line, so a
  rate-limit retry raised inside an enrichment or classification batch pauses
  the spinner, prints its line, and redraws the spinner after it. The zone
  enrichment pass number is deliberately left unclamped: it is an absolute
  identifier (`--target-pass=N` names it) rather than a progress tick, so
  forcing it upward would report the wrong pass.
  
  `hench run` prints its own retries in the same form: the API loop's
  `API returned 429, retrying in 1000ms...` becomes `retry 1/3: API returned
  429, waiting 1000ms`, and the CLI loop's `Transient error on attempt n,
  retrying in Xms...` becomes `retry n/m: transient error, waiting Xms`, where
  `m` is the configured `retry.maxRetries`.

- [#390](https://github.com/en-dash-consulting/n-dx/pull/390) [`11634bb`](https://github.com/en-dash-consulting/n-dx/commit/11634bb4c60b66ecf9afda843ac4f03ea9b6a396) Thanks [@endash-shal](https://github.com/endash-shal)! - Price token usage at each model's own rates instead of Claude Sonnet's.
  
  **Reported costs rise on upgrade — typically by about half, and Opus-heavy
  projects by up to about two-thirds.** Dashboard and CLI cost figures go up
  because runs are now priced at each model's own rates instead of a flat
  Sonnet rate; no tokens were added and nothing runs more expensively. On this
  repo's baseline batch the same runs moved from $161.08 (flat Sonnet) to
  $247.53 (per model), a 54% rise — the old figure under-reported by about 35%.
  Budget alerts or dashboards keyed to the old under-reported figures will see
  a one-time jump.
  
  `estimateCost` took a `ModelPricing` parameter that every caller left at a
  single hardcoded Sonnet default (3/15 per MTok, cache write 3.75, cache read
  0.30). Opus (5/25) usage was therefore quoted at three-fifths of its real cost —
  on this repo's own run history, which is not all Opus, $124 quoted against a
  real $186. The `(based on Sonnet pricing)`
  label made that honest rather than silently wrong, but it left the figures
  unusable for the before/after comparisons the cost work depends on.
  
  - `@n-dx/llm-client` — `MODEL_COSTS` gains cache-write and cache-read rates,
    so the existing catalog now covers all four billed token kinds for every
    model in `TIER_MODELS` across claude, codex and google. New `model-pricing`
    module exports `resolveModelPricing` (exact id → Claude alias → Codex legacy
    remap → lower-case retry → labelled fallback) and `priceTokens`. Two known under-reporting
    caveats are documented on the table: a 1-hour cache write bills at 2x input
    rather than 1.25x, and long-context surcharges apply above 200K input on
    some models. Neither is recoverable from aggregate token counts.
  - `@n-dx/rex` — token aggregation carries a per-model split (`byModel`) drawn
    from hench per-turn records, which already recorded vendor and model, so a
    run that switched models mid-flight is priced per segment rather than at its
    run-level model. `estimateCost` prices each bucket at its own rates and
    reports a per-model breakdown; tokens with no recorded model, and any
    remainder between the buckets and the totals, form a separate `unattributed`
    line at the fallback rate. An unrecognised model id degrades to that same
    labelled fallback rather than throwing or pricing at zero. `ndx usage` now
    prints the per-model split in place of the blanket Sonnet caveat, and emits
    it in `--format=json`.
  - `@n-dx/web` — the dashboard's duplicate pricing literal is gone; it resolves
    the same fallback rates from the shared table. Its aggregation now carries
    its own per-model split and prices it through rex's arithmetic, so dashboard
    and CLI figures agree for the same runs (see the dashboard-per-model-pricing
    changeset in this release).

## 0.7.0

### Patch Changes

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Export `hasPosixShell` and `resolveShellKind` from `@n-dx/llm-client`. `resolveShellKind` is now the single source of the sh-vs-cmd.exe decision — `buildShellInvocation` derives its `kind` from it — so a caller that validates a command string before `execShellCmd` runs it (hench's command guard) asks the same question the same way.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Send the Gemini API key in the `x-goog-api-key` header, not the URL.
  
  Every Gemini request built the key into the URL query string
  (`…/models/<model>:generateContent?key=<API_KEY>`, and `…/models?key=…` for
  auth validation), where proxies, corporate egress logs, and any future
  URL-logging path record it. The `n-dx config llm.google.api_key` validation
  preflight (`packages/core/config.js`) did the same.
  
  All Gemini fetches — completions, streaming, tool calls, `validateAuth`, and the
  config preflight — now pass the key as the `x-goog-api-key` request header and
  build a key-free URL (streaming keeps `?alt=sse`). Same endpoints, same auth, no
  behaviour change. A test asserts no request URL contains `key=` and the header
  carries the key.
  
  Found by the 2026-09-11 adversarial security review (finding G).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `listWorktrees(cwd)` to `@n-dx/llm-client`: an async helper that parses `git worktree list --porcelain` into `{ path, branch, head, isMain, detached, bare }` entries with realpath-resolved paths, returning `[]` when git is missing or `cwd` is not a repository. Re-exported through hench's `llm-gateway`.

- [#358](https://github.com/en-dash-consulting/n-dx/pull/358) [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d) Thanks [@endash-shal](https://github.com/endash-shal)! - fix(llm-client): stop dropping documented llm.local settings at load time
  
  `extractLocalConfig` whitelists keys, and it only copied `host`, `port`,
  `model`, and `lightModel`. Every other documented `llm.local` setting —
  `timeoutMs`, `maxContextTokens`, `reviewModel`, and the `verifier` block —
  was silently discarded on load: operators set them in `.n-dx.json`, the
  loader dropped them, and the local loop ran on its defaults with no error
  anywhere. Notably this made `llm.local.timeoutMs` (the configurable request
  timeout for slow local models) inert when set via config.
  
  All documented `LocalConfig` fields now survive the load, including
  `timeoutMs: 0` (wait indefinitely), which must not be dropped by a truthiness
  check. The verifier block is validated field-by-field like the rest.

- [#358](https://github.com/en-dash-consulting/n-dx/pull/358) [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the local (LM Studio) per-request timeout configurable via `llm.local.timeoutMs`
  
  Local completions were bounded by a hardcoded 5-minute abort in three places — the
  local API provider, hench's local tool loop, and the second-model verifier (60 s) —
  so a slow local model failed with `NDX_CLI_TIMEOUT` no matter what the CLI-timeout
  settings said. `cli.timeoutMs` / the "CLI Timeouts" page bound a whole command, not
  an individual HTTP request, so setting them to unlimited had no effect on this path.
  
  All three now read `llm.local.timeoutMs` (default 300000, `0` = no timeout), settable
  via `ndx config llm.local.timeoutMs <ms>` or the LLM Provider settings page. The
  timeout error message now names the key to change.

## 0.6.0

### Patch Changes

- [#366](https://github.com/en-dash-consulting/n-dx/pull/366) [`25d7aa6`](https://github.com/en-dash-consulting/n-dx/commit/25d7aa662c414e831fc41dbfc259db94782e0bda) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Spawn the vendor CLI (Claude CLI provider) with `cwd` set to the caller's project directory instead of inheriting the server process's own cwd.
  
  `createLLMClient`/`createClient` now accept an optional `cwd`, threaded through to `cli-provider.ts`'s `spawnCli` call. The dashboard's Ask route (`routes-sourcevision-ask.ts`) passes `ctx.projectDir`, so an Ask request run against a different project no longer executes the CLI wherever `ndx start` happened to be launched from. Hench's own spawn path already passed `cwd` and is unchanged.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Run shell commands in a shell that exists on Windows.
  
  `execShellCmd` hardcoded `sh -c` on every platform. On Windows `sh` ships with
  Git for Windows and is on PATH only inside Git Bash, so from PowerShell or
  cmd.exe — the default shells — the spawn failed with ENOENT. `exec` reported
  that as `exitCode: 1` with empty output, which is indistinguishable from a
  command that ran and failed: hench's test gate concluded the suite was broken
  after essentially every task, and `rex verify` reported `passed: false` for
  tests that never started.
  
  `execShellCmd` now resolves the shell per platform — `sh -c` wherever a POSIX
  shell is resolvable, `cmd.exe /d /s /c` on a Windows box without one. POSIX
  behaviour is unchanged, and Windows machines that have Git for Windows keep
  POSIX semantics rather than being switched to cmd.exe.
  
  `ExecResult` gains `launched`, which is `false` when the command never started.
  Callers that infer pass/fail from `exitCode` alone can no longer mistake an
  unlaunchable command for a failing one; `rex verify` and hench's `run_command`
  now report the two cases differently.
  
  The two remaining sites that spawned `sh` directly (hench's `execShell`, rex's
  `verify`) are routed through `execShellCmd`, and an architecture-policy guard
  fails the build if a new one appears.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Build rex's and sourcevision's LLM prompts through `PromptEnvelope` so their cost
  is attributable per section rather than as one opaque total.
  
  Every prompt in `rex/src/analyze/` and `sourcevision/src/analyzers/` is now
  declared as a list of named sections against a shared per-package vocabulary,
  with the paired `*Prompt` function reduced to an assembly call. Prompt text is
  unchanged apart from removed doubled blank lines, where an absent conditional
  block used to leave its own padding behind — pinned by `prompt-text-identity`
  snapshot suites in both packages.
  
  The section-measurement helpers (`promptSectionCosts`, `dominantPromptSections`,
  `formatPromptSectionCosts`, `extractPromptSectionDiagnostics`) moved down to
  `@n-dx/llm-client` so rex and sourcevision, which sit below hench and cannot
  import from it, share one implementation instead of a copy; hench keeps only its
  CLI rendering and reaches the rest through its existing gateway.
  
  The prompt census now follows module-local helper calls when extracting static
  prompt text. Factoring duplicated text into a helper previously dropped it from
  the count entirely, so a refactor could silently shrink the baseline. Correcting
  this raised the recorded totals ~5% with no prompt growing — the earlier figures
  were an undercount — and the baseline records the revision so the jump is not
  misread as a regression. The baseline also now reports a per-section breakdown
  for each envelope-built package.

- [#360](https://github.com/en-dash-consulting/n-dx/pull/360) [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Bind hench's automatic commits to the checkout the run started in. Run records
  now carry `worktreeRoot`, `branch` and `startHead`, captured at run start, and
  each of the four automatic commit sites (pre-run gate, completion metadata,
  commit-message watcher, review repairs) re-checks them before committing. A run
  whose HEAD has been moved to another branch, detached, or whose worktree root no
  longer matches refuses to commit and reports the expected and actual values,
  leaving the working tree untouched.
  
  `getCurrentHead` and `getCurrentBranch` now capture git's stderr instead of
  inheriting it, matching their `rev-parse` siblings: probing a directory that may
  not be a repository no longer prints `fatal: not a git repository` to the
  terminal.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `POST /api/sourcevision/ask`, answering a question from the existing analysis
  
  The SourceVision Ask panel's server half. The request is
  `{ prompt, seed? }` validated by a zod schema; the response is
  `{ answer, vendor, model, tokens, contextSources }`.
  
  **Bundle, not a tool-use loop.** Context is pre-assembled from the
  `.sourcevision/` artifacts already on disk — manifest, inventory, imports,
  zones, findings, derived next steps, component count, and a `CONTEXT.md`
  excerpt — and sent in a single non-agentic call. A loop that queried lookups on
  demand would answer a wider range of questions, but at an unbounded number of
  round trips per question and with no way to test what the model actually saw. A
  unit test now asserts the assembled facts reach the completion request, which is
  the property the whole endpoint rests on. Every section is capped and reports
  what it cut, so the bundle does not grow with the repository until the vendor
  rejects it as an opaque 400.
  
  **Analysis is the only ground truth.** The endpoint reads no source, and refuses
  with `no_analysis` rather than letting the model answer from its priors when
  nothing has been analysed. All sourcevision access — including the five artifact
  schema types the reads are parsed against — goes through
  `server/domain-gateway.ts`; the gateway's export cap moved 15 → 16 with that
  reason recorded.
  
  **Named failures, and it cannot hang.** Vendor and model come from the project's
  own config via `loadLLMConfig` + `resolveTaskModel` (new `sourcevision.ask`
  class, standard tier, reroutable through `llm.routes`), and the pair that served
  the call is reported back so the panel never has to guess which model produced
  an answer. The call races a budget — `sourcevision.ask.timeoutMs`, default 120s,
  also passed down so a CLI-mode child bounds itself — and every failure returns a
  named `kind` (`timeout`, `rate_limit`, `auth`, `network`, `no_analysis`,
  `invalid_request`, `llm_error`) with the vendor's retry delay when it supplied
  one, instead of a generic 500. A provider that already threw a typed
  `ClaudeClientError` is trusted over re-classifying its message, so a 429 the
  provider knew about is never downgraded to `unknown`.
  
  The task-class registry contract test now scans `web` as well as the three
  domain packages: web declares classes now, and an unregistered one there
  resolves silently to the standard tier exactly as it would anywhere else.

- [#360](https://github.com/en-dash-consulting/n-dx/pull/360) [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `getWorktreeRoot(cwd)` and `getGitCommonDir(cwd)` to the llm-client exec
  helpers, re-exported through hench's llm-gateway.
  
  Both run `git rev-parse` synchronously, matching their `getCurrentHead` /
  `getCurrentBranch` siblings, and return a realpath-resolved absolute path or
  null outside a repository. `getWorktreeRoot` reports the containing worktree's
  own root — a linked worktree's, not the main checkout's — and
  `getGitCommonDir` reports the shared `.git`, which is identical across every
  worktree of one repository. Together they let a caller tell "same repo,
  different worktree" from "different repo", which is what binding a hench run's
  automatic commits to the worktree it started in requires.

## 0.5.2

### Patch Changes

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop emitting `--full-auto`, which `codex exec` no longer accepts.
  
  `compileCodexPolicyFlags` returned `["--full-auto"]` for `workspace-write` +
  `never` — the autonomous default. codex-cli 0.147.0 removed that flag from
  `codex exec`, so every unattended codex spawn died on argument parsing before
  reaching the model: `error: unexpected argument '--full-auto' found`. The whole
  codex agent path was broken.
  
  Both halves of the policy are now stated explicitly — `--sandbox <mode>` plus
  `-c approval_policy=<value>`, since `codex exec` has no approval flag. That is
  also more robust than a preset: a preset is a name codex can retire, while
  `--sandbox` and `approval_policy` are the settings it was composed from. The
  one preset kept is `danger-full-access` + `never` →
  `--dangerously-bypass-approvals-and-sandbox`, still on the exec surface and the
  only way to express "no sandbox at all".
  
  `mapApprovalToCodexFlag` returned `"default"` and `"full-auto"` — names of exec
  flags, not `approval_policy` values, and both gone. It now returns the config
  values codex accepts (`on-request`, `never`), read off the CLI's own rejection
  message, and the compiler uses it so the mapping is single-sourced.
  
  The gap that let this ship was that every test asserted our flags against our
  own expectations. A new integration test scrapes `--help` from the *installed*
  codex and asserts each flag we emit is one that binary accepts, for both `exec`
  and `exec resume` — so the next arg-surface drift fails a test instead of
  silently breaking every run. It skips when codex is absent, and says so.
  
  Verified end to end against codex-cli 0.147.0: a real autonomous spawn now
  exits 0 with `turn.completed`, and resuming that thread answers from the prior
  turn with 85% of input tokens served from cache — the batch session strategy
  working on codex for the first time.

- [#347](https://github.com/en-dash-consulting/n-dx/pull/347) [`f0cf5d3`](https://github.com/en-dash-consulting/n-dx/commit/f0cf5d3bab556b80251a47206ad5fdc0ee587e93) Thanks [@jeremylumanbailey](https://github.com/jeremylumanbailey)! - Fix Codex provider spawning codex exec --full-auto, which the Codex CLI removed entirely. compileCodexPolicyFlags now emits --sandbox workspace-write for the default execution policy instead of the removed flag.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `resolveTaskModel` — the class→tier→model resolution layer over
  `resolveVendorModel`.
  
  Call sites declare what kind of work a call is (a task class such as
  `prd.rename` or `git.commit-message`), config maps classes to tiers, and the
  vendor catalog maps tiers to models. Ships the built-in `DEFAULT_ROUTES`
  registry (mechanical single-shot classes → light; judgment work → standard;
  `agent.execute` stays standard until telemetry justifies heavy), new
  `LLMConfig` surfaces (`tiers` per-vendor tier→model overrides including the
  `free` tier, `routes` with exact-then-longest-glob-prefix matching, `effort`
  per class, `escalation` policy shape), and never-throw semantics: unknown
  classes route to standard, unknown tier names degrade to standard, a `free`
  route without a configured model falls through to light, and vendors that
  cannot distinguish tiers resolve to the nearest available model. This makes
  the previously unreachable heavy tier reachable via
  `llm.routes["agent.execute"] = "heavy"` with no code change.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Thread task classes through every package's LLM choke point, and pass the
  routing config surfaces through the `.n-dx.json` loader.
  
  rex's `spawnClaude`/`resolveConfiguredModel` accept `{ taskClass }` alongside
  the legacy bare weight (the class wins; an explicit model still beats both),
  and the analyze call sites now declare their classes — renames, merges,
  consolidation checks, assessment, and clarify rounds route light by registry
  default exactly as before, while proposals, modify, spec synthesis, smart-add,
  and restructuring declare their standard-tier classes. `prd.decompose` is
  deliberately not declared yet: its registry default is light, and that flip is
  gated on the escalation ladder. sourcevision's `callClaude` gains the same
  option, `resolveLightModel` now resolves through `zone.enrich-scan`, and the
  enrichment passes and meta-evaluation declare their classes. hench resolves
  the agent loop via `agent.execute` (standard by default — but
  `llm.routes["agent.execute"] = "heavy"` now reroutes a run with no code
  change), the pre-run commit message via `git.commit-message`, and CLI-path
  run records carry the resolved tier in `weight` instead of always "standard".
  `loadLLMConfig` passes `llm.tiers`, `llm.routes`, `llm.effort`, and
  `llm.escalation` through its whitelist so the new config actually reaches
  runtime. A repo-level contract test walks declared task classes and fails on
  any class missing from `DEFAULT_ROUTES` or any choke point that stops
  declaring its classes.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Guard the tier catalog against drifting out of the cost and context-window
  tables.
  
  Bumping a tier constant to a newer model is an edit this repository has already
  made twice — `claude-opus-4-7` → `claude-opus-5`, and `gpt-5.5` →
  `gpt-5.6-terra`. Nothing required the matching `MODEL_COSTS` and
  `MODEL_CONTEXT_WINDOWS` entries to be added alongside, and nothing failed when
  they were missing.
  
  The consequence would have been quiet. `budgetPreflight` falls back to a 128K
  window for an unlisted model, so a 200K-token prompt bound for a 1M-context
  model is reported as not fitting and rejected as too large, while
  `estimatedCostUsd` becomes undefined and cost estimation stops without saying
  so — all with a green suite.
  
  A new test iterates every tier the catalog can resolve to and asserts both
  tables cover it, skipping the local vendor's deliberately empty entries.
  `GOOGLE_MODELS` is folded into the same rule: the previous coverage assertion
  reached the google tiers and nothing else, which is exactly the asymmetry that
  let claude and codex drift unguarded. The two tables are also checked against
  each other, since a model priced but unsized breaks a different half of
  preflight.
  
  No production behaviour changes. The runtime fallbacks are deliberately left
  alone: `llm.tiers.<vendor>.<tier>` lets a project point a tier at any model id,
  including one this catalog has never heard of, so those must keep working. It
  is the built-in catalog that needs enforcing, and only a test can enforce that.

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
