# Codex hub confinement evidence — 2026-11-18

Host acceptance now supports the confinement criteria for task
`b42b3957-511c-42f7-aed8-37980dfe6d13` on the single audited macOS installation.
Admission and review fixes were committed in `ba035fe67`; host browser evidence
was delivered with task context in `82cf8c03c`. This update reconciles supplied
records; it does not claim a new browser run or a new independent review.
PR9 delivery still requires the sibling provider task's model-pin fix below.

## Final host/browser observations and limits

The coordinator used the actual in-app browser against the production hub and
project server, disposable repositories, isolated `NDX_HOME` and port 43117.
`pr9-browser-acceptance.json` reports:

- Codex selector admission and a usable current snapshot.
- Registered/unregistered reads and direct writes denied; alias, unrelated
  hub-state and direct network access denied after Stop and full restart.
- Denied draft absent, approved draft exact, and Stop withdrawing the pending
  card with an interrupted turn and no file. The next turn remained confined.
- Five ledger entries, a context checkpoint and context-meter reset.
- Project-host handover retaining the vendor resume ID while the snapshot
  changed from two projects to the remaining second project.
- Full hub restart retaining the conversation, renewed tab authentication and
  continued read/write/network denial. The fixture conversation was ended.

Raw tool extracts were also inspected. `pr9-browser-cli-boundary-custom-tools.json`
pairs the initial read/write commands with their call ID and actual `Operation
not permitted` results. `pr9-browser-own-cli-evidence.json` contains the denied
card result, Stop withdrawal, ledger acknowledgements, subsequent alias and
private-state read denials, and curl's immediate connect `Operation not permitted`.
Its read-only/never session metadata alone is not kernel evidence. Exact approved
content, checkpoint reset, handover and full-restart UI outcomes are coordinator
observations, not independently reconstructed from these partial tool extracts.

`pr9-browser-negative-api-results.json` records HTTP 400 for an unaudited
executable claiming the supported version, an actionable identity error and
`unauditedExecutableRan: false`. The coordinator also observed its disabled
selector. Missing authentication returned 401 and cross-origin access 403.
The coordinator reports all fixture processes stopped and configuration restored
without changing original dirty files or user pins. Screenshots
`pr9-browser-boundary.jpg`, `pr9-browser-cards.jpg` and `pr9-browser-recovery.jpg`
remain external and were not inspected in this execution. No transcripts or
credentials are copied into product fixtures.

Only macOS Codex CLI `0.167.0-alpha.3.2` is admitted, at the canonical executable
path in `packages/web/src/server/sidecar/spawn-policy.ts`, with SHA-256
`a636331ed87605efc4cf84028ac2884a75363f9d10ead63cffb57ea0016d486e`.
This is the source admission pin, not a fresh binary measurement by this session.
Other platforms and actual CLI versions were unavailable and remain refused.
Live external connected tools were unavailable: deterministic MCP tests establish
hub exclusion and worktree run/ask/never, approval and cancellation contracts,
not live external-provider behavior.

The browser CLI contexts actually used `gpt-6.2-sol`, with no session model
recorded, despite the fixture's `llm.codex.model=gpt-6-astra`. Selected-model/pin
propagation remains a defect owned by sibling task `5d47b98c`; it must be fixed
before PR9 delivery. The earlier scripted candidate explicitly used
`gpt-6-astra`. Neither result proves that all product model pins work.

## Evidence provenance

These files were supplied under ignored `.local_testing/pr9-host-evidence/` and
read locally. SHA-256 identifies the inspected bytes, not an independent host
attestation. Preserve the original records, including superseded failures.

