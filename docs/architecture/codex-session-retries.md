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
parent. A failed Codex retry continuation exhausts this retry path instead of
recursively resuming or replaying it cold. Missing IDs or failed admission use
the existing cold-retry notice and retry budget. Once a fork reports a child or
work, it cannot take the empty-fork cold fallback. Accounting accumulates across
attempts; review gates and spawn limits still apply. A successful resumed spawn
must confirm the expected session ID before its work/report is accepted.

## Evidence, 2026-11-16

The [official developer commands](https://learn.chatgpt.com/docs/developer-commands)
and [non-interactive guidance](https://learn.chatgpt.com/docs/non-interactive-mode)
describe explicit-ID resume and per-process execution policy. Installed
`codex-cli 0.167.0-alpha.3.2` advertises the required resume flags. The existing
installed-CLI flag-surface tests pass.

An isolated, credential-free fixture ran fresh and resumed turns with
`gpt-6-astra`, workspace-write sandbox, approvals never, ignored user
configuration/rules and shell credential hiding. Both reported the same thread
ID; both were terminated at their 12-second bounds without completing a model
turn. This establishes real CLI thread selection, **not** transcript recall,
model availability, successful transient recovery or successful self-review.

The opt-in `packages/llm-client/tests/integration/codex-resume-live.test.ts`
checks completed marker recall on one thread across work, continuation and
self-review prompts. Its real run failed at the first 15-second turn bound.
It does not convert an unavailable model into a pass. To repeat in an environment
with model access, set `NDX_CODEX_RESUME_LIVE=1` and supply an explicit fixture
credential through `NDX_CODEX_RESUME_API_KEY`; optional `NDX_CODEX_RESUME_BINARY`
and `NDX_CODEX_RESUME_MODEL` select the executable and model. Run:

```sh
pnpm --filter @n-dx/llm-client exec vitest run tests/integration/codex-resume-live.test.ts
```

The live test uses a disposable home and never copies the operator's auth files.
Without opt-in it is reported skipped. No other CLI versions or browser flows
were tested. Authenticated continuity and live Codex self-review remain required
before marking the task complete.

Scripted protocol tests separately cover retry and self-review argv, child
continuity, identity invalidation, prior attempt accounting, bounded resume
failure, review gates and existing batch/pair behavior. They do not establish
real model behavior.
