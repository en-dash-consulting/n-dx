# Codex policy boundary evidence — 2026-11-18

Task: `9285e760-055c-4638-adf0-63358f35a339`. Incomplete; do not use this
record as admission evidence for Codex hub sessions.

## Implemented subset

Workspace-write compilation now explicitly sets network access, replaces
additional writable roots and excludes implicit `/tmp` and `TMPDIR` grants.
It requests strict config validation, so unsupported flags/config fail rather
than silently dropping those overrides. A policy omitting `.` is rejected:
Codex workspace-write always grants the working directory and cannot express
writes restricted to a subdirectory through these controls.

Run resolution, the dashboard preparation warning list, live run output and
saved diagnostics identify unsupported Hench command, Git-subcommand and
blocked-read-path controls. The warning does not enforce them. There is no
automatic provider fallback. The existing hub refusal remains in place.

## Installed binary observations (not mocks)

- `codex --version`: `codex-cli 0.167.0-alpha.3.2`.
- Fresh, resume and fork help advertise `--strict-config`; the continuation
  forms accept config overrides.
- A disposable fixture under `.local_testing/`, with an empty isolated HOME
  and CODEX_HOME and no credentials, ran:
  `codex sandbox -c 'sandbox_mode="read-only"' -c 'sandbox_workspace_write.network_access=false' -- /usr/bin/true`.
  It exited 71: `sandbox-exec: sandbox_apply: Operation not permitted`.
  The enclosing sandbox prevents the nested sandbox from starting. This is
  **not** evidence of successful read/write/network confinement.
- No authenticated model calls, account/model availability checks, browser
  flows or live fresh/resume/fork confinement checks succeeded in this run.

## Automated evidence and remaining work

Compiler tests check explicit network/root overrides and reject a policy
narrower than the native workspace mode. Adapter and scripted session tests
check fresh/resume/fork arguments, credential masking and persisted capability
notices. These are mocks/argv contracts, not kernel boundary evidence.
Existing API guard tests exercise allowed read-only Git commands and rejected
Git operations; they do not prove native Codex command restrictions.

Still required before completing the task: real selected-binary enforcement
and adversarial repository-config tests; command/Git boundary enforcement or
an approved admission policy for unsupported guards; confinement sufficient
for hub sessions; live fresh/resume/fork filesystem, network and credential
isolation. General native config/approval isolation and all sandbox modes
remain outside this subset. Unavailable versions must be assessed separately.

Official reference rechecked during implementation:
[Codex configuration reference](https://developers.openai.com/codex/config-reference),
particularly `sandbox_workspace_write.*` and the warning that permission
profiles cannot be combined with legacy sandbox settings. Documentation alone
does not prove the installed binary enforces a boundary.
