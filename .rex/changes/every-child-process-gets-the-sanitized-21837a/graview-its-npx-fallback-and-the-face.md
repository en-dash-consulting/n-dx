---
id: "6e3283a2-797a-4a60-973d-b04c268e09f2"
type: "task"
title: "graview, its npx fallback and the face server get the sanitized environment"
slug: "graview-its-npx-fallback-and-the-face"
description: "Second short adversarial re-review of #816 + #817 (the 20 fix commits since abf90b308; two parallel passes, trust/config and child-env/spawn/backstop; fix/security-child-env at 9b60c492e), 2026-10-28, child-env pass finding 4 (medium; read from the code).\n\nFailure scenario: packages/graview/src/cli/index.ts run() passes no env (~lines 112-116), and runGraview spreads the caller's options without one, so spawnCli spawns with env undefined and the child inherits the whole parent environment. `ndx graview emit|check|serve` with no graview on PATH runs `npx -y graview@<pinned>`, a binary downloaded from the registry, with every credential in the operator's shell. The face server also gets {...process.env} (~lines 188-189). The code calls graview a peer tool, like the claude and codex CLIs, but those get the filtered environment. This contradicts #817's \"every child process gets the sanitized environment\" (Closes #635).\n\nFix: pass the sanitized environment, sanitizeChildEnv(process.env, compileEnvPolicy(<project policy>)), through graview's existing llm-client import surface, to every graview, npx and face spawn. Use the same project policy resolution the other repo-command spawns use (the user's local deny entries, and the trust-gated allow). Keep whatever variables graview genuinely needs (PATH, HOME and npm's own config), and name them in the policy if the default filter would strip them."
acceptanceCriteria:
  - "Closes #635 (follow-up): every graview, npx-fallback and face-server spawn gets the sanitized environment, not process.env"
  - "`ndx graview emit` still works through the npx fallback (npm config and PATH intact)"
  - "Test: a placeholder credential in the parent environment does not reach a stub graview through each spawn path; the test fails on the code before the fix"
priority: "medium"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