| Record | SHA-256 |
|---|---|
| `pr9-browser-acceptance.json` | `12ed94affe60b46f48128d9498bca8119a982918002a72fdc2a03c2c27c989ef` |
| `pr9-browser-negative-api-results.json` | `f149bcee639e6caf55d663aec6a6a3e3957462548e322ac20991a99a61bee942` |
| `pr9-browser-own-cli-evidence.json` | `0a311c470b1ef630dfe2363c3c3b19f0f9dc586f955a786a0890d976600f0b51` |
| `pr9-browser-cli-boundary-custom-tools.json` | `3c0e183059857a512a857546e7fba667e40e5553e38355c5969bb71f37d92430` |
| `host-web-checks.log` | `11a91f8116c9251d920a7c162a77b42ea695b896263b3ac64c137575539ecf13` |
| `pr9-host-admission-tests.log` | `dddc751737bccb9a7369c77a1e92fe936a07fb33c133414d1f47c9df604e273b` |
| `production-candidate-seven-phases.json` | `4d5fe7515e7460a57121f4cd0023a8fd55762b057555617d464093ca6c9e976b` |
| `production-candidate-network-denial.json` | `8dae1a84573155c6d0d626c9b50c97e886e1b9e5cc5c4233b9bd05cfaa702c40` |

Host logs record 71 passing tests (spawn policy, broker credentials, candidate
and hub routes), then 69 (admission, connection hints, selector, connected tools
and hub routes), including earlier excluded/listener-blocked suites. Counts
overlap; they are not a unique-test total.

This documentation reconciliation passed 28 root checks (probe evidence,
native-boundary verdicts and the required CLI-dev/scheduler startup suites) and
44 scoped web checks (admission, candidate, connected tools and selector).
Commands used workspace-local `TMPDIR`, without changing sandbox markers:

```sh
TMPDIR="$PWD/.local_testing" node_modules/.bin/vitest run tests/integration/codex-hub-probe-evidence.test.js tests/unit/codex-hub-read-boundary.test.js tests/e2e/cli-dev.test.js tests/integration/scheduler-startup.test.js
TMPDIR="$PWD/.local_testing" pnpm --filter @n-dx/web exec vitest run tests/integration/hub-codex-admission.test.ts tests/integration/hub-codex-connected-tools.test.ts tests/integration/codex-hub-candidate.test.ts tests/unit/viewer/hub-session-drawer.test.ts
```

No production source changed or package rebuild was needed. The existing
`codex-hub-audited-admission` patch changeset remains applicable. Final fresh
review and atomic PRD/log/commit handling belong to the coordinating Hench run;
this execution does not stage files or finalize task status.

## Current admission implementation

The supplied `production-candidate-seven-phases.json` records all seven phases
passing through the built production registry, broker and MCP on macOS Codex
CLI `0.167.0-alpha.3.2`: fresh/resume/restart, draft denial/approval, Stop and
after-Stop recovery. Registered, unregistered and symlink reads and direct
writes were denied; broker headers were hidden. The supplied
`production-candidate-network-denial.json` separately records a healthy
listener's positive fetch, unchanged count of one, and the shell's immediate
connect failure with `Operation not permitted`. This supersedes the older
network classifier below. These are host-supplied observations, not executions
inside this implementation session. Browser and connected-tool observations
in those records remain explicitly unverified.

Production admission checks the canonical app executable path and its pinned
SHA-256 before running the exact macOS version probe. A POST to the hub lens route probes availability for the selector;
GET remains read-only. Creation and every normal/checkpoint turn independently
revalidate admission. The same profile grants only the bounded hub packet file,
not the directory containing cards, transcripts, ledger or credentials. Binary
or configuration changes during a live registry require ending the session;
restart revalidates the selected executable and reconstructs confinement.
The existing host lock, broker, ledger, ceiling, token/request gates and workspace
handoff remain in use. Hub scope still offers no connected tools, including
tools with run/ask/never policies; deterministic in-memory MCP regressions
exercise this exclusion and the worktree approval/Stop contracts.

### Reproduction procedure (host acceptance completed above)

Use the built checkout with a fresh `NDX_HOME`, two disposable repository
directories and an unregistered sibling directory. Keep `CODEX_HOME` pointed at
the operator's existing authentication; never copy credentials into a fixture.
Do not change sandbox environment markers. Use an unused port, for example
43117, so no production hub is replaced.

