# Codex hub confinement investigation — 2026-11-18

Task `b42b3957-511c-42f7-aed8-37980dfe6d13` remains incomplete. The n-dx
Codex hub refusal and Claude-only selector remain unchanged.

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

Still required before enabling the selector: supported live fresh/resumed hub
sessions using the broker; repository denial across registered/unregistered
repositories and aliases; Stop/cancellation and restart/recovery; connected-tool
scope and allow/ask/never policies; operator cards, hosting, ledger, context
ceilings, request/token gates and workspace isolation. Real CLI session and
browser evidence is unavailable in this execution. The explicit-deny profile
is an investigation fixture, not a production session policy.

## Unadmitted production-policy candidate

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
