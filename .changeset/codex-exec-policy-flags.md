---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

Stop emitting `--full-auto`, which `codex exec` no longer accepts.

`compileCodexPolicyFlags` returned `["--full-auto"]` for `workspace-write` +
`never` — the autonomous default. codex-cli 0.147.0 removed that flag from
`codex exec`, so every unattended codex spawn died on argument parsing before
reaching the model: `error: unexpected argument '--full-auto' found`. The whole
codex agent path was broken.

Both halves of the policy are now stated explicitly — `--sandbox <mode>` plus
`-c approval_policy=<value>`, since `codex exec` has no approval flag. That is
also more robust than a preset: a preset is a name codex can retire, while
`--sandbox` and `approval_policy` are the settings it was composed from. The
one preset kept is `danger-full-access` + `never` →
`--dangerously-bypass-approvals-and-sandbox`, still on the exec surface and the
only way to express "no sandbox at all".

`mapApprovalToCodexFlag` returned `"default"` and `"full-auto"` — names of exec
flags, not `approval_policy` values, and both gone. It now returns the config
values codex accepts (`on-request`, `never`), read off the CLI's own rejection
message, and the compiler uses it so the mapping is single-sourced.

The gap that let this ship was that every test asserted our flags against our
own expectations. A new integration test scrapes `--help` from the *installed*
codex and asserts each flag we emit is one that binary accepts, for both `exec`
and `exec resume` — so the next arg-surface drift fails a test instead of
silently breaking every run. It skips when codex is absent, and says so.

Verified end to end against codex-cli 0.147.0: a real autonomous spawn now
exits 0 with `turn.completed`, and resuming that thread answers from the prior
turn with 85% of input tokens served from cache — the batch session strategy
working on codex for the first time.