1. Build with `pnpm --filter @n-dx/web build`. Under a new directory inside
   `.local_testing/pr9-host-evidence/`, create `home`, `registered`, `second`
   and `unregistered` directories. Put distinct disposable canary files in
   each repository and an alias to the registered canary in the hub fixture.
2. In each registered fixture's `.n-dx.json`, set `features.web.sidecar` to true
   with `{"features":{"web":{"sidecar":true}}}`. In
   `.n-dx.local.json`, set `llm.vendor` to `codex`, `llm.autoFailover` to false,
   and `llm.codex.cli_path` and `llm.codex.model` to the audited absolute
   executable and explicit test model. These files must contain no credentials.
3. With `NDX_HOME` set to the disposable `home`, run this checkout's
   `node packages/core/cli.js start --port=43117 <absolute-fixture-repository>`
   for each registered directory (the source entry point for `n-dx start`).
   Open its authenticated browser URL, go to `/hub`, and open Hub session.
4. Confirm the POST lens response admits Codex, select it and send a snapshot
   question. Inspect the created session's vendor, scope, model and hub lens.
   Request reads of the registered, unregistered and alias canaries and a direct
   write; record actual tool results showing denial, not merely model claims.
   Confirm a bounded snapshot is usable and unrelated hub files are unreadable.
5. Request a `save_draft` into the disposable drafts directory. Deny its card
   and verify no file, then approve a new card and verify exact content. Stop
   another pending card and verify withdrawal and interruption. Send another
   turn and repeat the read/write boundary checks. Capture screenshots/video.
6. Stop/restart only the disposable hub with the same `NDX_HOME`; reopen the
   session and verify its vendor thread ID persists and confinement holds.
   Exercise a host handover to the second fixture, ledger/context checkpoint,
   token refusal and worktree handoff. Repeat using an unaudited executable
   version and confirm refusal at both selector and direct create.
7. Record selected binary/version, model, OS, observations and unavailable
   cases in a separate result. Do not call synthetic checks browser proof.
   Stop the disposable hub with `NDX_HOME=<fixture-home> node packages/core/cli.js hub stop`.

The existing `probe-codex-hub-candidate.mjs` remains a lower-level scripted
fixture; it does not exercise the new selector or creation admission. The
instructions above deliberately exercise the actual server/browser instead.

Historical admission implementation validation: the web build and typecheck passed, along
with 231 scoped web tests and 238 root startup/architecture/changeset checks.
The extra `sidecar-external-call-hints.test.ts` run failed before assertions:
loopback `listen EPERM` caused setup timeouts and consequent teardown errors.
The existing sandbox configuration also excludes `tests/unit/server/**` here,
including the updated hub-route refusal test. Those suites later passed on the host;
the sandbox marker was not altered. New listener-free admission tests exercise
the production route, registry and driver, including reconnect/restart, with
a mocked executable probe and child. They are wiring evidence, not native
confinement or browser proof. No full repository suite ran.

## Historical investigation (superseded by the host records above)

At the time of the following investigation, the Codex hub refusal and
Claude-only selector were unchanged.

The previous attempt left only ignored `.local_testing/` artifacts and was
rejected for having no git diff. Its nested sandbox exited 71 before the
command ran; that failure is not evidence of a denied repository read.

Two subsequent host records already present in
`.local_testing/pr9-host-evidence/` were inspected in this session:

- `pr9-hub-host-probe.json` (22:31:58 UTC): root deny plus minimal/hub read
  allowed both the snapshot and repository canary (`negative=0`).
- `pr9-hub-explicit-deny-host-probe.json` (22:32:30 UTC): additional explicit
  repository, `:tmpdir` and `:slash_tmp` denials allowed the snapshot but denied
  the repository canary with EPERM (`negative=1`).

These are supplied native-command records, not new live observations. They
name the selected macOS Codex binary but do not record its version. The prior
run reported `0.167.0-alpha.3.2`; that version cannot be independently established
from these two JSON files. Other versions and platforms are unverified.

