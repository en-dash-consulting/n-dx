---
id: "7d415177-7a90-4035-9841-807ddf29bada"
level: "task"
title: "Hench rebuilds the packages a run changed before the affected test gate"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "Since #588 the affected gate refuses to run when a package the change edited under src/ has an older dist/ (test-gate: stale-dist=<dirs>). Hench does not rebuild before the gate, so a run whose agent skips `pnpm --filter <pkg> build` fails even when its committed work is correct. Run 699cd138 (task b32a3e6f, PR 13) failed this way: rebuilding rex and re-running the same gate passed 5/5 suites. A second trigger (seen on the PR 17 store-transaction run): the agent did rebuild, then the in-run reviewer's repair edited source and hench went straight to the gate; a gate-only retry does not rebuild either. Every run that edits a package's source is exposed, by the agent or by a review repair.\n\nAcceptance criteria:\n1. Immediately before the affected gate, after any review repair, hench builds each package whose src/ the run changed (pnpm --filter <name> build), and records the build in the run record (test).\n2. A gate-only retry rebuilds the same way before it runs the gate (test).\n3. A review repair that edits only tests triggers no build beyond what the agent's own changes need (test).\n4. A build failure fails the run with the build output, not as a stale-dist gate failure (test).\n5. A run that changes no package source builds nothing (test).\n6. The brief no longer needs to tell the agent to rebuild before finishing."
lastModified: "2026-10-08T21:41:00.317Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
