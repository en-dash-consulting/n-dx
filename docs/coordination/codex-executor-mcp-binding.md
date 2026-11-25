# Executor MCP binding — work unit 25270990

**Overall disposition: BLOCKED.** This is an incomplete PR 1 draft. A bounded
executor repair now uses constrained native exec with strict admission instead
of enumerating mutable registrations. Its real exec race probes cannot run in
the confined executor (loopback listen EPERM); required review and gate evidence
are still outstanding. Reviewer wiring and model-driven isolation proof have not
started. Do not dispatch a successor or treat this interface as completed.

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
canonical spawn cwd. It reads the original native configuration with layers and
the separate `configRequirements/read` RPC, then admits only a bounded projection
for `exec --ignore-user-config --strict-config`. App-server does not accept the
ignore flag: the inspection is not presented as verification of ignored exec.
The original HOME/CODEX_HOME and selected binary remain unchanged. No credentials
are copied, logged or put into argv. Model flags, supported selected provider,
login storage/forced login/workspace and confinement settings survive admission.
Apps, plugins and shell snapshots are disabled. Only run-owned Rex/SourceVision
commands, arguments and canonical cwd are supplied. Native table merging cannot
bring back names from ignored user/project configuration after admission.

Admission requires the verified native version `0.167.0-alpha.3.2`, explicit own
`requirements: null`, and known layer metadata. Empty system placeholders are
distinct from nonempty managed defaults. Nonempty system/default layers, MDM,
enterprise/legacy managed sources, unknown/missing metadata, profiles, hooks and
unprojectable settings refuse before executor spawn. Built-in login and a narrow
Responses-provider subset with environment-backed auth are admitted; unknown
provider fields/helpers/static credentials refuse without evaluation or fallback.
Active project settings beyond MCP registrations also refuse. This is bounded
support, not a claim of arbitrary native/organizational configuration support.

The run-owned file is re-read after admission; missing or modified files are not
repaired silently. Exec consumes the admitted in-memory commands. The shared
`readCodexEffectiveConfig` reader retains its existing config-only behavior for
private-temp callers; `includeLayersAndRequirements: true` returns the envelope
only after both RPCs succeed. It never starts a model thread.

## Evidence and limits

The observations below predate the constrained-exec repair unless explicitly
identified as run `36892404`. Historical failures remain failures.

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

## Bounded continuation cf8abe6a — native race still reproduced

Starting HEAD: `5328b05ea` (the exact assigned predecessor is already integrated
by `31311c75c8261a70ab4211c00ef4a28d8fa45cf6`). No production fix or successful
completion is claimed by this continuation. The six earlier repairs remain
untouched; reviewer and model-driven proof work remain separate and open.

The selected macOS CLI again reports `0.167.0-alpha.3.2`. The new regression in
`packages/hench/tests/integration/codex-worktree-mcp.test.ts` calls the production
adapter and `bindCodexMcp`, then adds a previously absent registration to a
disposable operator config **after binding returns**. Native `config/read` with
the returned executor arguments still enables that registration. Fresh, resume
and fork cases all fail the exact enabled-server-set assertion. No model,
authentication, unrelated MCP process or actual executor was started by this
probe; it demonstrates the configuration race, not model-side tool use.

Three additional disposable native probes retained the foreign registration:

- A complete `mcp_servers` table override containing only the intended server.
- `mcp_servers=false` followed by dotted intended-server overrides.
- `mcp_servers=[]` followed by a complete intended-server table override.

All three retained the disposable operator model pin. Neither a table override
nor a scalar/array reset followed by a table creates a native allowlist on this
binary. Repeating preflight reads cannot close the remaining interval. The
selected CLI's help and generated thread start/resume/fork protocol schema did
not establish a supported exact-set launch mechanism. No replacement binary,
user-config suppression, credential copy, managed-policy override or trust change
was introduced to make the regression pass.

Checks in this continuation (temporary files confined to `.local_testing/`):

