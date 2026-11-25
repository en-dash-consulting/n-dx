# PR 1 startup contract

Use the filled handoff emitted after PR 0 is committed. It contains the exact
base SHA, PR URL and resolver evidence; this tracked file cannot name its own
containing commit SHA. No implementation is started by preparing this packet.

| Field | Value |
| --- | --- |
| Slot/owner | PR 1 / `codex-hardening-pr-1`, NOT STARTED |
| Checkout/branch | `/private/tmp/ndx-codex-hardening-pr1` / `codex/codex-hardening-pr1` |
| Permitted draft target | `codex/codex-hardening-pr0` |
| Exact base/predecessor | Committed PR 0 head, resolved in filled handoff; predecessor review is capture/schema validation, no implementation review claimed |
| Change | `1db22861-16c4-4361-92a5-692d63fc46c8` |
| Work order | `25270990-b5b0-413c-9719-6f70e9c3d38f` → `722f0341-7454-4ac9-bd16-cf97cd090e24` → `5d599339-5a76-42db-a124-5d816c4161b8` |
| Scope | Assigned canonical worktree MCP isolation for executor and fresh distinct reviewer; two-worktree proof |
| Exclusions | PRs 2–6 features; new auth/accounts/billing; API-model expansion; OS keystores; direct API adversarial review; global auth/config edits; subagents; merge/auto-merge |
| Effective settings | User-selected Codex CLI; executor `gpt-6-astra`, heavy; distinct required reviewer `gpt-6.2-astra`, heavy; existing CLI login; gate enabled; exact resolver sources in filled handoff |
| Evidence | Current applicable AGENTS/workflow; meaningful regressions; builds/typechecks for changed packages; required startup suites; affected gate; real selected-CLI two-worktree evidence; fresh distinct review report; stable MCP-binding interface |

The owner reads the full [coordination plan](codex-hardening-stack.md),
[matrix](codex-hardening-support-matrix.md), assigned items and applicable package
AGENTS. Verify base/head and clean owned state. Read `run` blocks in full.
Use one `ndx work` task invocation with `--require-unblocked` at a time. Resolve
before launching; CLI flags outrank task run, hench and llm settings. Never use
an unsupported vendor flag or silently fall back to Claude. The ignored local
override is intentional and user-authorized; preserve shared configuration.

Hench owns claim/status/log and atomic completion commits when work runs through
it. Do not finalize absent evidence or required review. Only commit owned paths;
use scoped patch changesets and final attribution trailers. Stop after the
assigned PR's work and permitted draft. Supply exact base/head, tasks, owned
commits, gate results, review report/findings, CLI/native evidence links, stable
interface and successor impact. CI is reported separately. Do not dispatch PR 2.
