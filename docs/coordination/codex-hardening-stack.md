# Codex hardening follow-up coordinator

Captured 2026-11-24 from the approved PR 0 brief. Implementation has not started.
The coordinator stops after the draft PRD root and launch-ready first-owner handoff.

## Baseline and scope

Live `origin/main` was fetched twice during preparation and is
`3de0afbd9d34289779a7c8e832c3c3e6d0e48986`, the historical minimum confirmed on
November 24, 2026. Re-fetch at dispatch; a later main is preserved and any baseline
change is coordinated explicitly. PRs #1029, #1050, #1058, #1062, #1072, #1080,
#1084, #1086, #1087 and #1093 are historical landed work, not new implementation.
The nine `codex-parity-*` changes and completed catalog follow-up `55f8ac69` remain closed.

Users bring personal or company-provided Claude/Codex access. Preserve their
authentication, explicit model/provider/binary selections and organizational
restrictions. Ordinary CLI use needs no separate API account/key. New billing or
accounts, general API-model expansion, new OS-keystore backends and direct API
adversarial review are excluded. A blocked criterion remains open until proven or
the user explicitly narrows the scope.

The original checkout `/Users/ryankeith/ndx-core/n-dx` is on
`codex/pr-stack-review-remediation` and had unrelated `.n-dx.json`, two changesets,
usage-cleanup and pnpm-store changes. None belongs to this PR. PR 0 is isolated at
`/private/tmp/ndx-codex-hardening-pr0`, branch `codex/codex-hardening-pr0`.
Rex MCP `get_capabilities` verified startup binding to this exact worktree;
`get_prd_status` verified schema `rex/v2`, adapter `v2-change-layer`, and legacy
directory layout: `.rex/product/` and `.rex/changes/` with `state.yaml`. All PRD
mutations use the built current-main Rex stdio MCP API, sequentially. No cache,
export or legacy `prd.json` is a backend.

The user separately authorized a runner refresh after pausing its active Claude
run. The clean, idle `/Users/ryankeith/ndx-core/ndx-runner` was advanced to the same
main SHA, dependencies refreshed with the frozen lockfile, all packages rebuilt,
dependency drift checked and CLI version `0.10.4` verified. The unused local
`main` ref was advanced too. The original dirty checkout was not switched.

## Product placement

Standing requirements are preserved byte-for-byte. Every new change uses `touches`,
not an amendment. Product areas and all five target nodes were re-read through
current tools before capture.

| Key | Contract | ID | Owning slots |
| --- | --- | --- | --- |
| C | Codex Workflow Support | `7e14ce05-95ad-4fa4-adc9-73d0c6742566` | 1–6 |
| T | Repository trust cannot widen execution/credentials | `1bb0333a-d834-4e68-81d6-d728c2f8fcef` | 1–6 |
| S | Sidecar sessions | `1710be37-554f-47bf-a9e0-609a6ab90768` | 3–6 |
| M | Consistent vendor and model resolution | `e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb` | 3, 5, 6 |
| K | Per-user credential store | `2c0a3e60-2840-4695-8aee-fb720b6f9a1e` | 2, 5 |

Slot 0 touches all five contracts for capture only; slot 1 touches C/T; slot 2
C/T/K; slot 3 C/T/S/M; slot 4 C/T/S; slot 5 C/T/S/M/K; slot 6 C/T/S/M.

## Ordered work and ownership

The root planning change is `e1f1750a-083b-4e37-83df-ab92e2fd90de`. Dependencies enforce a linear
stack: root → MCP isolation → policy → login/session identity → hub portability
→ managed configuration → integration evidence/UX. Each task has structured
acceptance criteria, priority, provenance and explicit logical owner. An owner is
a launch role, not a running chat or cross-worktree claim. No owner chat or
subagent has been created.

