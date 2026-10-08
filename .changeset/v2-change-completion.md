---
"@n-dx/rex": patch
---

Add v2 change completion (`core/change-completion.ts`, not wired yet): a change completes when its last live task does (a pending change only; cancelled tasks block, deleted ones are ignored), or on its own when task-less, then applies to the product layer per `rex.applyOn`. A task-less in-progress change that gains its first task hands its in-flight work and acceptance criteria to that task.
