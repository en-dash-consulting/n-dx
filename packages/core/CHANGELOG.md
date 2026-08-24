# @n-dx/core

## 0.5.0

### Patch Changes

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Surface concise re-authentication guidance when a provider rejects credentials, and stop dumping raw JSON error payloads.
  
  A new canonical helper in `@n-dx/llm-client` (`authFailureGuidance` / `authFailureMessage`) is the single source of truth for auth-failure wording: it names the provider, states the cause (`Invalid or expired credentials`), and gives the exact fix — `claude logout && claude login`, `codex logout && codex login`, or `ndx config llm.google.api_key <KEY>`. Every entry point now reads identically:
  
  - **`ndx init` / `ndx config llm.vendor`** — the core preflight (`packages/core/config.js`) replaces the verbose `Details: <raw JSON>` dump with the concise, ANSI-colored guidance (red headline, yellow remediation). The NDX error code (e.g. `NDX_CLAUDE_PREFLIGHT_AUTH_REQUIRED`) is demoted to a dim secondary line instead of the headline, and JSON payloads are never printed. A missing Google key gets a distinct "No API key configured" message.
  - **`ndx work`** — the runtime LLM providers already throw `AuthFailureError`; its message is now the canonical, JSON-free line.
  - **`ndx plan` / `ndx analyze`** — rex/sourcevision route auth errors through the shared classifier and (for rex) render `AuthFailureError` with the shared remediation.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Detect the project's CLI command name from the package.json bin field and record it as cli.name in .n-dx.json during init; manual overrides via `ndx config cli.name` are preserved.

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

