# Executor MCP binding — work unit 25270990

**Overall disposition: BLOCKED.** This is an incomplete PR 1 draft. The executor
task remains failing; reviewer wiring and model-driven isolation proof have not
started. Do not dispatch a successor. The current enumeration-and-override
mechanism has an unresolved settings race described below and is not a stable
completed isolation interface.

Scope: executor launches only. Reviewer wiring and full model-driven two-worktree
evidence remain the next two work units; Sidecar isolation is unchanged.

## Runtime interface

`prepareAgentMcpConfig` writes the existing run-owned JSON document. Codex passes
the canonical project root and refuses a missing/foreign launcher instead of
inheriting registrations. `VendorSpawnOptions.mcpConfigPath` becomes
`SpawnConfig.codexMcpBinding` in the Codex adapter. `spawnWithAdapter` applies the
binding after private scratch configuration, on fresh, resume, fork and retry.
Orientation carries the binding with both servers disabled, preserving its
read-only MCP posture. The first native check precedes the PRD status transition.

`bindCodexMcp` validates the file against the executing installation and actual
canonical spawn cwd, reads the native effective configuration, disables unrelated
registrations/apps, sets the required Rex/SourceVision commands, arguments and
cwd, and reads the effective configuration again. Unsafe inherited transports,
server environments, missing required servers or wrong roots refuse. The file
is re-read after native verification; missing or modified files are not repaired
silently. A native server name that cannot safely be addressed by CLI overrides
also refuses. No credentials are put in argv or copied to a new home.

Codex merges table overrides, so `-c mcp_servers={...}` alone does **not** exclude
ambient registrations. The implementation keeps native user/profile and
organizational settings loaded rather than using `--ignore-user-config` on work
turns. An unsupported native configuration protocol refuses without fallback.
`readCodexEffectiveConfig` is the shared bounded reader used by this check and
the existing private-temp check; it never starts a model thread.

## Evidence and limits

On 2026-11-24, the selected macOS `codex-cli 0.167.0-alpha.3.2` passed
`tests/integration/codex-worktree-mcp.test.ts` with
`NDX_TEST_CODEX_BINARY` set to the selected executable. The three cases use the
production adapter and binding with fresh/resume/fork arguments, real native
`config/read`, and actual Rex/SourceVision stdio servers. Each creates an anchor
and two Git worktrees with distinct task and analysis sentinels. The disposable
operator config points Rex at the anchor, SourceVision at the sibling, and
declares an unrelated server. Model/provider pins survive; unrelated MCP is off.
PRD intent/state SHA-256 comparisons show only the assigned backend changes.
The assigned execution log receives the probe entry; operator config is unchanged.

These are native configuration and direct MCP observations, **not** model-driven
Codex execution, account, reviewer or native filesystem confinement evidence.
The native suite is opt-in and skips without the explicit binary pin. Loopback
listening is denied with EPERM in this owner session, so a local Responses
fixture cannot provide model-driven execution evidence here. No real auth was
read or copied into these fixtures. Shared Git claims metadata is outside the
PRD hashes; these probes do not claim a task.

Deterministic executor loop regressions cover fresh/batch resume/warm-parent
fork/transient retry, disappearance after orientation, binding corruption before
retry and a missing launcher before task status writes. Existing Claude pinning
and reviewer fixtures remain regression coverage, not reviewer isolation proof.

PR 2 can consume the binding annotation without replacing native policy. PR 3
must include the effective binding in its session identity work. Neither may
treat MCP routing as a shell/read-path boundary. The outer run still owns the
affected test gate, mandatory distinct review and atomic task completion.

## Owner-session validation and handoff blocker

- `pnpm --filter @n-dx/llm-client typecheck` and `pnpm --filter @n-dx/hench typecheck`: passed. Both changed packages built successfully.
- llm-client `tests/unit/codex-scratch-env.test.ts`: 26 passed.
- Hench executor/native selection (9 files): 109 passed, including all 3 opt-in native cases. Additional shared lifecycle/adapter/Claude regression selection: 225 passed (overlapping coverage).
- Config writer, binding and Claude pinning selection after file-permission hardening: 36 passed.
- Root `cli-dev`, `scheduler-startup`, `architecture-policy`, `domain-isolation` and `changeset-body-policy`: 242 passed. `git diff --check`: passed.

The executor's native sandbox refused `git add` when Git attempted to create
the linked worktree's shared index lock. The host Hench process later committed
ten files containing review repairs as `f3e6d690ac3bf1b158a79babc389c2bf90e38c16`.
The owner preserves the remaining work with the task still failing; no atomic
successful-completion commit or completed acceptance is claimed.

The exact-pinned fresh reviewer was a different actual session:

| Role | Model | Session |
| --- | --- | --- |
| Executor | `gpt-6-astra` | `01a21031-319a-7132-a752-7ab1426dace1` |
| Reviewer | `gpt-6.2-astra` | `01a21044-833b-70c3-a47d-1e797d77fe1b` |

Both transcript metadata records name the assigned canonical checkout and CLI
`0.167.0-alpha.3.2`. The review was fresh, not resumed from the executor.
Only nonsecret metadata is published. The [review record](codex-hardening-pr1-review.json)
preserves every finding and disposition: six must-fixes repaired, one medium
should-fix still open. Repairs cover redirected state directories, plugin MCP
exclusion, cancellation and three fixture defects. Post-repair checks passed
309 Hench, 26 shared-reader and 242 root startup/policy tests. Both changed
packages built and typechecked; dependency drift and whitespace checks passed.

The open finding is a concurrent native settings save between the final
`config/read` reply and `exec` loading configuration. A newly added MCP server
was not enumerated and therefore has no disabling override. Native probes
confirmed that table overrides merge rather than form an allowlist. A native
allowlist or a launch sharing the verified configuration snapshot is still
needed. The finding is recorded on the existing executor task through supported
Rex operations; no new task or silent deferral is used.

The declared affected gate selected 16 suites and ran for 504.8 seconds. Its root
suite reported failures, including inaccessible shared Git metadata, a missing
gateway contract inventory entry and missing baseline Graview build output. The
owner interrupted at this blocker; 15 selected suites did not run, and the
automatic root rerun did not start. This is a failed/interrupted gate, not a
pass. A host-side source-file diagnostic passed all three tests that failed to
initialize inside the gate. The owned gateway inventory was repaired, baseline
Graview was built, and all 340 cross-package contract tests then passed. Other
root failures were not exhaustively classified or repaired outside this scope.
No guard, trust, authentication or confinement setting was weakened.

Native MCP calls from the executor and reviewer required approval under their
`never` approval policy. Direct stdio calls verified the assigned workspace
before any supported PRD mutation. The stopped run's existing task is failing;
saved settings, criteria and dependency IDs were checked unchanged after the
handoff update. The claims registry contains zero claims for that task.

Full model-driven fresh/resume/fork/retry/self-review/pair-review proof, negative
sibling claims/log attribution, and its retained before/after hash evidence are
still open. Work units `722f0341-7454-4ac9-bd16-cf97cd090e24` and
`5d599339-5a76-42db-a124-5d816c4161b8` remain pending and blocked by the earlier
unit. PRs 2 and 3 must not assume this provisional interface is complete. The
owner made no restack, merge or successor dispatch. CI is reported separately
on the draft PR.
