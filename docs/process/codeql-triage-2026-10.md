# CodeQL alert triage, October 2026

Triage of the 58 open `javascript-typescript` CodeQL alerts on `main` at
`0a7c21477` (scan of 2026-10-16, re-checked 2026-10-21), the stack of pull
requests that closes the ones worth code, and the dismissal comment for each
one that is not. Every alert was read at its line, its input traced to a
source, and, where the claim was about speed or a shell, measured or
reproduced on a Windows machine before it got a verdict.

The alerts are at
<https://github.com/en-dash-consulting/n-dx/security/code-scanning>. Ryan's
language-pack fixes (`Stack review fixes: pre-merge (PR 21)`, the
`lang-java` and `lang-python` ReDoS tasks) set the convention this plan
follows: one PRD task per fix, a `callWithinBudget` or equivalent linearity
test, a patch changeset, and the alert numbers in the task description.

## Verdicts in one table

| Verdict | Count | Alerts |
|---|---|---|
| True positive, fix | 10 | 69, 71, 44, 51 (cmd.exe guard bypass) · 59 (prototype pollution via delete) · 31 (frontmatter double-unescape) · 8, 9, 14, 17 (cubic regexes) |
| Defensive fix, cheap and silences the alert | 26 | 68, 70, 43 · 58, 61, 62, 55, 56 · 18, 19, 20, 21, 22 · 10, 11, 12, 13, 15, 16 · 38, 39, 23, 64, 36 · 32, 33, 34 |
| Dismiss with a reason | 22 | 25, 26, 27 · 57, 60 · 1, 2, 3, 4, 5 · 6, 7 · 48, 54, 52 · 35, 29, 30, 28, 37, 24 |

Three findings CodeQL did not make came out of the tracing and are folded
into the layers below: the `deleteByPath` hole beside alert 59, the
unflagged twin of alerts 20/21 in `folder-tree-parser.ts`, and the missing
`%VAR%` guard in sourcevision's copy of the cmd.exe recipe (alert 52).

## Threat model used

n-dx runs on a developer's machine against a repository they may not fully
trust. The dashboard is loopback-only behind a per-user token with
`SameSite=Strict`, `HttpOnly` cookies, a Host check against the socket's own
port, and an Origin / `Sec-Fetch-Site` check on mutations (verified in
`request-security.ts`, `request-guard.ts`, `shared/auth.ts`,
`shared/origin.ts`). So:

- **Repository content is untrusted input.** The PRD (`.rex/changes/**`,
  `.rex/product/**`), `.n-dx.json`, a README, a cloned `.rex/prd.md`.
  Anything that reaches a shell, a prototype, or an unbounded regex from
  there is real.
- **An authenticated dashboard request is the local user.** Server-side
  request forgery or an open redirect that needs the token adds nothing an
  attacker with the token could not already do. Those get shape validation
  and a `won't fix` dismissal, not a security fix.
- **Operator config, `ps` output and `icacls` output are trusted.** Alerts
  whose only source is one of these are dismissed.

## The stack

Nine pull requests. Layer 0 is this branch, which also captures the work as
PRD feature `98fe5cc3-1d8a-47dc-846b-90a756868693` under Security & Data
Safety, one task per layer. Layers 1 to 8 each carry their
PRD task's `N-DX-Item` trailer, a patch changeset per touched package, and
the tests named below. The order puts the four true-positive layers first;
layers 3, 5, 7 and 8 touch no file the layers below them touch and can be
peeled off as standalone PRs if a reviewer prefers.

```
main
 └─ 0  chore/codeql-alert-triage            this document + PRD capture
     └─ 1  fix/windows-cmd-guard-bypass     core · llm-client · sourcevision   alerts 43 44 68 69 70 71 (52)
         └─ 2  fix/web-llm-config-proto-pollution   web                        alerts 59 58 (57 60 tests)
             └─ 3  fix/rex-frontmatter-decode-and-linear-regexes  rex          alerts 31 18 20 21 22 34
                 └─ 4  fix/llm-client-error-classifier-linear      llm-client   alerts 8 9 10 11 12 13 14 15 16 17
                     └─ 5  fix/web-redirect-and-llm-host           web          alerts 38 39 23 64
                         └─ 6  fix/core-hench-config-path-guards   core · hench alerts 61 62 55 56 33 32 (1 2 3 5)
                             └─ 7  fix/rex-code-coverage-path-regex  rex        alert 19
                                 └─ 8  fix/web-error-message-sweep   web        alert 36
```