| PR slot | Change | Work units in execution order | Predecessor change | Owner/status |
| --- | --- | --- | --- | --- |
| 1 | `1db22861-16c4-4361-92a5-692d63fc46c8` | 1. `25270990-b5b0-413c-9719-6f70e9c3d38f`<br>2. `722f0341-7454-4ac9-bd16-cf97cd090e24`<br>3. `5d599339-5a76-42db-a124-5d816c4161b8` | `e1f1750a-083b-4e37-83df-ab92e2fd90de` | codex-hardening-pr-1 — NOT STARTED |
| 2 | `cf5b4ccc-b418-41db-b2ad-a0c38097e8a9` | 1. `946c5cd9-4b76-4901-bd01-6649a70e284a`<br>2. `054e2c9c-61a9-4ab8-9fb6-908f29fba024`<br>3. `04dc7d8a-253c-449f-8a9c-70fa5cfbb878`<br>4. `c06702da-6729-4f88-831f-cf016b95b984` | `1db22861-16c4-4361-92a5-692d63fc46c8` | codex-hardening-pr-2 — NOT STARTED |
| 3 | `7fe76a6f-78e4-4289-b7a5-4d41bc24d5fd` | 1. `262fd7de-b9da-4954-9cc8-bd159e25e3de`<br>2. `cde3b8f7-640e-472b-9b96-a3f578edefa6`<br>3. `64c4375c-fb8f-486d-99e2-2d8308d76a9c` | `cf5b4ccc-b418-41db-b2ad-a0c38097e8a9` | codex-hardening-pr-3 — NOT STARTED |
| 4 | `9c0f7809-98cf-49be-a03a-3b1646c2e29a` | 1. `cae39f80-8664-4bac-ae6e-226972e1adac`<br>2. `2d86d1ce-55f0-4930-8804-f046785cc81c`<br>3. `8e8ad8de-6cae-44b8-afe3-7f2d44ea5d73` | `7fe76a6f-78e4-4289-b7a5-4d41bc24d5fd` | codex-hardening-pr-4 — NOT STARTED |
| 5 | `0231fd52-2bcb-483f-bf77-bd89bb24d939` | 1. `4fb6419e-6d59-4e91-836f-e759c79fe327`<br>2. `fc02c0b7-84e9-4f2f-9bf0-62687ac0933b`<br>3. `bc1816c6-3449-4d0f-b48a-a87347104a58` | `9c0f7809-98cf-49be-a03a-3b1646c2e29a` | codex-hardening-pr-5 — NOT STARTED |
| 6 | `3d8ec610-aa8a-4983-8053-00cdd7d2a0b7` | 1. `f3311428-10bf-4ed0-a4e5-ec6c92722575`<br>2. `97acf4e3-73db-474a-9ee4-8f79e4b88241`<br>3. `5e12c9b2-f2d7-4933-a04e-6cfa15992879`<br>4. `5992c343-1ce0-4745-bdd7-efe08c8e3b5a` | `0231fd52-2bcb-483f-bf77-bd89bb24d939` | codex-hardening-pr-6 — NOT STARTED |

Run one work unit per invocation and stop; one owner may retain context for its
remaining work units. Each new change blocks the next numbered change. Task edges
and reused backlog edges express internal order too. Existing UX items may be
executed serially in the listed order even though both are graph-blocked only by
the integration audit task. An explicit `--task` can bypass blockers, so launch
with `--require-unblocked` and check the predecessor's review/evidence handoff as
well as its PRD status. PRD completion alone is not integration approval.

## Settings and sources

On 2026-11-24 the user explicitly chose to continue the prior Codex stack settings
in isolated owner checkouts. This resolves the conflict with main's shared
`llm.vendor=claude` / `claude-opus-5-5` settings. Never change shared config to make
the new stack run. Use an explicit ignored local override in each owner checkout,
and resolve the effective settings before execution; there is no supported
`--vendor=codex` work flag in this baseline.

