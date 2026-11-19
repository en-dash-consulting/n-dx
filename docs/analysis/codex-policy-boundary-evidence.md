# Codex policy boundary evidence — 2026-11-18

Task: `9285e760-055c-4638-adf0-63358f35a339`. Supported policy controls and
capability reporting are verified below. This is not admission evidence for
Codex hub sessions: native repository-read confinement remains unsupported.

## PR8 review remediation — 2026-11-19

Task: `83b0a2a3-1f01-4f64-8e93-920b6a685b7e`. Hench's workspace-write
execution and review spawns now own a private temporary directory. The completion
provider uses the same owner. Each spawn adds only that directory to writable
roots and sets `TMPDIR`, `TMP` and `TEMP` in both the CLI environment and its
shell overrides. Resume and fork create new scratch directories; they do not
reuse a path from a prior thread. Cleanup follows child exit, failure or
cancellation, with a process-exit fallback. Host temp roots remain excluded.

The resolved Codex pair reviewer now triggers the unsupported-guard warning
even with a Claude executor. Resolution (also consumed by dashboard preparation),
live output and persisted diagnostics carry the same warning. Core's separate
`n-dx pair-programming` reviewer receives the compiled read-only, approval-never,
strict-config policy and shell credential masks through its existing config
helper boundary. Its test command still runs separately on the host.

New deterministic coverage uses actual Node child processes for ordinary temp
APIs, fresh/resume/fork scratch ownership, error and abort cleanup, symlink-safe
disposal and idempotency. Scripted reviewer tests cover live/persisted warnings
and both core reviewer spawn paths with hostile native config fixtures. These
tests establish lifecycle and argv contracts, **not new installed-Codex
enforcement evidence**. The November 18 host records below predate this change.
The coordinator still owns the fresh mandatory review and any new host probe,
then the original PR8 parent's supported Rex status correction. No task or
parent completion is asserted by this executor.

### Scratch retry — 2026-11-19

The coordinator's `host-scratch.json` records successful installed-CLI
fresh/resume/fork temp APIs and cleanup on 0.167.0-alpha.3.2, bounded writes,
credential masking and denied network access. Its separate core kernel check
denied workspace/temp writes using production reviewer flags. These establish
neither a core model review nor browser/native-Windows confinement.
`host-filter.json` records the counterexample: a native PATH-only `include_only`
removes the temp overrides, leaving Node's temp API at `/tmp` with EPERM.

The retry reproduces populated 0555 cleanup failures with real children under
non-root UID 501, then verifies success, failure and abort results survive
cleanup. Directory-only permission repair skips symlinks and never chmods files;
external directory contents and permissions remain unchanged. Replaced roots
are refused. Irrecoverable cleanup warns once without replacing the child result.

Execution and completion now read `app-server config/read` with the same cwd,
environment and config-loading flags before model work. All three exact private
temp overrides must appear in that effective configuration. A nonempty
`include_only` must explicitly admit TMPDIR/TMP/TEMP (or already contain `*`);
ambiguous filter dialects or unavailable strict configuration support fail
closed. No filter is cleared or widened. The protocol follows the native
[config/read contract](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/config_manager_service.rs)
and sends no thread or inference request.

The review exercised the configuration protocol on the installed macOS
0.167.0-alpha.3.2 CLI with an isolated home. Default and temp-compatible
allowlists passed. A PATH-only allowlist produced the expected refusal.
That binary accepts `--ignore-user-config` on `exec` and rejects it on
`app-server`. Workspace-write calls using that selector stop before execution
and identify the incompatible option. This includes the invocation in the
coordinator's earlier host record. Hench's read-only orientation skips the
scratch preflight. Fresh, resumed and forked model execution with the final
build still requires host verification before the original Rex status correction.

### Final host verification and status correction — 2026-11-19

After commit `5a62b2765`, the coordinator reran the built Hench adapter and
spawn path against the installed CLI. Ordinary workspace-write fresh, same-thread
resume and distinct-thread fork each used a different mode-0700 scratch directory.
Node's normal temp API succeeded; scratch was removed after each child. The
latest turn contexts retained approval `never` and disabled network. Credential
environment canaries were masked, and outside-workspace writes, host-temp sibling
writes and network sockets were denied. Production core reviewer flags also
denied workspace and temp writes in a separate native sandbox check. This was
not a core model review, browser test or Windows verification.

The final probe omitted orientation-only `--ignore-user-config` flags from the
workspace turns; production read-only orientation remains separate. Explicitly
combining that selector with workspace-write remains unsupported on this binary
and fails before model work, without removing the selector or weakening filters.
A separate final PATH-only filter probe returned the actionable TMPDIR/TMP/TEMP
incompatibility with no model session started. Raw records are
`final-live-scratch-probe.json` and `final-live-scratch-filter-probe.json` in the
external PR8 review-remediation evidence directory.

The final mandatory distinct-model review passed 819 scoped tests (164
llm-client, 262 Hench, 41 dashboard and 352 root), including both required startup
checks; changed packages built and passed typecheck. The intensive outer gate
was explicitly skipped. After these checks, supported Rex completion corrected
both the original PR8 change and the remediation change to completed without
reapplying product amendments. Historical failure reasons remain audit history;
the completed status and current resolution detail supersede them. Native
command/Git/read confinement remains unsupported and Codex hub admission remains
refused.

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
workspace-write on this macOS binary. Other versions, Windows and browser
flows remain untested.

After the correction completed, the coordinator reran the native sandbox
probe against the final build in workspace-write and read-only modes. Both
denied outside and temporary-directory writes, the local socket operation and
the Git config update; both allowed `git status`. Read-only also denied the
workspace write. The final workspace-write configuration flags exactly matched
the original reviewed kernel record. These final native-command results are
recorded separately as `pr8-final-kernel-workspace-write.json` and
`pr8-final-kernel-read-only.json`; they are not additional model-session tests.
No full-access bypass was executed. Live read-only continuation sessions remain
untested; the real fresh/resume/fork observations above cover workspace-write.

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
