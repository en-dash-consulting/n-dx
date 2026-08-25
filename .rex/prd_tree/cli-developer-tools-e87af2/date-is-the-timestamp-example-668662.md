---
id: "66866236-900b-4dc2-8059-9745891d9ea1"
level: "task"
title: "`date -Is`, the timestamp example in every recording skill, fails on macOS (BSD date)"
status: "pending"
priority: "low"
tags:
  - "skills"
  - "assistant-assets"
  - "portability"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "No canonical skill body in `packages/core/assistant-assets/skills/` contains `date -Is`; the POSIX example is `date -Iseconds` or another command verified on both GNU and BSD date"
  - "Regenerated `.claude/` and `.agents/` copies match the canonical sources (assistant-body drift checks green)"
  - "`tests/e2e/skill-run-recording.test.js` rejects `date -Is` in any skill body that records runs — it fails against today's bodies and passes once they are fixed"
description: "**Severity:** low — **Verdict:** should-fix (captured from /ndx-adversarial-review of branch chore/pr-329-review-followups)\n\n**Failure scenario.** Every recording skill's Step 1 tells the assistant to note the time with \"`date -Is` on POSIX shells, `Get-Date -Format o` in PowerShell\". On macOS, `date` is BSD date, which rejects the short form: `date -Is` exits 1 with `date: invalid argument 's' for -I`. Reproduced live on 2026-08-25 (Darwin 24.6.0) as the literal first command of an /ndx-adversarial-review run. The assistant recovers by improvising a different command, but the prescribed example fails on every macOS machine — the platform this project is primarily developed on.\n\n**Evidence.** `date -Is` appears in all 18 skill bodies (6 skills x 3 copies): `packages/core/assistant-assets/skills/*.md` (canonical), `.claude/skills/*/SKILL.md`, `.agents/skills/*/SKILL.md`. `date -Iseconds` works on both GNU and BSD date (verified on this machine).\n\n**Relation to prior work.** Task f050baf6 (\"Skills that record runs omit --startedAt\") had the acceptance criterion \"No skill body prescribes `date -Is` or any other POSIX-only command\"; its resolution kept `date -Is` as the named POSIX example and added the PowerShell alternative. That closed the PowerShell gap but left the POSIX example itself GNU-only. `tests/e2e/skill-run-recording.test.js` guards that a PowerShell alternative is named, but does not reject the GNU-only form.\n\n**Reachability.** Every invocation of any recording skill (`/ndx-work`, `/ndx-capture`, `/ndx-plan`, `/ndx-reshape`, `/ndx-config`, `/ndx-adversarial-review`) on macOS.\n\n**Possible solutions.**\n1. *Recommended.* Replace `date -Is` with `date -Iseconds` in the canonical bodies under `packages/core/assistant-assets/skills/`, regenerate the `.claude/` and `.agents/` copies, and extend `tests/e2e/skill-run-recording.test.js` to reject `date -Is` so the GNU-only form cannot return. Cost: a find-replace plus one assertion. Risk: none — `-Iseconds` is valid on both GNU and BSD date.\n2. Drop the shell examples entirely and say only \"record the current time in ISO-8601 using whatever your environment provides\". Removes the failure but also the guidance; agents on unfamiliar shells lose the hint."
---