| Setting | Required value | Source |
| --- | --- | --- |
| Executor vendor | Codex | User's 2026-11-24 selection; isolated local `llm.vendor` |
| Provider | `cli` | Saved `run.provider`, inherited from completed task `5d47b98c` |
| Executor model | `gpt-6-astra`, heavy tier | Saved `run.models.codex` / `run.tier`, same source |
| Review | Mandatory `self`, fresh distinct CLI session | Saved `run.review=true`, `reviewMode=self`; user brief requires distinct freshness |
| Reviewer model | `gpt-6.2-astra`, heavy tier | Saved `run.reviewModels.codex` / `run.reviewTier`, same source |
| Missing review | Refuse; `reviewOptional=false` | Saved run block; no optional-review flag |
| Test gate | Enabled; `skipTestGate=false` | Saved run; force with supported `--no-skip-test-gate` at launch |
| Gate command | `node scripts/run-all-tests.mjs affected {base}` | Main `.n-dx.json` `hench.testGate.command` |
| Gate rerun | `node scripts/run-all-tests.mjs {suites}` | Main `hench.testGate.rerunCommand` |
| Login | Existing Codex CLI login; no API key/account creation | User scope; explicit local `llm.codex.auth=cli` |
| Binary | Selected installed Codex CLI, no replacement | Resolve actual path/version at dispatch; observed `codex-cli 0.167.0-alpha.3.2` on macOS |
| Permission mode | No Claude permission-mode override on Codex | Resolver reports vendor-unsupported; native Codex policy must remain truthful |
| Max turns | Configured 200, subject to trust-safe resolver fallback | Main `.hench/config.json`; exact effective value recorded in filled packet |
| Token budget | 0 (unlimited) unless effective existing config says otherwise | Built-in default; never invent a new cap silently |
| Review rounds | 2 absent a stronger existing setting | Built-in default |
| Freshness | Fresh owner and distinct review; no shared resumed reviewer | Brief, not an inference from `reviewMode=self` |

Saved run blocks preserve both literal Codex pins. They do not select the vendor
by themselves. Historical per-invocation `--skip-test-gate` exceptions and obsolete
context notes are not carried forward. Pair reviewers are PR 2 implementation
coverage; they do not change the chosen owner-review mode. If a pin, login,
enforcement capability or required review is unavailable, stop with the exact
reason instead of substituting a model/provider/auth mechanism or weakening a gate.

## Backlog reconciliation

| Item | Current evidence | Ownership/disposition |
| --- | --- | --- |
| `fc02c0b7-84e9-4f2f-9bf0-62687ac0933b` | Pending. Provider forwarding and isolation landed in #1093; original real Azure-account criterion remains unproven. | Reuse under PR 5 owner; predecessor is managed-config task. Preserve the Azure criterion unchanged. No paid account was inspected or created. |
| `350dbd5a-c148-4ba1-ab80-683fa5c2ac0d` | Mixed pending credential-store leftovers, including deferred keystores. | Keep parent and unrelated tasks intact. Only existing shell-policy evidence task `054e2c9c` is assigned to PR 2 and wired into its task order. |
| `bd53209a-99f9-4ad6-863d-7512e66a1c2e` | Historical exported-key policy complaint; title is not proof of current behavior. | PR 2 boundary-evidence owner reproduces and documents current safe posture. Existing task stays open outside automatic completion; exposing more credentials requires an explicit substantive policy decision. |
| `cb238ec9` / `7ce15d95` / `a10f7f31` / `68b2709d` | Claude deny abbreviations, API-store wording, Claude scrub claims, OS keystores. | Retained outside this stack; no wholesale credential-store absorption. |
| `cde3b8f7-640e-472b-9b96-a3f578edefa6` | Current `sidecar-drawer.ts` still matches first open ID across transcript; real resumed-turn ID reuse is not yet verified. | PR 3 owner; deterministic two-turn interruption reproduction and actual CLI observation required. Preserve both criteria. No feature code changed in PR 0. |
| `97acf4e3-73db-474a-9ee4-8f79e4b88241` | Current `tooling-summary.ts` still hardcodes Claude label/default; UI reproduction not performed here. | PR 6 owner; preserve original criteria and verify actual configured/session pins in UX. |
| `5e12c9b2-f2d7-4933-a04e-6cfa15992879` | Current config help lacks a Codex codes section while auth/no-key code generation remains. | PR 6 owner; current CLI reproduction and parity regression required, retaining criteria. |
| `55f8ac69-075a-427f-b600-5b705496ff76` | Completed catalog/picker validation repair in first stack. | Preserve completed status and behavior. No generalized opaque-model expansion. |

Existing changes remain in their original folders to preserve provenance; owner,
dependency and reconciliation notes were edited through supported tools. No old
failureReason or title is used as a current completion or defect verdict.

## Evidence, validation and warnings