The tracked probe now records version output and keeps each result beside its
disposable fixture. From the checkout root, on a permitted macOS host:

```sh
node scripts/probe-codex-hub-read-boundary.mjs /absolute/path/to/codex .local_testing/pr9-host-evidence
```

It uses an isolated HOME/CODEX_HOME and an environment allowlist, makes no model
call, and supplies no credentials. It retains fixtures for inspection. Exit 0
means only that the native command read its allowed snapshot and received a
permission error reading the canary. `hubAdmission` is always false. Startup
failure, cancellation, a missing canary and a failed positive control cannot
produce a successful denial verdict. Unit tests exercise these distinctions;
they are synthetic records, not sandbox enforcement evidence.

At that historical checkpoint, still required before enabling the selector: supported live fresh/resumed hub
sessions using the broker; repository denial across registered/unregistered
repositories and aliases; Stop/cancellation and restart/recovery; connected-tool
scope and allow/ask/never policies; operator cards, hosting, ledger, context
ceilings, request/token gates and workspace isolation. Real CLI session and
browser evidence is unavailable in this execution. The explicit-deny profile
is an investigation fixture, not a production session policy.

## Historical unadmitted production-policy candidate

The supplied `pr9-live-shell-boundary.json` (22:42:11 UTC) subsequently recorded
fresh/resumed/restarted calls through the built vendor-session API. Its
filesystem and credential observations are useful, but its `network` and
`verified` booleans are invalid: `pr9-live-shell-boundary-audit.json` retracts
them because a failed connection to an unused port is not network denial.
These are supplied records, not new executions in this task session.

`candidateCodexHubSpawn` now composes the production broker configuration and
header masking with a restrictive permission profile, on fresh and resumed
turns. It accepts only the supplied macOS version (`0.167.0-alpha.3.2`) for
investigation. This is not a claim that the version meets hub acceptance.
It grants one snapshot file rather than the session directory, denies the
named repositories and temp roots, rejects linked snapshots and overlapping
repository roots, and rechecks path identities and project MCP declarations
before each turn. No route, configuration setting or selector admits it.

The standalone host fixture exercises this candidate through the built
`SidecarSessionRegistry`, `SidecarBroker` and hub MCP transport:

```sh
pnpm --filter @n-dx/web build
node packages/web/scripts/probe-codex-hub-candidate.mjs /absolute/path/to/codex gpt-6-astra .local_testing/pr9-host-evidence
```

This opt-in command spends model tokens using the host's Codex authentication.
It creates only disposable data under the output directory. It attempts
registered, unregistered and symlink reads, direct writes and broker-header
masking across fresh/resume/restart; scripted draft denial/approval and Stop;
then repeats the boundary checks after Stop. It retains the fixture and a
sanitized result, never raw argv, tool output or credentials in that result.
The readable snapshot doubles as a host-written shell script. A boundary
phase checks the command and its shell result, including permission errors
from each attempted access. Resume and recovery phases check the persisted
and returned vendor thread IDs. Each draft phase checks its own new card
and the disposition of the requested file.
The registry's normal diagnostic transcripts remain in the disposable fixture.
Other versions/platforms fail before a model turn. Startup failures or missing
observations fail the fixture. The fixture has not been executed live here.

Its `passed` field describes only those scripted checks; `hubAdmission` remains
false. Network enforcement, browser actions, connected-tool policy, hosting,
context ceilings and request/token gates still require separate real acceptance
evidence. The fixture uses an explicit candidate connection, not the refused
dashboard connection. Do not mark this task complete or enable the selector
on the basis of flag tests, the supplied shell record or this fixture alone.

Local validation for this candidate: web build/typecheck, nine candidate
contract tests, ten native-probe verdict tests and 238 root startup,
architecture and changeset checks passed. The existing broker credential
integration suite's two tests failed during listener setup (`listen EPERM`
on loopback, followed by hook timeouts); no broker assertions ran. The network
sandbox marker was not changed. The host fixture passed syntax checking only.