### Layer 1: `fix/windows-cmd-guard-bypass` (critical, S)

PRD task `c9d90073-ef5d-455f-b30d-cc2e6efebcfa`.

**Alerts 69, 71, 44, 51 are true positives.** PR #790 added
`assertNoWindowsEnvExpansion` so a token holding `%NAME%` is refused when
`NAME` is in the environment. Two things escape it, reproduced with an
`echo`-only proof on this machine (`scratchpad/poc2.mjs`):

- cmd.exe *dynamic* variables are never in `process.env`: `%CD%`, `%DATE%`,
  `%TIME%`, `%RANDOM%`, `%ERRORLEVEL%`, `%CMDEXTVERSION%`, `%CMDCMDLINE%`,
  `%HIGHESTNUMANODENUMBER%`, and the `%=C:%` / `%=ExitCode%` forms.
- The `:~n,m` and `:a=b` modifiers make the captured name never match an
  env key, and `=` is excluded from the regex entirely so `%X:a=b%` is not
  even seen.

`%CMDCMDLINE:~-1%` expands to the last character of cmd.exe's own command
line, which is the closing `"`. The token
`claude-opus-5%CMDCMDLINE:~-1% & echo INJECTED & echo ` passes the guard,
passes rex's `RunModelsSchema` (a bounded string, no character class),
passes hench's `startsWith("claude-")` vendor check, and runs the injected
command on the next `ndx work` on Windows. The PRD tree is committed
repository content, so a pull request that adds a `run.models.claude` pin
to a task is the delivery route. `.n-dx.json`'s `llm.claude.model` and
`llm.*.cli_path` are a second route; `repo-trust.ts` does not fingerprint
them. Also proven: a `\r` or `\n` inside a token silently truncates the
command line, and `/d` does not disable delayed `!VAR!` expansion when the
registry turns it on (`/v:off` does).

**Why alerts 41, 42, 49, 50 said "fixed".** Their `fixed_at` equals the
`created_at` of 68 to 71: the scan of `3d1ab079b`, the merge of #790. The
flagged lines did not change; #790 inserted `WINDOWS_VAR_REF` two lines
below them, which moved CodeQL's line-hash fingerprint. All four new alerts
share fingerprint `588e63b17d7319bf:1`. Nothing was fixed.

**Fix**, identical text in both twins (`packages/core/win-spawn.js` and
`packages/llm-client/src/exec.ts`; core may not import llm-client):

- Regex `/%([^%\r\n]+)%/g`, then `name = match[1].split(":")[0]`.
- Refuse when the name is in the environment, is a cmd.exe dynamic variable
  (the list above), or starts with `=`. `C:\100%cool\bin` stays spawnable,
  as #790 intended.
- Refuse any token containing `\r` or `\n`.
- Add `/v:off` to every cmd.exe recipe: `win-spawn.js` lines 147 and 174,
  `exec.ts` lines 610 and 1746, `exec-cli.ts` line 29.
- Unify sourcevision: add a sync `execFileSyncCli` to llm-client's `exec.ts`
  and export it; `packages/sourcevision/src/util/exec-cli.ts` becomes a
  re-export. Sourcevision to llm-client is an allowed edge; today the file
  has no guard and no `windowsHide`.

**Tests.** Extend `packages/llm-client/tests/unit/cli-spawn-routing.test.ts`
("spawnCli refuses what cmd.exe would expand", lines 73 to 115, runs on
every platform through `_platform`) with `%CMDCMDLINE:~-1%`, `%CD%`,
`%OS:~0,3%` under an injected env, `%X:a=b%`, and a token holding `\n`;
keep the two "still spawns" cases. Add refusal cases to
`tests/unit/win-spawn.test.js`, which has none. Pin the guard in
`tests/unit/windows-quoting-parity.test.js`, which today pins only
`quoteWindowsToken` and `buildWindowsCliCommandLine`. Update the "uses
cmd.exe invocation" assertions for `/v:off`. One refusal case in
`packages/sourcevision/tests/unit/util/exec-cli.test.ts`.