The [support matrix](codex-hardening-support-matrix.md) assigns every coverage gap
and describes required evidence. [Validation evidence](codex-hardening-pr0-validation.json)
records the baseline and final checks compactly. Required startup suites passed
at baseline: 2 files, 14 tests; dependency drift check passed and local builds
used current-main sources. No implementation test, native enforcement test,
live model/account call or browser flow was run by PR 0.

Baseline Rex validation returned `ok: true`: schema/version, DAG and blockedBy
cycle checks pass. Existing warnings: 1 stale in-progress task (`0cd4914e`), 15
timestamp inconsistencies and 3 parent/child status inconsistencies. Structure
health separately reported 488 warning-level tree rules: 338 unreviewed specs,
81 release-token titles, 65 criteria-growth and 4 capability-criteria warnings;
zero reader warnings. Git landing diagnostics reported 1,037 missing historical
landing attributions against `origin/HEAD`; these are diagnostics, not evidence
that the already-verified historical parity PRs are unmerged. No unrelated repair
is included. Final validation must compare warning identities, not only totals.

PR 0 changes no publishable package source or public contract, so CI's
package-source changeset rule does not require a changeset. Do not add an empty
changeset. Implementation PRs require scoped patch changesets, atomic code/PRD
commits, and a final contiguous `N-DX`, bare `N-DX-Item`, `Co-Authored-By` block.

## Dispatch, integration and remediation

Only PR 1 is launch-ready after this root is committed and its draft exists.
The filled external handoff records the exact root SHA (a commit cannot embed its
own SHA). Its checkout is `/private/tmp/ndx-codex-hardening-pr1`, branch
`codex/codex-hardening-pr1`, draft target `codex/codex-hardening-pr0`.
The [PR 1 startup contract](codex-hardening-pr1-startup.md) is completed with that
SHA, actual resolver output and root PR URL in the final handoff.

Owners 2–6 are **NOT STARTED / NOT DISPATCHABLE**. Reserved branches/checkouts are
`codex/codex-hardening-pr-N` and `/private/tmp/ndx-codex-hardening-prN`.
Each permitted draft target is the immediately preceding branch. Exact base SHA
and predecessor handoff/head remain UNASSIGNED until the predecessor finishes;
never invent future SHAs or dispatch on the planning root to keep a session busy.
Their work unit order and inherited settings are in the tables above. Scope is
the numbered change plus specifically assigned retained items; exclusions apply
to all. Required evidence is the slot's structured criteria and support matrix.

Before dispatching a successor, read a compact handoff containing committed owned
paths, exact base/head and PR target, task IDs/status, validation commands/results,
mandatory fresh distinct review report and disposition, evidence links, stable
interface and downstream impact. CI is separately pending/passed/failed/skipped;
local results do not imply CI passes. No must-fix or should-fix silently defers.
Missing native/account/platform evidence keeps dependent work blocked.

The coordinator alone schedules restacks or baseline changes, after an owner is
idle and owned state clean. No force push or published-branch rewrite without
explicit user authorization. Never pair PRD/analysis/config writers in one
checkout, mutate shared real auth/global config, merge or enable auto-merge.

### Finding ledger

| PR/head | Task IDs | Comment/evidence | Severity | Owner | Disposition |
| --- | --- | --- | --- | --- | --- |
| PR 0, recorded by final handoff | Root planning change | Schema, graph, placement, warning comparison and startup evidence | — | coordinator | Capture only; independent feature review not claimed |
| PR 1–6, no heads assigned | See work table | No implementation/review session started | — | numbered owner | NOT STARTED |

Use this remediation packet for each concrete finding: introducing PR and exact
head; affected task IDs; linked comment and minimal reproduction; severity and
must-fix/should-fix verdict; required acceptance evidence; owning session; affected
successors/interfaces; disposition; repaired head and affected validation/review
results. Reactivate the original owner when useful, otherwise supply its compact
handoff to a fresh repair session. Re-run affected gates after repair/restack,
not unchanged gates repeatedly. Report measured token/cache usage when available;
session count alone is not a cost measure.

### Stop boundary

PR 0 publishes only planning/PRD/documentation. No user-owned Codex chat, subagent,
PR 1 implementation, merge or auto-merge is started. The coordinator ends its
active turn after the launch-ready handoff and remains idle until requested.
