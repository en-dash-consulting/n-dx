---
"@n-dx/sourcevision": patch
---

Add sourcevision LLM eval harness under `tests/gauntlet/sourcevision-evals/` with fixture projects, golden recording pipeline (`pnpm gauntlet:evals:record`), and gated scoring tests (`pnpm gauntlet:evals`). Enables measured eval-score deltas on future optimization PRs (model swaps, payload reduction, heuristic-first classification).