**Dismiss after it lands:** 43, 44, 68, 69, 70, 71 as "quoted with
`quoteWindowsToken` and refused by `assertNoWindowsEnvExpansion`; CodeQL has
no cmd.exe sanitizer model", and 52 as "the only flagged flow (`ps -p`)
returns before spawning on win32; recipe now shared with llm-client".

**Conflicts.** Sterling's draft #840 adds `windowsHide` to the same
functions in all four files. One-line resolutions; whichever lands second
rebases. Changesets: `@n-dx/core`, `@n-dx/llm-client`, `@n-dx/sourcevision`.

### Layer 2: `fix/web-llm-config-proto-pollution` (high, S)

PRD task `244a15f7-aa19-469a-870b-f250e48063ac`.

**Alert 59 is a true positive**, though not at the flagged line. The
`setByPath` at `routes-llm.ts:441` cannot get `__proto__` as an intermediate
segment on a set: tiers are checked as `<vendor>.<tier>`, and the `routes.`
and `effort.` prefixes collapse to one flat key. Its sibling `deleteByPath`
(line 445) is reachable: `validateLlmChange` skips `validateRoutingChange`
when the value is `null` or `""` (line 1128), `validateModelForVendor`'s
vendor regex does not match `__proto__` so returns null, and
`isWritablePath` (line 300) accepts any `llm.tiers.*`. So
`PUT /api/llm/config {"changes": {"llm.tiers.__proto__.toString": null}}`
walks `config.llm.tiers["__proto__"]` to `Object.prototype` and deletes
`toString`. Same through `POST /api/llm/config/preview`. Precondition is an
`llm.tiers` object in `.n-dx.json`, which the same endpoint creates. Token
gated, so a same-user tamper of the dashboard process, not remote code
execution, but a real server-side prototype write.

**Fix.** At the top of `validateLlmChange`, reject any segment in
`FORBIDDEN_CONFIG_SEGMENTS` (already exported by `hench-config-fields.ts`,
already imported at line 37). Run the `llm.tiers.<vendor>.<tier>` shape
check for deletes too. Guard inside both `setByPath` and `deleteByPath` as
defence in depth.

**Alert 58** (`routes-features.ts:233`): the PUT handler allowlists every key
against `FEATURE_REGISTRY`, so unreachable; fix by deleting the private
`setByPath` / `getByPath` and importing the guarded `setConfigValue` /
`getConfigValue` from `hench-config-fields.ts`, which routes-adaptive and
routes-hench already use. Same `split(".")` semantics.

**Alerts 57 and 60** are false positives (guarded at
`hench-config-fields.ts:373` and `routes-workflow.ts:523` and 503, tested
at `hench-config-fields.test.ts:131`, `routes-adaptive.test.ts:400`,
`routes-workflow.test.ts:331`). This layer adds a direct
`setConfigValue("__proto__.polluted", …)` test, which does not exist, and
changes `APPLYABLE_SUGGESTION_KEYS[key]` at `routes-workflow.ts:506` to
`Object.hasOwn`, since a body key of `toString` is truthy on a plain object
lookup and writes an own `toString` into `.hench/config.json`.

**Tests.** `packages/web/tests/unit/server/routes-llm-tiers.test.ts` already
boots `handleLlmRoute` on a local server: seed `llm.tiers.claude.light`,
PUT the `__proto__.toString` delete with `null` and with `""`, expect 400,
assert `Object.prototype.hasOwnProperty("toString")` and the file unchanged;
PUT `llm.routes.__proto__` expecting 400 (currently a 200 no-op); the same
body against preview. A feature-gates PUT with a `__proto__.polluted` key
expecting 400. Changeset: `@n-dx/web`.

### Layer 3: `fix/rex-frontmatter-decode-and-linear-regexes` (high, S)