```sh
node scripts/check-dependency-drift.mjs
TMPDIR="$PWD/.local_testing/pr1-race-tmp" pnpm --filter @n-dx/hench exec vitest run tests/unit/agent/codex-mcp-binding.test.ts
TMPDIR="$PWD/.local_testing/pr1-race-tmp" NDX_TEST_CODEX_BINARY=<selected-binary> pnpm --filter @n-dx/hench exec vitest run tests/integration/codex-worktree-mcp.test.ts --testNamePattern 'excludes registrations added'
pnpm --filter @n-dx/hench typecheck
TMPDIR="$PWD/.local_testing/pr1-race-tmp" node_modules/.bin/vitest run tests/e2e/cli-dev.test.js tests/integration/scheduler-startup.test.js
git diff --check
```

Dependency drift, typechecking and whitespace passed. Existing binding unit tests
passed 15/15; required startup tests passed 14/14. The new native regression is
**red: 3 failed**, with the three existing native mutation cases unselected.
There is no changed production package to rebuild. The affected gate and fresh
distinct review have not run for this continuation; the known failing regression
is not a passing implementation or a substitute for either requirement.

Owned uncommitted paths are this evidence file and the native regression file.
No commit is attempted with a known failing regression. Rex `get_item` and
`get_capabilities` both refused because approval is required and the policy is
`never`; checkout-local intent supplied context, not successful MCP evidence.
No direct PRD edit or alternate mutation route was used. Outer Hench/coordinator
must retain the executor task as failing and record this continuation's blocker.
Resolving the race still requires an exact-set native launch mechanism or a
verified configuration snapshot consumed by execution that preserves native
authentication and managed restrictions. No safe implementation of that mechanism
was established here. Overall disposition remains **BLOCKED**.

### Outer run outcome and continuation checkpoint

Run `cf8abe6a-abe5-426c-84bf-1bb182ea1799` ended failed after its required fresh
`gpt-6.2-astra` review. The reviewer did not resume the executor, found no new
defect in the characterization edits, and explicitly retained the unresolved
executor acceptance blocker. Its "out-of-scope" verdict refers to this narrow
invocation base, not PR ownership: the race remains owned by executor task
`25270990-b5b0-413c-9719-6f70e9c3d38f` and is not accepted or deferred.

The enabled affected gate selected sixteen suites. Root was attempted and failed
on external shared-Git metadata access and confined package operations; fifteen
suites remained unrun. After repeated timeouts the coordinator authorized a
graceful interruption; a queued root retry also failed/interrupted. The recorded
gate is **failed**, not a pass. No source fix, completed task, model-driven
isolation proof or full-owned-diff passing gate is claimed.

Separate bounded coordinator research subsequently found a viable **fresh-exec
candidate**, so the earlier absence of an identified primitive is not a blanket
unsupported conclusion. On the same selected native binary,
`exec --ignore-user-config` excluded operator and positively verified trusted
project MCP servers, including registrations added after inspection; a control
without that flag started all foreign registrations. Explicit synthetic
provider/model settings were retained. This is local scripted-provider evidence,
not actual-account, managed-policy, resume or fork evidence. Ordinary app-server
rejects that flag and cannot certify the exact ignored exec configuration.

The coordinator authorized one bounded implementation continuation in an
independent local clone at this checkpoint so Git metadata remains inside the
same native project boundary. Native confinement stays unchanged. Admission
must preserve original HOME/CODEX_HOME/auth, exact model/provider pins and
provable organizational restrictions, and specifically refuse unknown mechanisms.
Managed requirements require the separate `configRequirements/read` response
with an explicit own `requirements` field; absence/error is unknown, not an
unmanaged result. Full lifecycle and model-driven evidence remain required.

## Bounded implementation 36892404 — constrained exec, host validation outstanding

Starting/current HEAD: `9e4a8db3aeadb63e63c17b28e373a0e1ca6cf0a3`, branch
`codex/codex-hardening-pr1`. Integrated predecessor remains
`2b1cd99bc11d3058c86ef5fc43f2d27266164ab0`. Only executor task `25270990` was
implemented. No reviewer/evidence task, real login, global config, repository
trust, provider/model pin, saved gate or historical failure record was changed.