- [#309](https://github.com/en-dash-consulting/n-dx/pull/309) [`56a63ea`](https://github.com/en-dash-consulting/n-dx/commit/56a63ea6ef7911166578df2d5bab88e5d6c89d04) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Close out Codex workflow parity ([#122](https://github.com/en-dash-consulting/n-dx/issues/122)) and fix the skill-tracking asymmetry ([#284](https://github.com/en-dash-consulting/n-dx/issues/284)).
  
  - **Body-drift regression test** — a new e2e test regenerates the assistant artifacts from the canonical source (`assistant-assets/`) and asserts the committed `CLAUDE.md`, `AGENTS.md`, and every vendor `SKILL.md` match the generator. This closes the last acceptance gap of [#122](https://github.com/en-dash-consulting/n-dx/issues/122) (tests now fail on body drift, not just inventory drift). It immediately caught a real drift: the committed `CLAUDE.md` carried a `## Changeset Versioning` section that was never in the canonical `project-guidance.md`, so `AGENTS.md` silently lacked it — that section is now in the shared source and both instruction files carry it.
  - **[#284](https://github.com/en-dash-consulting/n-dx/issues/284) — commit both:** the generated Claude `ndx-*` skills were gitignored while the Codex skills were committed, so cloned checkouts lacked the `/ndx-*` skills for Claude until re-init. `.claude/skills/` is removed from `.gitignore`, the generated skills are committed (and LF-pinned in `.gitattributes`, matching `.agents/skills/`), and `ndx init` now warns via `checkSkillTracking()` when an enabled assistant's skill directory is gitignored.
  - **Docs sweep:** the web package README and the troubleshooting guide no longer describe MCP setup as Claude-only.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Make `ndx export` work on Windows.
  
  `ndx export --deploy=github` could not succeed on Windows. Two independent blockers, both now fixed and both verified end-to-end.
  
  **1. The dynamic import aborted the command immediately.** `export.js` did `await import(resolvePackagePath(...))` with a bare absolute path, and Node's ESM loader rejects that on Windows:
  
  ```
  ERR_UNSUPPORTED_ESM_URL_SCHEME … Received protocol 'c:'
  ```
  
  The command died before doing any work — before generating the dashboard, let alone deploying. Now wrapped in `pathToFileURL(...).href`, the same fix `tests/e2e/published-package-loadability.test.js` already applies for this exact error. This was not in the original bug report; it surfaced only when the flow was actually run on Windows.
  
  **2. POSIX-only shell commands in the deploy path.**
  
  - `rm -rf "<path>"` per worktree entry. `rm` is not a cmd.exe command, and although Git for Windows ships `usr/bin/rm.exe` it is not normally on PATH. With no try/catch this threw and aborted the deploy. Replaced with `rmSync(path, { recursive: true, force: true })` — no shell at all, and `force: true` carries the `-f` intent.
  - `git rm -rf . 2>/dev/null || true`. Both `2>/dev/null` and `|| true` are POSIX sh constructs. The tolerate-failure intent moved into a JS `try/catch`, which is also clearer about *why* it is tolerated: a fresh orphan branch legitimately has nothing to remove.
  
  **All 16 remaining `execSync` command strings converted to argv** via `execFileSyncCli` from `win-spawn.js`. The interpolated ones hand-quoted paths (`tmpWorktree`, `dir`) that break on Windows when a project path ends in a backslash — the trailing backslash escapes its own closing quote — or contains `&`/`^`. `rex` also needs the `.cmd` shim handling that helper provides.
  
  Worth stating precisely: the unquoted `${branch}` interpolations were **not** an injection vector, because `branch` is the hardcoded constant `"n-dx-dashboard"`. The genuine risk was the project-derived paths.
  
  `export.js` is no longer exempt from the shell-string architecture guard; that exemption was retired rather than left standing.
  
  Verified against a scratch repository with a **local bare `origin`**, from a project directory named `e & p (v2)` — a space, an `&`, and parentheses. Both deploy routes pass: the orphan-branch creation path on first run, and the existing-branch `worktree add` path on the second. 28 files pushed, no `.ndx-deploy-tmp` left behind. No real deploy target was ever contacted.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Route `ndx init`'s Claude CLI invocations through the Windows-safe spawn helper.
  
  `packages/core/claude-integration.js` built six `execSync` command strings by hand — the MCP `remove`/`add` registration pair and four `--version` discovery probes. Every argument involved is a filesystem path (the claude binary, the resolved MCP entrypoint, the project directory), and the surrounding quoting was a bare `"`:
  
  ```js
  execSync(`"${claudeCmd}" mcp add ${name} -- node "${bin}" ${descriptor.mcpCommand} "${absDir}"`)
  ```
  
  A project directory ending in a backslash — `C:\Users\Tom&Jerry\my proj (v2)\` — produces `..."C:\Users\Tom&Jerry\my proj (v2)\"`, where the trailing backslash escapes its own closing quote. Argument parsing corrupts from that point on, and the command can still exit 0, so `ndx init` reports "registered" having stored a truncated command. All six now use `execFileSyncCli` from `win-spawn.js`, which applies the `quoteWindowsToken`/ArgvQuote rules and logs each invocation itself.
  
  Verified against that exact path: the argv form emits `"...(v2)\\"` with the backslash doubled, keeps every `&` inside a quoted token, and round-trips 9 argv entries to 9 command-line tokens.
  
  The unquoted interpolations in the old strings (`${scope}`, `${name}`, `${descriptor.mcpCommand}`) were manifest-derived constants rather than user input, so this was a correctness bug on unusual-but-legal paths, not a user-input injection vector.
  
  **The guard that should have caught it is now scan-based.** `architecture-policy.test.js` walked a hardcoded 12-file `DEP0190_SCOPE`, so it only ratcheted over files someone remembered to enumerate — which is exactly how `claude-integration.js` and `export.js` kept hand-built command lines through an entire Windows-hardening epic. It now scans the whole production tree for:
  
  - imports of `exec`/`execSync` from `child_process` (the string-command APIs — `execFile`/`execFileSync`/`spawn` take argv and are fine)
  - `shell: process.platform`
  - `shell: true` with non-empty args
  
  Exemptions moved into a `SHELL_STRING_EXEMPT` map where each entry states its reason, with the previously-undocumented `ci.js` and `pr-check.js` pnpm cases now recorded explicitly and `export.js` naming the task that will retire it. Demonstrated red-then-green against a newly added unhardened file, with no edit to the guard required to catch it.
  
  `claude-integration.js` was also dropped from the `child_process` import allowlists in `architecture-policy.test.js` and `ci.js` — it no longer imports any `child_process` API, so the permission was removed rather than left permitted-but-unused.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop printing the child-lifecycle process-group warning on every Windows `ndx` invocation.
  
  `packages/core/cli.js` builds its child-process tracker with `processGroups: true` at module load, and `createChildProcessTracker` emitted the fallback notice at construction time. Because `PLATFORM_SUPPORTS_PROCESS_GROUPS` is always `false` on win32, every command — including `ndx --version`, `ndx --help`, and `ndx status`, none of which spawn a child — prefixed its output with:
  
  ```
  [child-lifecycle] process group cleanup is not supported on this platform; falling back to direct child kill
  ```
  
  The message read as a degradation, but direct child kill is the intended Windows path — `cli.js` already omits `detached: true` on win32 by design, so there was nothing for users to act on.
  
  The notice is now opt-in behind `NDX_DEBUG_LIFECYCLE` (or the global `NDX_DEBUG`), matching the existing `NDX_DEBUG_LLM` / `NDX_DEBUG` convention in `@n-dx/llm-client`. Set either to `1`, `true`, or `yes` to restore it when diagnosing child-cleanup behavior. Termination behavior is unchanged on all platforms; only the logging is gated. The `stripKnownRuntimeNoise` filter in `scripts/cli-smoke-parity.mjs` is retained so smoke output stays comparable against older installs and debug-enabled runs.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Register MCP servers using the discovered claude CLI path instead of a bare `claude` literal. `registerMcpServers` computed `claudeCmd = discovery.path` but the `claude mcp remove` / `claude mcp add` commands still shelled out to the literal string `claude`, requiring it on `PATH`. When `discoverClaudeCli` resolved claude at a well-known location that is not on `PATH` — notably Windows `%APPDATA%\npm\claude.cmd` / `claude.exe`, but also nvm and Homebrew installs — `ndx init` silently failed to register the rex and sourcevision MCP servers even though discovery had succeeded. Both commands now invoke the quoted discovered path, so MCP registration works on installs where claude is not on `PATH`.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Route `ndx start`'s port-occupant kill through the Windows-safe spawn helper.
  
  `killPortOccupant()` in `packages/core/web.js` arrived with the local-LLM-provider merge and built four command strings by hand:
  
  ```js
  execSync(`netstat -ano`, …)
  execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" })
  execSync(`lsof -ti tcp:${port}`, …)
  execSync(`kill -9 ${pid}`, { stdio: "ignore" })
  ```
  
  Unlike the earlier `claude-integration.js` and `export.js` conversions, there is no live defect here: `port` is `parseInt(flags.port, 10)` or a `typeof number`-validated config value, and both `pid` values are `parseInt` results, so no interpolation can carry `&`, `^`, `(`, `)`, `!`, or a trailing backslash into a shell command line. This is the blanket `exec`/`execSync` policy being applied to new code rather than a bug being fixed — the point of a scan-based guard is that new files do not get to opt out on the argument that their particular interpolations happen to be safe today.
  
  `netstat`, `taskkill`, and `lsof` now go through `execFileSyncCli` from `win-spawn.js` with argv. The POSIX kill drops its subprocess entirely in favour of `process.kill(pid, "SIGKILL")` — spawning `/bin/kill` to deliver a signal to a pid already in hand added a dependency on the binary being present for nothing. Failure behaviour is unchanged: `execFileSyncCli` throws on a non-zero exit exactly as `execSync` did (`lsof -ti` exits 1 when nothing is listening), and the whole body is already wrapped in a `try`/`catch` that returns `false`.
  
  Caught by `architecture-policy.test.js`'s scan-based shell-string guard as a semantic merge conflict — the two sides never touched the same lines, so the merge produced a tree that typechecked and passed every package test suite while violating a policy one of the branches had just added. Verified red-then-green against the guard (`packages/core/web.js — imports \`execSync\` from child_process` → 56/56 passing), with the full root suite green at 97 files.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix a POSIX process-group leak where surviving grandchildren were never force-killed.
  
  `terminateProcessGroup` sent SIGTERM to the child's process group, then decided whether to escalate to SIGKILL by checking the **direct child**:
  
  ```js
  await Promise.race([waitForChildExit(child), delay(forceKillTimeoutMs)]);
  if (!isChildRunning(child)) return;            // gates on the child
  try { killGroup(-child.pid, "SIGKILL"); }      // escalation for the group
  ```
  
  The leader commonly installs a SIGTERM handler and exits promptly while a grandchild ignores the signal — routine for long-running CLIs, including the claude/codex processes `ndx` spawns. The child's exit resolved the wait, the early return fired, and SIGKILL never reached the group, stranding every surviving member. That is the precise leak process groups exist to prevent.
  
  Escalation now depends on the group: `groupHasMembers()` probes with signal 0 (a kernel existence check that delivers nothing) and `waitForGroupExit()` polls it on a bounded deadline instead of awaiting the child's `exit` event, so all members get the grace period and SIGKILL lands whenever anyone is left.
  
  This is POSIX signal semantics, so it affected **macOS as well as Linux**.
  
  PID-reuse safety is documented at the probe: a pgid stays allocated while its group has members, and a pgid is its leader's PID, so that PID cannot be recycled while anyone remains in the group — probing immediately before signalling cannot target an unrelated process. If the group drains in between, the signal fails ESRCH and is swallowed.
  
  The Windows `taskkill /T /F` path is unchanged.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Terminate the whole process tree on Windows, behind one cross-OS contract.
  
  `child-lifecycle.js` previously exported `PLATFORM_SUPPORTS_PROCESS_GROUPS` and picked its termination strategy from it, so Windows silently got **direct child kill only** — any grandchild spawned by a tracked child was orphaned. Since `ndx` spawns CLIs that themselves spawn processes (claude/codex), that leak was real rather than theoretical.
  
  A single `terminateTree(child, options)` now owns the decision: POSIX signals the process group (`process.kill(-pgid)`, SIGTERM then SIGKILL); Windows runs `taskkill /PID <pid> /T /F` through `win-spawn.js`. Both fall back to killing the direct child if the tree-wide attempt fails or leaves it running. `PLATFORM_SUPPORTS_PROCESS_GROUPS` is no longer exported, and the `processGroups` tracker option is renamed `treeKill` — it named a POSIX mechanism that does not exist on Windows, where tree-killing nonetheless works.
  
  `cli.js` no longer branches on `process.platform` for termination: the `detached: true` decision moved into an exported `treeKillSpawnOptions()`, so the platform difference lives in the termination layer that owns it.
  
  Also removes the construction-time stderr notice entirely. Gating it behind `NDX_DEBUG_LIFECYCLE` (previous release) stopped it appearing on every command, but its text — "falling back to direct child kill" — is now simply false on Windows. Strategy reporting moved to `terminateTree`, where it names the strategy at the moment one actually runs.
  
  Documented Windows limitations, rather than papered over:
  
  - **No graceful phase.** `taskkill /T` without `/F` posts WM_CLOSE, which only a process pumping a window-message loop acts on — Node children do not — and `process.kill(pid, "SIGTERM")` is `TerminateProcess` anyway. A graceful pass would burn the grace period for nothing, so Windows goes straight to `/F`.
  - **Job Objects not used.** They are the architecturally correct primitive (kill-on-job-close is exactly analogous to a process group) but need a native addon, which would put a compiled dependency in a pure-JS orchestration package.
  - **Shutdown-time dependency.** taskkill is spawned during cleanup; if the `ndx` process is itself force-killed, no handler runs and the tree survives unless the host contained it.
  
  The `platform`, `spawnCliImpl`, and `killGroup` seams are injectable so **both** OS strategies are testable on any host — CI runs the suite on Linux only, so without them the Windows branch would ship unexercised.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Actually restrict API-key file permissions on Windows, instead of only claiming to.
  
  `config.js` called `chmod(path, 0o600)` after writing `.n-dx.json` whenever it held a provider API key, and `ndx config --help` stated "File permissions set to 0600 (owner-only) for security" unconditionally. On Windows both were false. Measured on Windows 11:
  
  ```
  after chmod(path, 0o600):
    mode reads back as 0666        (not 0600)
    icacls:  SYSTEM:(I)(F)  BUILTIN\Administrators:(I)(F)  <user>:(I)(F)
  ```
  
  Every entry is `(I)` — inherited. `fs.chmod` cannot express a POSIX mode on Windows; it maps only the read-only attribute and never touches the DACL. So the API key stayed readable by SYSTEM and every administrator while the help text promised owner-only, and the two tests that would have caught it were `it.skipIf(win32)`.
  
  A new `file-permissions.js` module now **attempts and then verifies** the restriction, reporting what it actually achieved:
  
  - **POSIX** — `chmod` to 0600, then confirm via `stat` that the mode landed (FAT/exFAT mounts and some network shares silently drop mode changes).
  - **Windows** — `icacls <path> /inheritance:r /grant:r <DOMAIN\user>:F` through `win-spawn.js`, then read the DACL back and require no inherited `(I)` entries and no principal other than the current user. The exit code is not trusted: icacls reports "Successfully processed 1 files" in cases where the resulting ACL is not what was requested.
  
  When verification fails, the user is warned at the point of writing — naming the file, the cause, and the safer alternative (`ANTHROPIC_API_KEY`, or Credential Manager on Windows). A false assurance about an API key is worse than a stated limitation. The help text now describes what the running platform actually does.
  
  Verified end-to-end: a real `ndx config claude.api_key` on Windows now produces a file whose ACL is exactly `<user>:(F)`.
  
  Also resolves the related `cli_path` executable check. `access(value, X_OK)` **succeeds for a plain JSON file** on Windows — Node documents X_OK as having no effect there, so it degrades to `F_OK` and the check could never reject anything, while advising "Run: chmod +x". It is now explicitly skipped on Windows via `executableBitIsMeaningful()` with the reasoning recorded. Requiring a PATHEXT extension instead was rejected: it would refuse the extensionless POSIX scripts that pnpm/npm global installs place beside their `.CMD` shims, and a validation that rejects valid input is worse than none — spawn-time diagnostics already cover the rest.
  
  All four Windows skips in `tests/e2e/cli-config.test.js` are gone (143 passing, 0 skipped): the permission assertions now check mode on POSIX and the DACL on Windows, and the executable-bit case asserts the documented Windows behaviour rather than being silently skipped.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Make a command timeout actually stop the command, descendants included.
  
  `exec` delegated its timeout to Node's `execFile`, which signals only the process it spawned. Anything that process had itself started survived — kept running, kept holding file handles, kept writing to the workspace — while the caller had already been told the command stopped. Measured on Windows with a 400ms timeout: the reported result was `Command timed out after 400ms`, yet the surviving process went on to write four more times, and a temp directory it held could not be removed for 52 seconds.
  
  That report is what an autonomous agent acts on. It reads files and runs the next command believing the previous one finished, so a build or codemod still writing underneath it can corrupt the state being read.
  
  `exec` now owns the timeout timer and terminates the whole process tree when it fires: a process-group signal on POSIX (`SIGTERM`, escalating to `SIGKILL`, waiting on the *group* rather than the direct child), and `taskkill /T /F` on Windows. `exitCode: null` still signals a timeout, and an externally-killed child still reports the same way it always did. Opt out with `treeKill: false` when a child must stay in the caller's own process group.
  
  Not a Windows-only fix, though Windows is where it was caught: the orphan survived on POSIX too, just invisibly, because unlinking open files is permitted there so no EBUSY drew attention to it. On Windows, libuv's global job object masks the problem for node-spawned node, but not for the cases that matter — `sh`, `cmd`, `make`, and pnpm/npm shims all leave their children behind.
  
  The primitive is exported as `terminateProcessTree` / `treeKillSpawnOptions`. It is a deliberate twin of `terminateTree` in `packages/core/child-lifecycle.js`, since the orchestration tier must not import from packages; a parity test fails if the two diverge.

- [#309](https://github.com/en-dash-consulting/n-dx/pull/309) [`56a63ea`](https://github.com/en-dash-consulting/n-dx/commit/56a63ea6ef7911166578df2d5bab88e5d6c89d04) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Complete the `.gitattributes` LF-pin coverage (follow-up to [#283](https://github.com/en-dash-consulting/n-dx/issues/283)/[#285](https://github.com/en-dash-consulting/n-dx/issues/285)). Three n-dx-written surfaces were writing LF but had no eol pin, so Windows checkouts (`core.autocrlf=true`) showed line-ending-only churn on every tool write:
  
  - `.claude/skills/**/*.md` — generated Claude skills (now committed per [#284](https://github.com/en-dash-consulting/n-dx/issues/284))
  - `.codex/config.toml` — generated Codex MCP config
  - `.sourcevision/**/*.txt` — sourcevision text output (e.g. `llms.txt`)
  
  All three are added to both `GITATTRIBUTES_EOL_RULES` (the list `ndx init` injects into a project's `.gitattributes`) and n-dx's own `.gitattributes`, keeping the two in sync per the stated invariant.
  
  The root cause of the pins shipping incomplete was that these two sources drifted apart — one updated, the other not — and no test caught it. To close that class of bug for good:
  
  - The rules are extracted into a single importable source of truth (`packages/core/gitattributes-pins.js`), imported by `cli.js`.
  - A **sync-guard test** (`prd-line-endings.test.js`) asserts the injector's pattern set equals n-dx's own `.gitattributes` `eol=lf` pattern set — any future divergence fails CI, not just the three patterns fixed today. `cli-init.test.js` also asserts the new patterns are injected.

- [#285](https://github.com/en-dash-consulting/n-dx/pull/285) [`437c27a`](https://github.com/en-dash-consulting/n-dx/commit/437c27a7645e2db0ab6b666384e1f210cc4ff21f) Thanks [@stevemikedan](https://github.com/stevemikedan)! - `ndx init` now writes (or merges into) the target project's `.gitattributes`, pinning every n-dx-written tracked file (`.rex/`, `.hench/`, `.sourcevision/`, `.n-dx.json`, `AGENTS.md`, `CLAUDE.md`, `.agents/`) to `text eol=lf`. This stops Windows checkouts (`core.autocrlf=true`) from showing spurious line-ending-only modifications after every tool write. Existing `.gitattributes` content is preserved and user rules for overlapping patterns win; re-running `ndx init` is idempotent.

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the hench pre-run commit gate size-aware with configurable thresholds.
  
  The gate now measures change magnitude (dirty file count plus lines changed vs HEAD via `git diff --numstat`, shared helper `measureChangeMagnitude`) instead of reacting only to a non-empty dirty list. Two new persisted settings under `hench.git.*` (`.hench/config.json`, editable via `ndx config`):
  
  - **`hench.git.checkpointThreshold`** (default: 200, 0 disables) — at/above this many changed lines, the interactive prompt warns about the change size and defaults to committing a checkpoint instead of proceeding. Below the threshold, behavior is unchanged.
  - **`hench.git.requireCleanTree`** (default: false) — refuse to start against a dirty tree: the interactive prompt drops the "proceed" option and non-interactive runs (`--yes`, piped) abort.
  
  Autonomous runs (`--auto`/`--loop`/`--epic-by-epic`) keep today's behavior — abort on any dirty tree unless `--allow-dirty` — but the refusal now reports the measured magnitude. `--allow-dirty` takes precedence over both config settings for a single run (flag > config > defaults). Documented in `hench run --help` and `ndx config --help`.

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

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a dashboard "Refresh Data" trigger: new `ndx refresh --live-server` mode skips the pre-refresh server termination and refuses UI-rebuild plans, and the web dashboard gains POST /api/commands/refresh (+ status poll) with a Refresh Data panel in the Commands view.

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `ndx auth` — on-demand credential verification for the active LLM vendor.
  
  The command re-runs the same provider auth preflight used by `ndx init` / `ndx config llm.vendor` and exits 0 when credentials are valid (printing the active vendor, resolved model, and "credentials valid") or 1 on failure (printing the canonical, JSON-free auth-failure guidance). It works without an initialized project — the default vendor (claude) is checked when no config exists.
  
  Every vendor's auth-failure remediation (and the flattened `authFailureMessage` used by runtime errors) now ends with the canonical verification step `Verify credentials: ndx auth`, exported from `@n-dx/llm-client` as `VERIFY_CREDENTIALS_STEP`, so users always know how to confirm a fix.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard command triggers (refresh, ci, auth, self-heal, export) now resolve the ndx CLI on analyzed projects that aren't the n-dx monorepo: cli.js advertises its own path to child processes via `N_DX_CLI_PATH`, and the server's resolver tries the project-local bin, that env path, and `@n-dx/core/cli.js` from its module graph before the monorepo dogfood fallback.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop `ndx pair-programming` orphaning processes when a reviewer CLI or test command times out.
  
  All three timeout paths in `pair-programming.js` signalled only the direct child with a bare `child.kill("SIGTERM")`. That was four separate defects: no tree kill, so descendants survived; no process group to signal on POSIX; no escalation, so a child that ignores SIGTERM outlived its own timeout indefinitely; and `resolve()` on the line after `kill()`, so the caller saw `timedOut: true` while the tree was still running and still holding the workspace and any port it had bound.
  
  `runShellTestCommand` was the worst of the three and broken deterministically rather than by race: it spawns with `shell: true`, so the child being signalled *is* the shell and never the test command beneath it. A timed-out `npm test` kept building with its output pipe already abandoned.
  
  All three now terminate through `child-lifecycle.js`'s `terminateTree` — process group on POSIX, `taskkill /T` on Windows, escalating to SIGKILL — and **await** it before resolving, so `timedOut` cannot be observed while the tree is alive. Each spawn passes `treeKillSpawnOptions()` so the POSIX group-signal path has a group to signal.
  
  Detaching for that group had a catch worth naming: a detached child leaves this process's foreground group, so Ctrl-C would no longer have reached it — trading a timeout orphan for an interrupt orphan. `cli.js` now registers these children with the tracker whose SIGINT/SIGTERM/SIGHUP handlers already terminate tracked trees, via a new `registerChild` injection seam.
  
  Covered by real-process tests (`tests/e2e/pair-programming-timeout-tree-kill.test.js`) that assert the grandchild is dead *without polling* — the promise settling early is precisely the defect — and that a SIGTERM-ignoring command still dies.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a BETA option to make the POSIX timeout kill definitive: freeze the process tree, prove it is frozen, then kill it. **Off by default.**
  
  It ships behind a flag because the sweep it replaces has far more mileage: the freeze path's unit coverage injects its seams, and its behaviour against real POSIX processes is not yet proven in CI. Enable per-project with `ndx config experimental.posixFreezeTreeKill true`, or for a single run with `NDX_POSIX_FREEZE_KILL=1`. `ndx config --help` documents it as BETA and NOT RIGOROUSLY TESTED so nobody turns it on unaware.
  
  The previous approach enumerated descendants and signalled them, which is inference. Its hole is reparenting: a descendant whose parent dies is adopted by init, so the pid→ppid link the enumeration depends on dissolves at exactly the moment the killing starts. The old code collected descendants *before* signalling to work around that; freezing first removes it, because reparenting only happens when a parent exits and nothing exits until enumeration is finished.
  
  On timeout, `exec` now SIGSTOPs the tree, closes over its descendants to a fixpoint — a pass that discovers nothing, rather than a fixed number of rounds — verifies every member reads as stopped in the process table, and only then SIGKILLs, leaves before parents. It terminates because SIGSTOP cannot be caught, blocked, or ignored and a stopped process cannot fork, so new arrivals can only come from processes that were still running at the previous read, and that set shrinks monotonically. When the child *is* a process-group leader the fast path skips enumeration entirely: group membership is inherited rather than listed, so `SIGSTOP` then `SIGKILL` on the group are atomic over the whole tree.
  
  SIGKILL, never SIGTERM: a stopped process does not act on SIGTERM — the signal queues until SIGCONT — so a "graceful" attempt against a frozen tree is a silent no-op. Freezing and graceful termination are therefore mutually exclusive, and this policy is opt-in via `freeze` on `terminateProcessTree`, used only for timeouts and runaways. Graceful shutdown keeps its SIGTERM grace period unchanged, and a test pins that the two policies stay distinct.
  
  Windows is unchanged. It has no pure-JS pause — libuv maps the signals it supports onto TerminateProcess, and the real equivalents all need native code — so `taskkill /T` remains a tree walk. Its failure mode is the mirror image of POSIX's and is now documented where taskkill is invoked: Windows never reparents, so a link survives its parent's death and can dangle onto a recycled pid.
  
  Known limit, recorded in the code: a deliberate double-fork daemon escapes parentage by design and no enumeration finds it. That is a policy question about whether agent-run commands may daemonize, not a detection one.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Reconcile Codex model identifiers across the config surface. Removed the dead `gpt-5.4mini` legacy alias from `LEGACY_CODEX_MODEL_ALIASES` (its target `gpt-5.4-mini` is already a direct catalog model and the non-hyphen key was never a shipped ID). The remaining legacy brand IDs (`gpt-5-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`) now match the orchestration-tier list in `init-llm.js`, with cross-reference comments pinning the two tiers together. Updated the hench vendor-compatibility error hint from the outdated `gpt-4o, o1` to current Codex models (`gpt-5.5, gpt-5.4-mini`).

- [#279](https://github.com/en-dash-consulting/n-dx/pull/279) [`18b36f7`](https://github.com/en-dash-consulting/n-dx/commit/18b36f73c0b18bdf508b956e3fb42e5bbf5aeabd) Thanks [@endash-shal](https://github.com/endash-shal)! - Refresh the Claude model catalog shown in `ndx init` and align the runtime default. Adds **Claude Fable 5** (`claude-fable-5`) and **Claude Sonnet 5** (`claude-sonnet-5`) to the selector, and promotes Sonnet 5 to the recommended default (replacing the previous-generation Sonnet 4.6 as the pre-selected model and as `DEFAULT_CLAUDE_MODEL` / `NEWEST_MODELS.claude`). Sonnet 5's 1M context window and pricing are registered for budget preflight. `claude-sonnet-4-6` remains a valid, accepted model id (kept in the context/cost maps and added to the init legacy-alias list) so existing configs and `--claude-model=claude-sonnet-4-6` keep working without warnings. Codex and Gemini catalogs are unchanged.

- [#324](https://github.com/en-dash-consulting/n-dx/pull/324) [`e35c1c1`](https://github.com/en-dash-consulting/n-dx/commit/e35c1c1f86ed2a831b039acc906b3431d5c1d3e1) Thanks [@en-drza](https://github.com/en-drza)! - Add sample app installation feature with dashboard tutorial and optimize CLI resolution path

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Self-heal and n-dx workflow visibility in the dashboard. The dashboard can now run and observe the full n-dx flow: self-heal with live iteration/phase progress and a stop control, full sourcevision analysis with async progress, rex fix/reshape/CI actions with dry-run previews, a Commands reference with inline run triggers, and views for the previously UI-less requirements, adaptive-optimization, and activity-log APIs. Command references throughout the dashboard and hench prompts resolve from the project's detected CLI name.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx start stop` now terminates the background server's children, not just the recorded PID.
  
  The stop path signalled only the PID from `.n-dx-web.pid`. On Windows that is doubly insufficient: SIGTERM is `TerminateProcess`, so the server never ran its cleanup handlers, and nothing walked the tree — so any `rex analyze` or `hench run` the server had spawned survived, potentially holding the port or the workspace. The server is also started `detached: true`, which places it outside libuv's job object, so nothing else would have reaped those children either.
  
  Stop now routes through a shared `terminateTreeByPid` in `child-lifecycle.js`: `taskkill /T` on Windows, a process-group signal on POSIX. Grace periods are unchanged — `ndx start stop` keeps its 2s default and the `N_DX_STOP_GRACE_MS` override, deliberately shorter than the 5s used for shutdown, so consolidating the mechanism does not change stop latency.
  
  There were three copies of the SIGTERM → grace → SIGKILL escalation (`child-lifecycle.js`, `web.js`, `cli.js`); there is now one, written against injected signal/liveness/wait capabilities so a live `ChildProcess`, a bare PID, and a POSIX process group all share the same sequence instead of each drifting. A PID is weaker evidence than a handle — `kill(pid, 0)` cannot distinguish a live process from a zombie or a recycled PID — so pid-file staleness handling stays with the callers that own the file rather than being assumed away.

- [#330](https://github.com/en-dash-consulting/n-dx/pull/330) [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056) Thanks [@endash-shal](https://github.com/endash-shal)! - Local-loop tasks reset to pending on infra failures (retryable instead of deferred), `--reset-deferred` documented in hench help, and single-item PATCH via the web API restores startedAt/completedAt timestamping and status validation.

- [#323](https://github.com/en-dash-consulting/n-dx/pull/323) [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d) Thanks [@endash-shal](https://github.com/endash-shal)! - The "Update available" notice now suggests an upgrade command that actually works.
  
  Previously it always printed `npm i -g @n-dx/core`, regardless of how the copy was installed, which failed two ways:
  
  - **Wrong package manager.** A pnpm-global user following `npm i -g` ends up with a second global install under the npm prefix. Both ship an `ndx` shim, and whichever resolves first on `PATH` wins — so `ndx --version` can keep reporting the old version even though the upgrade "succeeded". `update-check.js` now infers the installing manager from its own path on disk (pnpm's `.pnpm` virtual store, yarn's data directory, else npm) and prints the matching `pnpm add -g` / `yarn global add` / `npm i -g` form.
  - **Missing `@latest`.** pnpm records a caret range in its global manifest, and for 0.x versions `^0.3.1` means `>=0.3.1 <0.4.0`. A bare `pnpm add -g @n-dx/core` or `pnpm update -g` re-resolves inside that range and can never cross a minor boundary, leaving users stranded on an old line indefinitely. The suggested command now always pins `@n-dx/core@latest`.
  
  Adds a `docs/guide/troubleshooting.md` entry for the `ERR_MODULE_NOT_FOUND … assistant-assets/index.js` crash that 0.3.x installs hit, since that failure occurs while Node links the module graph — before any `ndx` code can run and surface an update notice. Documents the upgrade-pinning rule in the README install section.

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
- Updated dependencies [[`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`56a63ea`](https://github.com/en-dash-consulting/n-dx/commit/56a63ea6ef7911166578df2d5bab88e5d6c89d04), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`c5fdbed`](https://github.com/en-dash-consulting/n-dx/commit/c5fdbed684ee91e1b6ceeb77b64bbb3f12b98600), [`18b36f7`](https://github.com/en-dash-consulting/n-dx/commit/18b36f73c0b18bdf508b956e3fb42e5bbf5aeabd), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`c5fdbed`](https://github.com/en-dash-consulting/n-dx/commit/c5fdbed684ee91e1b6ceeb77b64bbb3f12b98600), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`c5fdbed`](https://github.com/en-dash-consulting/n-dx/commit/c5fdbed684ee91e1b6ceeb77b64bbb3f12b98600), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`18b36f7`](https://github.com/en-dash-consulting/n-dx/commit/18b36f73c0b18bdf508b956e3fb42e5bbf5aeabd), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`e35c1c1`](https://github.com/en-dash-consulting/n-dx/commit/e35c1c1f86ed2a831b039acc906b3431d5c1d3e1), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`ea75b8d`](https://github.com/en-dash-consulting/n-dx/commit/ea75b8d45ea03d20a1844855a97b19c80f31a328), [`21283a2`](https://github.com/en-dash-consulting/n-dx/commit/21283a22fcd2b68d5f016fe923e49908c141ebf0), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`4206697`](https://github.com/en-dash-consulting/n-dx/commit/42066975f4b7ffcec402df7446d2a0101ff929c6), [`231c72f`](https://github.com/en-dash-consulting/n-dx/commit/231c72f38b17d329a2eabdba9940fb0e9799b949), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d), [`ab24172`](https://github.com/en-dash-consulting/n-dx/commit/ab241723f3822cca76e801d4628289b3c45b0b84), [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92)]:
  - @n-dx/web@0.5.0
  - @n-dx/llm-client@0.5.0
  - @n-dx/rex@0.5.0
  - @n-dx/hench@0.5.0
  - @n-dx/sourcevision@0.5.0

## 0.4.6

### Patch Changes

- [#268](https://github.com/en-dash-consulting/n-dx/pull/268) [`be3b1d9`](https://github.com/en-dash-consulting/n-dx/commit/be3b1d98f70e6df6b031ed023fb7f8f5a96dba6a) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Fix `ndx plan --no-llm` not suppressing LLM calls in sourcevision zone enrichment. The flag was filtered out before being passed to `sourcevision analyze`; now maps to `--fast` (skip AI enrichment) so the full pipeline respects the flag.

- [#267](https://github.com/en-dash-consulting/n-dx/pull/267) [`579d831`](https://github.com/en-dash-consulting/n-dx/commit/579d831018b949938f6ad18a0a637315a2b9b352) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Fix `ndx ci` on Windows: pnpm is a `.cmd` shim and requires `shell: true` to resolve without ENOENT. Add `shell: process.platform === "win32"` to the docs-build spawn in `ci.js`.

- [#243](https://github.com/en-dash-consulting/n-dx/pull/243) [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99) Thanks [@dnaniel](https://github.com/dnaniel)! - Record `/ndx-work` task execution in hench run history ([#271](https://github.com/en-dash-consulting/n-dx/issues/271)). The `/ndx-work` skill drove tasks through Claude Code without spawning hench, so the work left no `.hench/runs/` entry and was invisible to run history and `ndx usage`. A new `hench record` command writes a lightweight run record (task id, title, status, summary, timestamps, model) marked `assisted`, and the skill now calls it as a final step. Because Claude Code does not expose its own token consumption to a running skill, assisted records carry empty token usage and an `assisted` flag so analytics can distinguish them from genuine hench runs rather than reading them as anomalies; the skill also surfaces this caveat to the user.

- [#239](https://github.com/en-dash-consulting/n-dx/pull/239) [`b9570fd`](https://github.com/en-dash-consulting/n-dx/commit/b9570fd2d7528c6e315f1a1fc6b3aa33e8537da2) Thanks [@endash-shal](https://github.com/endash-shal)! - Added Google integration

- Updated dependencies [[`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`579d831`](https://github.com/en-dash-consulting/n-dx/commit/579d831018b949938f6ad18a0a637315a2b9b352), [`be3b1d9`](https://github.com/en-dash-consulting/n-dx/commit/be3b1d98f70e6df6b031ed023fb7f8f5a96dba6a), [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`545d611`](https://github.com/en-dash-consulting/n-dx/commit/545d611c9a47a372ada5e9b65f2a48d034d37482), [`b9570fd`](https://github.com/en-dash-consulting/n-dx/commit/b9570fd2d7528c6e315f1a1fc6b3aa33e8537da2), [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99)]:
  - @n-dx/sourcevision@0.4.6
  - @n-dx/llm-client@0.4.6
  - @n-dx/rex@0.4.6
  - @n-dx/web@0.4.6
  - @n-dx/hench@0.4.6

## 0.4.5

### Patch Changes

- [#222](https://github.com/en-dash-consulting/n-dx/pull/222) [`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f) Thanks [@endash-shal](https://github.com/endash-shal)! - reduce code size, improve skills for claude

- [#236](https://github.com/en-dash-consulting/n-dx/pull/236) [`6bdf00b`](https://github.com/en-dash-consulting/n-dx/commit/6bdf00b7af631518bbb829bb89160638b500507b) Thanks [@endash-shal](https://github.com/endash-shal)! - init changes to readmes, and startup messages

- Updated dependencies [[`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f), [`7dc2319`](https://github.com/en-dash-consulting/n-dx/commit/7dc231981c78861a0ab5b3e4cefee1e940d474ea), [`6bdf00b`](https://github.com/en-dash-consulting/n-dx/commit/6bdf00b7af631518bbb829bb89160638b500507b)]:
  - @n-dx/sourcevision@0.4.5
  - @n-dx/llm-client@0.4.5
  - @n-dx/hench@0.4.5
  - @n-dx/rex@0.4.5
  - @n-dx/web@0.4.5

## 0.4.4

### Patch Changes

- [#233](https://github.com/en-dash-consulting/n-dx/pull/233) [`a31403d`](https://github.com/en-dash-consulting/n-dx/commit/a31403d8438cfea90f87abff1caf70f92d07e64c) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix: include `self-heal-confirm.js` in the published `@n-dx/core` tarball.
  The file exists in source and is imported by `cli.js` (line 50), but was
  missing from `package.json`'s `files` array, so 0.4.3 published without
  it and `ndx` crashed at startup with
  `ERR_MODULE_NOT_FOUND: Cannot find module … self-heal-confirm.js`.

  Because the changeset config groups all six `@n-dx/*` packages as
  `fixed`, this patch bumps the whole set to 0.4.4 — the other five
  packages republish unchanged but at the new version.

- Updated dependencies []:
  - @n-dx/rex@0.4.4
  - @n-dx/hench@0.4.4
  - @n-dx/sourcevision@0.4.4
  - @n-dx/llm-client@0.4.4
  - @n-dx/web@0.4.4

## 0.4.3

### Patch Changes

- [#229](https://github.com/en-dash-consulting/n-dx/pull/229) [`2a754b2`](https://github.com/en-dash-consulting/n-dx/commit/2a754b21efed8738ce798eb1cc231d34e668efa0) Thanks [@dnaniel](https://github.com/dnaniel)! - Republish via npm Trusted Publishing. 0.4.2 was bumped in source but never
  made it to the registry because the original NPM_TOKEN-based publish in
  the Release run for [#227](https://github.com/en-dash-consulting/n-dx/issues/227) returned E404. Workflow now uses OIDC; this
  changeset moves all six packages to 0.4.3 so they get published with
  provenance attestation.
- Updated dependencies [[`2a754b2`](https://github.com/en-dash-consulting/n-dx/commit/2a754b21efed8738ce798eb1cc231d34e668efa0)]:
  - @n-dx/hench@0.4.3
  - @n-dx/llm-client@0.4.3
  - @n-dx/rex@0.4.3
  - @n-dx/sourcevision@0.4.3
  - @n-dx/web@0.4.3

## 0.4.2

### Patch Changes

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

- Updated dependencies [[`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`d278f05`](https://github.com/en-dash-consulting/n-dx/commit/d278f0506c94ae8bce068f770caa450e07a3330e), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`d85139f`](https://github.com/en-dash-consulting/n-dx/commit/d85139fab48b4ad66d5b6b1619243b505b96f0fc), [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0), [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8)]:
  - @n-dx/web@0.4.2
  - @n-dx/llm-client@0.4.2
  - @n-dx/hench@0.4.2
  - @n-dx/rex@0.4.2
  - @n-dx/sourcevision@0.4.2

## 0.4.1

### Patch Changes

- [#201](https://github.com/en-dash-consulting/n-dx/pull/201) [`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4) Thanks [@endash-shal](https://github.com/endash-shal)! - Adding auto-changing llm models for long runs, self-heal improvements and bug fixes.

- Updated dependencies [[`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4)]:
  - @n-dx/llm-client@0.4.1
  - @n-dx/hench@0.4.1
  - @n-dx/rex@0.4.1
  - @n-dx/web@0.4.1
  - @n-dx/sourcevision@0.4.1

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
  - @n-dx/sourcevision@0.4.0
  - @n-dx/llm-client@0.4.0
  - @n-dx/hench@0.4.0
  - @n-dx/rex@0.4.0
  - @n-dx/web@0.4.0

## 0.3.4

### Patch Changes

- [#197](https://github.com/en-dash-consulting/n-dx/pull/197) [`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307) Thanks [@endash-shal](https://github.com/endash-shal)! - added more documentation changes

- Updated dependencies [[`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307)]:
  - @n-dx/sourcevision@0.3.4
  - @n-dx/llm-client@0.3.4
  - @n-dx/hench@0.3.4
  - @n-dx/rex@0.3.4
  - @n-dx/web@0.3.4

## 0.3.3

### Patch Changes

- [#194](https://github.com/en-dash-consulting/n-dx/pull/194) [`e1dbec6`](https://github.com/en-dash-consulting/n-dx/commit/e1dbec68bd350dc15293fbf473b0c285a09c4f04) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix `ndx` crashing on launch with `ERR_MODULE_NOT_FOUND: ./pair-programming.js`. The file is now included in the published `@n-dx/core` package's `files` array; previously `cli.js` imported a file that was excluded from the tarball.

  Docs: add an **Existing project onboarding** guide for adopting ndx into a repo with real history, expand the **Quickstart** with screenshots of `ndx init` / `analyze` / `plan` / `status` / `work`, and add a `@n-dx/core` package README so the npm landing page is no longer empty.

- Updated dependencies [[`700f356`](https://github.com/en-dash-consulting/n-dx/commit/700f356b146864e2aacafd9f0cace42a7942add8)]:
  - @n-dx/web@0.3.3
  - @n-dx/rex@0.3.3
  - @n-dx/hench@0.3.3
  - @n-dx/sourcevision@0.3.3
  - @n-dx/llm-client@0.3.3

## 0.3.2

### Patch Changes

- [#186](https://github.com/en-dash-consulting/n-dx/pull/186) [`015b06a`](https://github.com/en-dash-consulting/n-dx/commit/015b06ad9fde134cee0f9a45e4fb310fa7a5fddd) Thanks [@endash-shal](https://github.com/endash-shal)! - new PRD structure and smaller fixes

- Updated dependencies [[`015b06a`](https://github.com/en-dash-consulting/n-dx/commit/015b06ad9fde134cee0f9a45e4fb310fa7a5fddd), [`907c5fe`](https://github.com/en-dash-consulting/n-dx/commit/907c5fe8ace0139ab44f323f6a411ed35abb1363), [`9237f50`](https://github.com/en-dash-consulting/n-dx/commit/9237f509d505659f134f52a9effa6a4f9666fe48)]:
  - @n-dx/hench@0.3.2
  - @n-dx/rex@0.3.2
  - @n-dx/web@0.3.2
  - @n-dx/sourcevision@0.3.2
  - @n-dx/llm-client@0.3.2

## 0.3.1

### Patch Changes

- [#172](https://github.com/en-dash-consulting/n-dx/pull/172) [`c1e1f5f`](https://github.com/en-dash-consulting/n-dx/commit/c1e1f5f19acba2990c63c3ffc6cb8016d52c233b) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix `ndx` binary crashing on npm install due to missing files in the published tarball

  - `packages/core/package.json` `files` array was missing `assistant-integration.js` and `codex-integration.js`
  - `cli.js` statically imports `assistant-integration.js`, which in turn statically imports `codex-integration.js`, so the resolution failure happened at module load before any error handling could run
  - Verified via `npm pack --dry-run`: tarball now ships 25 files, and the transitive static-import graph from `cli.js` resolves cleanly

- Updated dependencies []:
  - @n-dx/rex@0.3.1
  - @n-dx/hench@0.3.1
  - @n-dx/sourcevision@0.3.1
  - @n-dx/llm-client@0.3.1
  - @n-dx/web@0.3.1

## 0.3.0

### Minor Changes

- [#158](https://github.com/en-dash-consulting/n-dx/pull/158) [`29a1fb0`](https://github.com/en-dash-consulting/n-dx/commit/29a1fb0185570191173a08dec78476e7a43ad10f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Vendor-neutral assistant integration layer for ndx init

  - Add assistant-integration orchestration that provisions Claude and Codex surfaces independently of the active LLM vendor
  - Add init-llm module with interactive provider/model selection via enquirer (flag > config > prompt precedence)
  - Add vendor-specific model flags (--claude-model, --codex-model) that persist independently
  - Fix MCP server re-registration: remove before re-add so ndx init is idempotent
  - Surface MCP registration error details in init summary instead of silent failures
  - Integrate child-lifecycle process tracking and signal handlers from main
  - Add machine-local config support (.n-dx.local.json) for CLI paths and other per-machine settings

### Patch Changes

- [#167](https://github.com/en-dash-consulting/n-dx/pull/167) [`9ce5ee5`](https://github.com/en-dash-consulting/n-dx/commit/9ce5ee50f9c2a8f90099f2a0fed17475441d55c7) Thanks [@endash-shal](https://github.com/endash-shal)! - more documentation additions and sourcevision token optimizations

- [#164](https://github.com/en-dash-consulting/n-dx/pull/164) [`b9d59f2`](https://github.com/en-dash-consulting/n-dx/commit/b9d59f2da1653066a53068ef3f244f443c5ea615) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix `cli.timeouts.<command>` being silently ignored when stored as a string

  - `ndx config cli.timeouts.work <ms>` now stores the value as a number (numeric-shaped strings and `"true"`/`"false"` are auto-coerced when setting a brand-new key)
  - `resolveCommandTimeout` accepts numeric strings defensively, so existing configs that were written as strings by earlier versions start working without a re-set
  - `ndx init` runs a new config-repair pass that rewrites known-numeric paths (`cli.timeoutMs`, `cli.timeouts.*`, `web.port`) as proper numbers and reports what was repaired

- [#165](https://github.com/en-dash-consulting/n-dx/pull/165) [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more documentation, small fixes and increased base timeout

- [#168](https://github.com/en-dash-consulting/n-dx/pull/168) [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more codex fixes, added full codex integration and other smaller fixes

- Updated dependencies [[`9ce5ee5`](https://github.com/en-dash-consulting/n-dx/commit/9ce5ee50f9c2a8f90099f2a0fed17475441d55c7), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f), [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f)]:
  - @n-dx/sourcevision@0.3.0
  - @n-dx/llm-client@0.3.0
  - @n-dx/hench@0.3.0
  - @n-dx/rex@0.3.0
  - @n-dx/web@0.3.0

## 0.2.3

### Patch Changes

- [#155](https://github.com/en-dash-consulting/n-dx/pull/155) [`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817) Thanks [@endash-shal](https://github.com/endash-shal)! - model and quality of experience improvements

- Updated dependencies [[`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817)]:
  - @n-dx/sourcevision@0.2.3
  - @n-dx/llm-client@0.2.3
  - @n-dx/hench@0.2.3
  - @n-dx/rex@0.2.3
  - @n-dx/web@0.2.3

## 0.2.2

### Patch Changes

- [#153](https://github.com/en-dash-consulting/n-dx/pull/153) [`b99f8a7`](https://github.com/en-dash-consulting/n-dx/commit/b99f8a7d2a0055fbed57acc04e8a2df21bfa92b7) Thanks [@dnaniel](https://github.com/dnaniel)! - Immersive animated init experience with Ink TUI framework

  - Walking T-Rex mascot with shaded pixel art (half-block fg/bg color technique)
  - Ink-based animated UI with React components (htm/react for JSX without build step)
  - Braille spinners for each init phase, smooth animation via child process offloading
  - Sourcevision fast analysis (--fast) runs during init for immediate codebase data
  - Graceful degradation: static fallback for non-TTY, --quiet mode, NO_COLOR support
  - Actionable next-steps menu with CLI commands and skill suggestions
  - New dependencies: ink, react, htm

- [#138](https://github.com/en-dash-consulting/n-dx/pull/138) [`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba) Thanks [@endash-shal](https://github.com/endash-shal)! - This change optimizes some code, adds timeouts and big fixes for major use cases. No new functionality is added.

- Updated dependencies [[`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba)]:
  - @n-dx/sourcevision@0.2.2
  - @n-dx/llm-client@0.2.2
  - @n-dx/rex@0.2.2
  - @n-dx/web@0.2.2
  - @n-dx/hench@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`6c88d23`](https://github.com/en-dash-consulting/n-dx/commit/6c88d237f83594c4877f0f975b383e880fd656bf)]:
  - @n-dx/hench@0.2.1
  - @n-dx/rex@0.2.1
  - @n-dx/web@0.2.1
  - @n-dx/sourcevision@0.2.1
  - @n-dx/llm-client@0.2.1

## 0.2.0

### Minor Changes

- [#120](https://github.com/en-dash-consulting/n-dx/pull/120) [`e14ea38`](https://github.com/en-dash-consulting/n-dx/commit/e14ea3841297390ba2a7b1ee589e1e422425ec5e) Thanks [@dnaniel](https://github.com/dnaniel)! - Extract @n-dx/core into packages/core/ as a proper workspace package. Fixes workspace:\* dependency leak that prevented npm installation.

### Patch Changes

- Updated dependencies []:
  - @n-dx/rex@0.2.0
  - @n-dx/hench@0.2.0
  - @n-dx/sourcevision@0.2.0
  - @n-dx/llm-client@0.2.0
  - @n-dx/web@0.2.0
