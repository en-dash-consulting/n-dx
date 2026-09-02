---
"@n-dx/hench": patch
---

Wire the batch session strategy to the Codex CLI.

Codex is the vendor batching most benefits: it has no `--fork-session`
equivalent, so resuming the previous task's thread is its only route out of
per-task cold starts. The strategy resolution and the chain bookkeeping were
already vendor-neutral; two pieces were missing.

The adapter now emits `codex exec resume <id>` when given a `resumeSessionId`,
instead of always opening a fresh `exec`. That branch deliberately passes no
policy flags: `codex exec resume` accepts neither `-s/--sandbox` nor
`--approve-for-me`, and passing either aborts the spawn on argument parsing —
sandbox and approval policy belong to the thread being resumed. It never uses
`--last`, which resolves to the newest recorded session *globally* and would
let any other codex run on the machine capture the chain.

Session-id extraction moved onto the adapter as `extractSessionId`, replacing a
hardcoded `session_id` lookup in the run loop. The key differs per vendor, and
codex's was verified against codex-cli 0.147.0 rather than assumed — it arrives
as `thread_id` on a single `thread.started` event. `session_id` appears only in
the on-disk rollout file, which is a different format from the `--json` stream;
a reasonable guess would have been wrong. Resuming re-emits the same id, so the
chain keeps counting one thread instead of restarting every task.

Adapters that declare no `extractSessionId` fall back to the previous
`session_id` behaviour.