PRD task `268f39f3-dbd5-4397-9774-f1e0f6ffa0ec`.

**Alert 31 is a true positive.** `folder-tree-parser.ts:1376` decodes a
double-quoted frontmatter scalar that is not valid JSON with a four-step
replace chain; `\\` becomes `\` and the next step reads it as the start of
`\n`. Reproduced against the built dist: `title: "\x41 and C:\\new"` reads
back with a line feed where `\new` was, and each save would compound it.
Both writers emit JSON, so only hand- or agent-written frontmatter hits the
chain, but agents do write these files.

Fix: one pass that never re-reads what it produced,
`s.slice(1, -1).replace(/\\(.)/g, (m, c) => ESCAPES[c] ?? m)` with
`ESCAPES` for `n t r " \`. Test beside the existing "still reads a
hand-written escape JSON lacks" case in
`packages/rex/tests/unit/store/folder-tree-parser.test.ts` (line 1143).

**Alerts 18, 20, 21, 22** are quadratic regexes on repository content,
measured on 50k-character inputs:

| Alert | Where | Regex | Measured | Replacement |
|---|---|---|---|---|
| 18 | `analyze/extract.ts:647` | `/[.;]+$/` on a sentence from an analysed README | 474 ms | `/(?<![.;])[.;]+$/` (0.2 ms) |
| 20, 21 | `store/markdown-parser.ts:548, 552` | `/\n*$/` on a YAML block scalar from a legacy `prd.md` | 476 ms | a trailing-newline loop (0 ms). **Fix the unflagged twin at `folder-tree-parser.ts:1347, 1350` too**, which reads every `index.md` |
| 22 | `store/markdown-serializer.ts:364` | `/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/` on every string scalar | 2.5 s | `/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/` (0.1 ms), same language |

