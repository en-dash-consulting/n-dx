---
id: "b8281f64-e23a-4188-a9e7-a6e74c686638"
type: "change"
title: "Windows rename fixtures compare filesystem identity reliably"
slug: "windows-rename-fixtures-compare"
intent: "Explicitly approved by the user on 2026-11-13 after main PR #1045 was merged and the seven-PR stack was rebased. Repair only the Windows rename fixture path-identity failures in packages/hench/tests/integration/recovery-renames.test.ts and rollback-renames.test.ts. Prior CI evidence: PR #1004 job 132028598347 and PR #1008 job 132073825960; equivalent RUNNER~1 and runneradmin temp paths fail fixture guards before 44 behavioral cases run. Cross-reference completed change 6088a0fe-5c68-4bb6-819c-37acd128ed08; this separate Windows repair does not duplicate its rollback wording or empty-folder changes. Execute through actual checkout-local ndx work using the configured absolute bundled Codex CLI, gpt-6-astra execution and mandatory gpt-6-astra self-review, workspace-write sandbox, native 200 turns and all gates enabled. The outer NDX_SANDBOX=off validation exception is authorized for the existing isolated clone. Preserve user pins and dirty work; do not implement credential takeover item 67b9df15-34b2-42a5-a8b6-614ce1f249d7, deferred plain-mv/paired-commit/checkpoint follow-ups, Wave 2 or parity. Do not merge anything. Windows CI verification remains pending until the actual post-push Windows result passes."
acceptanceCriteria:
  - "Complete the approved Windows fixture repair on PR #1004, preserving isolation and real-Git behavior; publish the dependent stack atomically and request Windows CI without merging."
touches:
  - "9cea889f-17de-4b92-a97e-b7279e158578"
priority: "high"
discoveredFrom: {"item":"6088a0fe-5c68-4bb6-819c-37acd128ed08"}
source: "ndx-capture"
---
