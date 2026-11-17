# Managed Codex accounting follow-up

Task: 73d10116-abbe-45bb-abf8-aa96073c4429. Updated 2026-11-17.

The incident supplied in the task brief reported work cumulative usage of
5,505,796 tokens and final cumulative usage of 7,677,627. The incremental
review was therefore 2,171,831. Adding work and final counters produced
13,183,423; an assisted record added another overlapping 1,372,616, yielding
14,556,039 instead of 7,677,627. These are supplied observations, not a new
measurement or a dollar estimate. Historical records have not been rewritten.

The first implementation routed every Codex response through the session
counter tracker. Existing invocation-local JSON summaries and text token
summaries then became zero usage. The failed fork fixture also lacked rollout
boundaries and repeated the same counters for parent, child and continuation.
The retry preserves compatibility parsing for fresh legacy responses, selects
session accounting on thread/turn protocol events, and never falls back to
unbounded summaries on an explicit resume. The fork fixture now supplies
inherited parent and child rollout boundaries and checks exact incremental
spend rather than a lower bound.

Disposable fixtures cover resumed review, fork and retry boundaries, replay,
reset, identity mismatch, measured failures, absent baselines, partial output
and terminal rollout recovery. Legacy JSON/text integration tests are retained.
Assisted ownership and downstream ledger fixtures exercise the earlier fix.
Astra review identified partial-output boundary and recovery gaps; both have
regressions. All fixture payloads are synthetic, without production transcripts.

These tests do not independently establish the installed Codex CLI contract.
The actual selected CLI execution, mandatory outer review, full affected gate,
and atomic code/PRD commit remain responsibilities of the enclosing n-dx run.

Validation in the task sandbox: hench build passed; the required root checks,
ledger regression and changeset policy passed (23 tests), as did architecture
policy (217 tests). The complete hench package suite finished with 5,985 passing,
65 failing and 14 skipped tests. Failures are confined to eight validation-slot
and process-tree test files; isolated slot reruns reproduce `uv_uptime` `EPERM`.
No accounting regression failed. This is not a clean full-suite result.
Explicit-path staging failed because `.git/index.lock` creation is denied.
The proposed commit message is prepared; no commit or publication occurred.