Alert 22's live callers are the legacy migration and web's `savePRDSync`,
which `routes-rex/rex-route-helpers.ts:11` imports and never calls; delete
that import in this layer. **Alert 34** (`folder-tree-index-generator.ts:87`)
escapes `|` but not `\` in a commit message for a Markdown cell;
`generateIndexMd` has no production caller, so this is an XS tidy: escape
`\` first and fold newlines.

Tests: `extract-text.test.ts` (lines 94 to 122), `markdown-parser.test.ts`
(135 to 150, add `|`, `|-`, `|+` bodies with thousands of blank lines for
both parsers), `markdown-serializer.test.ts` (143 to 150, add quoting of
`"42"`, `"1.5"`, `".5"`, `"1e5"`, `"-3"`, not `"1.2.3"`), the index
generator test, each with a 100k-character budget case. Changeset:
`@n-dx/rex` (and `@n-dx/web` for the dead import).

### Layer 4: `fix/llm-client-error-classifier-linear` (high, S)

PRD task `f35328ee-9eed-4f9b-a6db-1ca57be41689`.

Alerts 8 to 17 match provider error text. The input is the *entire*
`response.text()` body interpolated into `Error.message` with no truncation
(`openai-api-provider.ts:208, 291`, `google-api-provider.ts:361, 483, 550`,
`local-api-provider.ts:282, 387`), or the vendor CLI's stderr accumulated
unbounded in hench's `cli-loop.ts`. A hostile body needs a hostile or
compromised endpoint or proxy, so not a remote vector, but three patterns
are **cubic**, not quadratic:

| Alert | Regex | Measured at 50k |
|---|---|---|
| 8 | `local-api-provider.ts:179` `model.*not.*available` | 99.6 s |
| 9, 14, 17 | `llm-error-classifier.ts:176, 478, 503` `invalid.*api.*key` | 59 s |
| 10, 15, 13, 16, 11 | `authentication.*(…)`, `expired.*(token|key)`, `unauthorized.*(…)`, `please (… login)` | 58 to 223 ms |
| 12 | `:217` `/\s*\[ndx-debug:([^\]]+)\]/` | 662 ms |

A 40 KB LM Studio error body repeating `model not ` hangs the process for
about a minute. Fix in one PR: a `CLASSIFY_WINDOW = 4096` slice at the top
of `isAuthError` and `parseAuthPayload` (keep `extractProviderDetail` and
`extractJsonErrorMessage` on the full string so a long JSON body still
yields its message), and on `msg` in `parseLmStudioError` before the test
(the 300-character truncation at line 187 runs after it). Rewrite the gaps
as bounded non-newline runs: `invalid[^\n]{0,80}?api[^\n]{0,80}?key`
hoisted to one constant for the three sites,
`model[^\n]{0,200}?not[^\n]{0,200}?available`, and `[^\n]{0,80}?` for the
quadratic ones. Alert 12 becomes ` ?\[ndx-debug:` because the only producer
(`reason.ts:225`) emits exactly one space; do not apply the window there,
the sentinel sits at the end of the message.

Tests: `llm-error-classifier.test.ts` (`isAuthError` at 415,
`parseAuthPayload` at 460) re-asserting the positives plus a pathological
block (`"invalid api ".repeat(2000)` and friends under a 100 ms budget), and
a new `tests/unit/local-api-provider.test.ts`, since `parseLmStudioError`
has no test today. Changeset: `@n-dx/llm-client`.

**Dismiss 6 and 7** (`help-format.ts:323, 448`): the input is the CLI help
definitions, compile-time literals.

### Layer 5: `fix/web-redirect-and-llm-host` (medium, S)

PRD task `3983fd13-776b-4a52-b409-507b317cc847`.

**Alerts 38, 39** (open redirect): `splitTokenQuery` in `shared/auth.ts`
returns `req.url` up to `?` verbatim, and a request line of
`GET //evil.com/?ndx_token=T` or absolute-form `GET http://evil.com/x?…`
does reach `req.url` unchanged (verified against a Node server). The branch
only fires when the token is correct, so the attacker already holds the
credential. Fix anyway, XS: `sameOriginPath = /^\/(?![\/\\])/.test(path) ?
path : "/"` inside `splitTokenQuery`, one change for both alerts. Tests in
`auth.test.ts` (56 to 62), `request-security.test.ts` (175), and
`hub/request-guard.test.ts` (198).

**Alerts 23, 64** (request forgery, both critical by CodeQL's scale): the
LLM probe endpoints build `http://${host}:${port}/v1/…` from
`POST /api/llm/local-test` and the stored `local-profiles`, with
`typeof`-only checks. The feature is "probe the LLM server the user
configured", `local-api-provider.ts` builds the same URL for real
inference, and a LAN GPU box is a supported setup, so no loopback
allowlist. Fix the shape: `isPlausibleLlmHost` (URL round-trip, no
`/ ? # @ \` or whitespace, hostname equals input) and `isValidPort`
(integer 1 to 65535) at the three intake points returning 400, and the two
config-read probes returning an error object instead of fetching. Tests in
`routes-llm-local-test.test.ts`, which already stands up a fake LLM server.
A shape check will not satisfy the `js/request-forgery` query, so **dismiss
23 and 64 as won't fix** after this lands: "user-configured LLM endpoint,
token and Origin gated, host and port shape-validated". Changeset:
`@n-dx/web`.

### Layer 6: `fix/core-hench-config-path-guards` (medium, XS each)

PRD task `86b6f51a-6a97-4c60-803c-87eb1f8e3dcf`.

- **61, 62, 55** `packages/core/config.js:517, 521`: `ndx config set
  llm.__proto__.polluted x` walks `configs.llm["__proto__"]` and assigns on
  `Object.prototype` in the operator's own CLI process. Not persisted, no
  remote route (web never spawns `config set`). Throw from
  `splitSettingPath` (line 486) on `__proto__`, `constructor`, `prototype`;
  core imports nothing, so the three-element Set is inlined. Test in
  `tests/e2e/cli-config.test.js`: non-zero exit, `.n-dx.json`
  byte-identical.
- **56** `packages/hench/src/cli/commands/config.ts:681`: both callers
  allowlist the path against `CONFIG_FIELDS` first. Same inline Set, throw
  `CLIError`. Direct unit test in `tests/unit/cli/commands/config.test.ts`.
- **33** `packages/hench/src/cli/commands/run-resolve.ts:494`: `shellWord`
  on win32 does not double backslashes before a quote or at the end, so the
  printed `ndx work` command for `C:\My Repo\` is wrong. Display text only.
  MSVC rules: `.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")`.
  Test in `run-resolve-shell-word.test.ts`.
- **32** `packages/core/ci.js:1328`: escapes only `.` when building a regex
  from the layout's data-directory names, which are constants. Use the
  file's own `escapeRegExp` (line 1108).
- **1, 2, 3, 5** are dismissable (below) but each has a verified
  behaviour-identical one-liner; fold them in if the goal is zero open
  alerts: `[^)]` to `[^()]` in `file-permissions.js:54, 60`,
  `/(?<![/\\])[/\\]+$/` in `mcp-shim.js:567`,
  `/^[-.]+|(?<![-.])[-.]+$/g` in `web.js:1099` and its twin
  `packages/web/src/hub/new-project.ts:171`.

Changesets: `@n-dx/core`, `@n-dx/hench`. #817 and #819 touch `config.js`
and `ci.js`; the edits are in different functions.

### Layer 7: `fix/rex-code-coverage-path-regex` (medium, S)

PRD task `5ce96100-3aa2-49ee-881d-32128dc9cb39`.

**Alert 19** `packages/rex/src/core/code-coverage.ts:44`:
`/(?:\.\/)?(?:[\w@-]+\/)+[\w.-]+\.\w+/g` over PRD descriptions and
criteria, 800 to 940 ms at 50k. `crossReferenceChanges` is a public export
with no caller in the monorepo and no unit test. Fix
`/(?<![\w@.\/-])\/?(?:\.\/)?(?:[\w@-]+\/)+[\w.-]+\.\w+/g` with
`normalizePath` stripping a leading `./` or `/` (0.5 ms). Three deliberate
behaviour changes, all mid-token false positives the old regex produced:
`foo.bar/baz.ts` no longer yields `bar/baz.ts`, a GitHub URL no longer
yields `com/org/repo.git`, `v1.2/foo.ts` no longer yields `2/foo.ts`. Its
own layer so the delta is reviewable; new
`tests/unit/core/code-coverage.test.ts` with the sample set and a budget
case. Changeset: `@n-dx/rex`.

### Layer 8: `fix/web-error-message-sweep` (low, M, mechanical)

PRD task `d5c544d1-8ba7-4ef2-93e8-cfc0c45d2e43`.

**Alert 36** `response-utils.ts:34` is the shared `jsonResponse` sink, so one
alert aggregates every route. Nothing reads `.stack`; the flows are
`String(err)` from a catch, which on an `Error` is `name: message`, never
the stack. Substantively a false positive, but commit `23a99bc06` already
added `errorMessage()` (`response-utils.ts:58`) for this alert and used it
in one route. Finish the sweep: about 25 direct
`errorResponse(res, N, String(err))` sites and about 20
`err instanceof Error ? err.message : String(err)` ternaries across
`routes-commands`, `routes-rex-analysis`, `routes-rex/*`, `routes-adaptive`,
`routes-git`, `routes-hench`, `routes-iso-map`, `routes-sourcevision`,
`routes-workflow`, `routes-llm`, `routes-hench-prep`; also the served
status fields (`selfHealStatus.error`, `slot.state.error`,
`outcome.error`). Add a policy test that fails any
`(errorResponse|jsonResponse)\(` call whose argument is `String(err)`.
Last in the stack because it touches the most files. Changeset:
`@n-dx/web`.

## Dismissals

Run after the relevant layer merges, or now for the pure false positives.
Reason codes are GitHub's: `false positive`, `won't fix`, `used in tests`.

| Alerts | Reason | Comment |
|---|---|---|
| 25, 26, 27 | false positive | Request path is realpath-resolved and separator-anchored-prefix-checked against the realpath of the document directory in `resolveSibling` (preview.ts:215-238); directory and symlink escapes return 404; covered by preview-server.test.ts "refuses to serve files outside the document's directory". |
| 57 | false positive | Guarded at line 373 by FORBIDDEN_CONFIG_SEGMENTS before the walk, and upstream by validateConfigKeyValue; CodeQL does not model a Set-based guard. Covered by hench-config-fields.test.ts:131 and routes-adaptive.test.ts:400. |
| 60 | false positive | Guarded at line 523 and upstream at 503 by FORBIDDEN_PATH_SEGMENTS; routes-workflow.test.ts:331 asserts Object.prototype is untouched. |
| 1 | won't fix | Input is icacls stdout for our own config file on the operator's machine; identity plus flag groups, not attacker-controlled. |
| 2 | false positive | Operand is the capture of the line regex above, which guarantees balanced groups; the slow input cannot reach this expression. |
| 3 | won't fix | Operand is a realpath-resolved git worktree root (PATH_MAX-bounded); the client root is validated against the repository before this runs. |
| 4 | won't fix | Operand is the `ps` command line of a process already verified to be owned by the current uid. |
| 5 | won't fix | Operand is the project name from the operator's own `.rex/config.json` or a directory basename; not reachable from a request. |
| 6, 7 | false positive | Input is a compile-time string literal from the CLI help definitions; no external data reaches this regex. |
| 48 | false positive | Intended shell: execShellCmd exists to run an operator- or PRD-supplied shell string (test command, validationCommand, agent run_command); the string is the command, not an argument to one. |
| 54 | false positive | Flows are exec("git", [argv…]) with no shell; CodeQL marks this spawn shell-interpreted only because execShellCmd also reaches it. Same reason alert 40 was dismissed at this line. |
| 52 | false positive | After layer 1. The only flagged flow (`ps -p`) returns null on win32 before spawning; the recipe is now llm-client's guarded one. |
| 43, 44, 68, 69, 70, 71 | won't fix | After layer 1. Every token is quoted by quoteWindowsToken and refused by assertNoWindowsEnvExpansion (dynamic variables, modifiers, CR/LF); CodeQL has no cmd.exe sanitizer model. Pinned by windows-quoting-parity.test.js. |
| 23, 64 | won't fix | After layer 5. The endpoint probes the LLM server the user configured, behind the per-user token and the Origin check; host and port are shape-validated. |
| 35 | false positive | Build script over repo constants (COMMAND_EFFECTS); the generated doc is drift-tested by cli-ui-gap-drift.test.js. |
| 29, 30 | false positive | Removes the template comment from a project-owned Markdown file for an LLM prompt or MCP text resource; the output is never rendered as HTML. |
| 28 | false positive | Dev build script replacing the single script block of the repo's own demo page; not a sanitizer. |
| 37 | used in tests | JSON.stringify is the correct JS string-literal escaper for nested `node -e` source. |
| 24 | false positive | The branch name is HTML-escaped at line 69 before it enters `stats`; every other member is a literal or a number. (Optional tidy: escape at the sink.) |

## Open questions for review

- **Layer 1 and #840.** Both edit the same four functions. Proposed: layer 1
  off `main` because it is the one urgent fix; #840 rebases over it.
- **Alert 19's behaviour change** removes three mid-token matches. Nothing
  calls `crossReferenceChanges` today; confirm the public export's
  semantics are free to change, or take the cap-the-input alternative.
- **Repo trust and LLM config.** `repo-trust.ts` does not fingerprint
  `llm.*.cli_path` or `llm.*.model` from `.n-dx.json`. After layer 1 those
  values are refused when dangerous rather than trusted, but whether they
  belong in the trust digest is a separate decision.
- **Fingerprint churn.** Any future edit within a few lines of
  `buildWindowsCliCommandLine` will re-open 68 to 71 under new numbers.
  Dismissals carry over only while the fingerprint holds; the durable
  record is this document and the parity test.

## Reproduction scripts

Kept out of the repository, in the session scratchpad: the cmd.exe guard
bypass (`poc.mjs`, `poc2.mjs`, echo only), the regex timings
(`redos-timing.mjs`, `redos-timing2.mjs`), the frontmatter double-unescape
(`repro31.mjs`, against the built rex dist), and the `req.url` probe
(`req-url-probe.mjs`).