The failure diagnosis is unchanged: per-name disabling cannot exclude a name
added after inspection. This implementation takes the authorized different
approach described in Runtime interface above. The previous unsafe native-result
unit assertions are replaced by admission and transport-reset assertions because
ignored exec no longer consumes the inspected registrations. Cancellation,
run-file replacement and the existing six repairs retain regression coverage.

Validation in the confined executor:

- Dependency drift check and settings-only resolution passed; original executor
  `gpt-6-astra`, required `gpt-6.2-astra` self-review, reviewOptional=false and
  skipTestGate=false remain. Existing policy/trust warnings remain visible.
- Both changed packages built and typechecked. Shared native-reader tests:
  31 passed, including separate requirements RPC/error/absence handling.
- Eleven scoped Hench files: 258 passed. They cover admission, binding/writer,
  adapter/helper, fresh/resume/fork/retry, scratch cleanup, self-heal and existing
  Claude-executor/Codex pair-review behavior. Pair tests initially inherited the
  repository ESM package scope from the checkout-local TMPDIR; an ignored
  CommonJS package marker in that temporary root restores ordinary OS-temp
  semantics without changing product code or weakening the tests.
- Required startup plus architecture/domain/changeset policy: 242 passed.
- Selected actual CLI, native config plus direct stdio MCP: three passed,
  including assigned sentinels, original operator config unchanged and only
  assigned PRD intent/state hashes changed. These are not actual exec evidence.
- Actual native exec race cases for fresh/resume/fork/retry: four failed at
  loopback listener setup with `listen EPERM`, before exec. They were not made
  expected failures or skipped to obtain green. The fixture uses a local scripted
  Responses provider and actual production adapter/binding argv; its fresh
  control without the ignore flag must start all three foreign registrations,
  including both trusted-project names. Retry exercises the native continuation
  launch shape; automatic retry dispatch has separate deterministic coverage.
  Host execution of these tests remains required, not a claimed pass.
- Whitespace check passed. The whole-PR affected selection against the exact
  predecessor is now `root,graview,hench,llm-client,rex,sourcevision,web` (list
  only). No new affected-gate or mandatory distinct-review pass is claimed;
  outer Hench retains both responsibilities and their original settings.

`git add` of the twelve owned paths failed with `Unable to create .../.git/index.lock:
Operation not permitted`. No commit was created and no Git bypass was attempted.
The initial `.rex/changes/isolate-codex-executor-and-reviewer/state.yaml` edit was
already present at launch and was neither edited nor staged by this executor.
Rex MCP capability inspection was approval-blocked; local intent and settings
resolution supplied context, not model-side MCP proof. Outer Hench/coordinator
must keep completion open and own supported status/log/atomic commit operations.

Exact host validation commands, owned paths and the required final-trailer commit
message are in ignored `.local_testing/PR1-EXECUTOR-HANDOFF.md` and
`.local_testing/pr1-executor-commit-message.txt`. No PR was published or later
work dispatched. CI was not queried; no CI pass is claimed. **BLOCKED.**

### Post-review host evidence and actual-settings refusal

Required fresh distinct `gpt-6.2-astra` review for run
`36892404-a0d4-4e86-889d-c669957dc4e4` fixed three must-fixes: operator-modifiable
system sources, duplicate `--strict-config`, and cancellation returning incomplete
requirements metadata. The authority helper uses the existing gateway process
primitive; architecture policy passes. A post-authority abort check remains before
binding arguments return. Both changed packages built and typechecked; scoped
review checks passed 87 Hench, 32 native-reader and 244 root tests. Hench preserved
the repairs in `a1644dc6485fd14d118dd67b19b6137e4b1ca399` with task trailers.

