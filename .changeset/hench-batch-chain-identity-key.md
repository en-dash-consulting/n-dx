---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Version the batch session chain and key it by the identity it was opened under.

Under `hench.sessionStrategy=batch`, a task resumes the previous task's session.
The chain recorded only vendor, model, a task count and the last task title, so
resuming was permitted whenever those four matched — across worktrees, branches,
source states and permission sets. Two worktrees of one repository running loops
in parallel share all four, which made a cross-worktree resume the ordinary case
rather than an edge one.

The entry is now versioned (`BATCH_CHAIN_VERSION`) and carries the worktree root,
ref, sourcevision fingerprint, execution-policy hash, vendor, model, creation
time and last-use time. Any mismatch is a named miss — `worktree-changed`,
`ref-changed`, `sourcevision-changed`, `policy-changed`, `vendor-changed`,
`model-changed`, `expired`, `idle`, `unversioned`, `version-changed`,
`malformed`, alongside the existing `no-chain`, `cap-reached` and `disabled` —
and identity is checked before freshness and the cap, so a chain belonging to
another checkout says so instead of reporting that it filled up.

The policy hash matters more than it looks: `codex exec resume` accepts no
sandbox or approval flags, so a resumed thread keeps the policy that created it.
Before this change, tightening `hench.guard` between tasks left the next task
running under the looser policy with no signal.

Two bounds rather than one TTL, because they catch different drift: total age
(`hench.batchMaxAgeHours`, default 8) retires a loop whose repository has moved
on beneath it, and idle time (`hench.batchMaxIdleHours`, default 1) retires one
that stopped while someone worked in the same tree by hand. A single bound would
make the last-use stamp unreachable.

The ref is keyed on the branch, not HEAD. A task that completes commits, so
keying on HEAD would retire the chain after every success — batching disabled by
way of it working.

Chains written by earlier versions read back as `unversioned` and are declined
rather than reinterpreted or treated as an error; the next task simply opens a
new one.
