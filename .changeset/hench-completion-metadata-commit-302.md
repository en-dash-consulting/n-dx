---
"@n-dx/hench": patch
---

fix(hench): commit task-completion metadata on the autoCommit path, and stop dropping `fullTestCommand` from config (#302)

On the `autoCommit` path the agent commits its own code mid-run and `performCommitPromptIfNeeded` is a no-op, so the completion/resolution metadata written to `.rex/prd_tree` by `updateCompletedTaskStatus` was never committed — it orphaned in the working tree and tripped the next run's pre-run commit gate. `finalizeRun` now calls a focused `commitCompletionMetadata` helper (autoCommit + completed only) that stages `.rex/prd_tree` and commits it in a small dedicated second commit, leaving a clean tree. The non-autoCommit path is unchanged (it already stages PRD files alongside the code), guarded by a staged-diff check so no spurious second commit is created.

Separately, `HenchConfigSchema` was missing `fullTestCommand`, so Zod stripped the key on parse and `loadConfig` returned it as `undefined` — the full-suite test gate always fell back to auto-detect even when `.hench/config.json` set the command. The field is now declared in the schema.