The coordinator's stable host rerun passed **all 11 native fixture cases** in
12.83 seconds. Source and native-reader hashes matched before and after. This
replaces the listener gap for those cases, including fresh/resume/fork/retry,
nonvacuous foreign-registration control, built-in provider/policy checks and
managed refusal. It is selected native CLI plus local scripted-provider/direct
MCP evidence; it does not complete the separate actual-model reviewer/proof work.
The historical four duplicate-flag failures and confined listener failures remain
failed evidence, not reclassified passes.

The enabled per-invocation affected gate failed: root-policy passed; root-drift
and six package commands failed/retried under confinement on native-config and
Corepack-cache access, plus an effects-manifest setup timeout. No full-owned-diff
passing gate is claimed. The separate whole-PR host gate remains required against
exact predecessor `2b1cd99bc11d3058c86ef5fc43f2d27266164ab0`.

A read-only preflight with the actual selected production configuration and
literal executor model refused the explicit user-layer top-level `desktop`
setting. Only that field name and layer type were inspected for diagnosis; no
values, configuration, arguments or credentials were exposed or persisted, and no
model request or user-config edit occurred. The supported Desktop-only contract
is being evaluated for bounded compatibility remediation; the task remains
failing until the actual configured path is admitted without substitution and
the required review and validation succeed. Reviewer/proof tasks remain pending.

## Final blocked checkpoint — no authorized live continuation

The actual selected configuration also contains a nonempty string at
`shell_environment_policy.set.NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S`. Both the
startup and fully compiled-policy metadata probes reject that same user-layer
entry. It is neither a private-temp mismatch nor a known compiler credential
mask. The authoritative interpretation, syntax, confidentiality and exact
non-argv preservation mechanism remain unproven. This trust allowlist was not
omitted, defaulted, normalized or forwarded, and real user/auth/global settings
were not changed. Only field names and type/equality predicates were recorded;
no setting values or raw configuration were exposed or persisted.

Two narrowly authorized generated-runtime probes were discarded through
unconditional canonical builds. The original source SHA-256 remains
`2e07d95ec0becb553a31098299c46a6ce0f375043e972607b4a968c828718670` and the rebuilt
generated module SHA-256 is again
`1623176504541f4084384075ede4d9296a359296dbfa6b3258ef9359a3eb2174`.
No model/task invocation occurred after run `36892404`. **Canonical desktop-only
omission, Boolean preservation of the selected native retired `js_repl` switch,
and the proposed bind-aware test-harness repairs remain unimplemented.** An
ignored, approved gate-only hermetic-home/public-pnpm fixture is prepared but has
not run as an automatic task gate; it adds no manual exclusions or guard changes.

Host validation remains explicitly separated:

- The stable native fixture passed all 11 selected-CLI scripted-provider/direct
  MCP cases. Actual model-driven reviewer/two-worktree acceptance is still open.
- The whole-PR host command initially failed: root 5,287, Graview 102, Hench 6,271,
  llm-client 2,988, Rex 7,326 and web 5,926 tests passed; Sourcevision had one
  failure caused by the missing generated PHP grammar.
- The documented SHA-pinned PHP grammar build repaired that tooling prerequisite.
  The failed credentials suite passed 3/3; the complete Sourcevision host rerun
  then passed 3,606 tests with 32 skipped. This validates the combined selected
  host suite set, not a new single passing whole-PR command. Historical failures
  and skips are retained as such.
- The last automatic confined Hench gate remains failed. Its real-config/cache
  dependency and bind-aware environment defects were diagnosed; they were not
  hidden or bypassed. Required startup tests passed in the full host root suite.

Hench exposes only read-only `review pending` inspection; there is no supported
re-review continuation command. Its gate-only retry reaches the same failing
admission first. The clean stable tooling runner was inspected but not launched:
it lacks the new closed-world Codex MCP admission. No internal review function
was invoked outside orchestration and no model/auth/provider substitute was used.

Executor task `25270990-b5b0-413c-9719-6f70e9c3d38f` remains failing; reviewer and
proof tasks remain pending. No successor is authorized. The compact committed
evidence is `codex-hardening-pr1-blocked-checkpoint.json`; exact final head and
owner-local raw evidence locations are in the external owner handoff. **BLOCKED.**
