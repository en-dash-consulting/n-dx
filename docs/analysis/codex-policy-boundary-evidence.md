# Codex policy boundary evidence — 2026-11-18

Task: `9285e760-055c-4638-adf0-63358f35a339`. Incomplete; do not use this
record as admission evidence for Codex hub sessions.

## Same-task correction — 2026-11-18

The earlier run explicitly reported incomplete criteria, but the outer runner
subsequently recorded completion. The coordinator restored failing status. Test
counts and successful compilation were not proof of the remaining boundaries.

Strict configuration parsing now applies to read-only and full-access modes as
well as workspace-write, on fresh and continuation invocations. Full access
rejects `networkAccess=false` and nonempty `writableRoots`: disabling the sandbox
cannot enforce either restriction. Read-only rejects `networkAccess=true`,
which these legacy controls cannot express. Read-only grants no writes,
regardless of the writable-root upper bound. The default workspace-write policy
is unchanged. No failure retries by dropping strict parsing or sandbox controls.

Regression coverage includes all sandbox/approval combinations and continuation
flags, explicit errors for unrepresentable combinations, scripted old binaries
rejecting strict parsing without fallback, and conflicting config followed by
the enforced policy on fresh/resume/fork turns. These are compiler and fake-CLI
contracts, **not** installed-CLI enforcement evidence.

### Host evidence reviewed for this correction

The coordinator ran both probes on macOS on November 17, 2026 (America/New_York).
The review inspected the local copies of both JSON records and their probe
scripts. Both fixtures contained repository configuration requesting full
access, approval on request, network access and an additional writable root.

| Host record (SHA-256) | Observed result |
| --- | --- |
| `pr8-kernel-probe.json` (`39acf3901a2939e2b7b6f3ea568ffa0ae16d4d2aa6ad53d79cc1161e3178e8a7`) | The native sandbox command accepted a workspace write and `git status`. Writes to the outside directory and fixture TMPDIR and a local socket operation returned EPERM. A local Git config update failed to lock `.git/config`. This probe passed the compiler's configuration overrides to the sandbox command. |
| `pr8-live-probe.json` (`03858d9ecfa5f2de1289eab12bbee1597b6942ae05977f770d75e89c312a44f0`) | On installed `codex-cli 0.167.0-alpha.3.2`, fresh, resume and fork each completed with exit 0. Resume reused the fresh session ID and fork received a distinct ID. Each recorded context selected workspace-write, approval never and network disabled. Each phase recorded a successful workspace write and `git status`, EPERM for both outside writes and the socket operation, a denied Git config update, and empty or absent values for all three credential variables in the child shell. |

The outside-read canary succeeded on every live turn. Hub admission therefore
remains refused. The Git update exercised filesystem protection for `.git/config`.
Native Git-subcommand filtering remains unsupported. The host observations cover
workspace-write on this macOS binary. Runtime coverage of the other sandbox
modes, other versions, Windows and browser flows remains outstanding.

Validation in the correction session: llm-client build passed; 151 focused
llm-client tests passed; 427 Hench adapter/fixture/Git-guard tests passed, plus
the three session-reuse tests; the required root startup checks and changeset
body check passed (21 tests). The installed-CLI flag-surface suite passed all
12 checks. It reads help and version output and passes individual configuration
overrides to `codex exec --strict-config` with stdin closed, checking for
unknown-field and unknown-variant errors. Its startup warned that
PATH aliases could not be created in the enclosing sandbox.

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

## Earlier attempt's installed binary observations (not mocks)

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

The earlier attempt lacked selected-binary enforcement and adversarial
repository-config evidence; the coordinator's subsequent report is separated
above. Explicit disclosure of unsupported native command/Git/read-path guards
is within the approved task scope; implementing a native command allowlist is
not required to replace that disclosure. Hub admission remains refused because
native read confinement is insufficient. The correction covers all-mode policy
compilation and unsupported-flag failures, but does not establish all-mode
kernel enforcement.

Official reference rechecked during implementation:
[Codex configuration reference](https://developers.openai.com/codex/config-reference),
particularly `sandbox_workspace_write.*` and the warning that permission
profiles cannot be combined with legacy sandbox settings. Documentation alone
does not prove the installed binary enforces a boundary.
