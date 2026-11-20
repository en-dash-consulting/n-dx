# Codex retry and self-review sessions

`n-dx work` admits Codex retry/self-review reuse only when the selected binary
advertises `exec resume` with config, model and JSON support (version floor
0.167). The admission stamp binds the worktree, branch (or detached HEAD),
explicit model, permission mode, execution policy, binary/version, child
environment and the existing Codex account/config identity probe. Opaque or
unavailable identities disable reuse. A task's own commits on the same branch
do not invalidate its transcript.

The stamp is captured before the work spawn and checked again before retry or
self-review. A resumed spawn reapplies policy and shell credential isolation
through the existing adapter. A reviewer with a different model starts fresh.
An unspecified work model is not assumed equivalent to an explicit review pin.
Pair review and batch-chain admission keep their existing contracts.

Transient retries continue the work child's ID, never a shared orientation
parent. A failed Codex continuation terminates recovery with a
`codex_continuation_failed` log naming the continuation, actual attempt and
configured attempt limit. It preserves the original error and does not claim
the retry budget was exhausted or recursively resume or replay work cold.
Cancellation, run bounds, livelock and classified auth/configuration failures
retain their own outcomes. Missing IDs or failed admission use the existing
cold-retry notice and retry budget. Once a fork reports a child or
work, it cannot take the empty-fork cold fallback. Accounting accumulates across
attempts; review gates and spawn limits still apply. A successful resumed spawn
must confirm the expected session ID before its work/report is accepted.

## Evidence, 2026-11-16

The [official developer commands](https://learn.chatgpt.com/docs/developer-commands)
and [non-interactive guidance](https://learn.chatgpt.com/docs/non-interactive-mode)
describe explicit-ID resume and per-process execution policy. Installed
`codex-cli 0.167.0-alpha.3.2` advertises the required resume flags. The existing
installed-CLI flag-surface tests pass.

An early isolated, credential-free fixture ran fresh and resumed turns with
`gpt-6-astra`, workspace-write sandbox, approvals never, ignored user
configuration/rules and shell credential hiding. Both reported the same thread
ID; both were terminated at their 12-second bounds without completing a model
turn. This establishes real CLI thread selection, **not** transcript recall,
model availability, successful transient recovery or successful self-review.

The opt-in `packages/llm-client/tests/integration/codex-resume-live.test.ts`
checks completed marker recall on one thread across work, continuation and
self-review prompts. Its initial real run failed at the first 15-second turn bound.
It does not convert an unavailable model into a pass. To repeat in an environment
with model access, set `NDX_CODEX_RESUME_LIVE=1` and supply an explicit fixture
credential through `NDX_CODEX_RESUME_API_KEY`; optional `NDX_CODEX_RESUME_BINARY`
and `NDX_CODEX_RESUME_MODEL` select the executable and model. Run:

```sh
pnpm --filter @n-dx/llm-client exec vitest run tests/integration/codex-resume-live.test.ts
```

The live test uses a disposable home and never copies the operator's auth files.
Without opt-in it is reported skipped. That early timeout remains part of the
history; it does not establish successful continuity.

### Later completed authenticated evidence

The later evidence recorded in [PR #1080](https://github.com/en-dash-consulting/n-dx/pull/1080)
used the selected `codex-cli 0.167.0-alpha.3.2` with ChatGPT sign-in through
the **built session API**. Work, continuation and self-review all completed,
reported the same session ID and recalled the exact marker on every turn.
Workspace-write, approvals never, network disabled and shell credential hiding
remained in force. This establishes authenticated transcript continuity on that
selected CLI; the earlier credential-free timeouts are not pass evidence.

The same PR records actual task B run `306e2899-6957-432d-bb3f-a4deafc866e0`:
the explicitly approved Astra self-review resumed the executor's work session,
completed its report with zero findings and passed 370 scoped checks. Mandatory
review and test gates remained enabled. This supplies completed Hench
self-review evidence as well as the built-API marker probe.

These are recorded observations, not new live runs performed for this
remediation. Forced transient, unfinished-session and cancellation failures
remain disposable-fixture coverage; no live fault injection is claimed.
Browser flows, native Windows execution and other CLI versions remain locally
untested.

Scripted protocol tests separately cover retry and self-review argv, child
continuity, identity invalidation, prior attempt accounting, bounded resume
failure, review gates and existing batch/pair behavior. They do not establish
real model behavior.

## Unfinished work and missing reports

Codex recovery recognizes a clean process exit with an open `turn.started`, or
an `in_progress` command item with no matching `item.completed`. These are
structured [CLI events](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts)
and [command statuses](https://github.com/openai/codex/blob/main/sdk/typescript/src/items.ts),
not prose promises or shell ampersands. Failed/interrupted processes stay on
their error/cancellation path. Recovery requires work still unfinished according
to the normal commit gate; completed commits or correctly staged work are not
replayed.

An eligible session gets one continuation under the existing spawn cap, with its
execution identity rechecked and its returned thread ID verified. Failed or
repeated unfinished continuations cannot recursively resume or retry cold. The
continuation prompt forbids repeating completed mutations or commits. Normal
validation and review remain required.

A Codex reviewer that exits successfully without its report gets one continuation
of that reviewer session, including when the reviewer started fresh on a different
model. The report-only continuation rechecks the reviewer's own identity. Missing
or malformed reports fail the review gate for all vendors while preserving work;
`--review-optional` remains the explicit best-effort override.

Earlier observations on 2026-11-16: installed `codex-cli 0.167.0-alpha.3.2`
accepted fresh and explicit-ID resume invocations in a disposable, credential-free
fixture. Both emitted the same thread ID, but each hit its six-second bound with
no completed turn. A separate read-only Codex self-review of this patch hit its
20-second bound with no completed turn or report. Those early probes verify
thread selection only. The later completed authenticated continuity and task B
self-review evidence above supersede their unverified model/self-review state;
successful recovery from injected live failures remains untested.
Scripted fixture tests cover work/reviewer continuation, repeat failure, wrong
thread IDs, identity invalidation, cancellation, shell-text rejection and gates.
