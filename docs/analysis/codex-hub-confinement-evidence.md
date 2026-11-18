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
