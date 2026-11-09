---
id: "a6a7c43d-5d1e-47f0-bf4f-c6e334ea78d1"
type: "change"
title: "The trust strip lists every PRD file and blanks the page"
slug: "the-trust-strip-lists-every-prd-file"
intent: "Observed 2026-11-06 in a fresh n-dx worktree (trust is per checkout, so every new worktree starts untrusted, by design): the repository trust strip at the top of the dashboard grew to about 1285 px tall, `.app-body` was squashed to zero height until 'Not now' was clicked, and the strip came back on every full page load.\n\nCause (main 6560bedbf):\n- packages/llm-client/src/repo-trust.ts `collectRepoExecutionConfig` pushes the path of every PRD Markdown file with a saved `run` block into `sources` (`for (const block of prdRunBlocks) sources.push(block.path)`). This repository saves a `run` block on about 214 items, so `sources` runs to hundreds of paths.\n- packages/web/src/viewer/components/repo-trust-strip.ts `buildTrustNotice` prints every source in the always-visible detail line (`${n} findings (${view.sources.join(', ')})`). Only the findings list is behind 'Details'.\n- packages/web/src/viewer/styles/repo-trust.css gives the strip no height limit, and it sits above the page body in the shell's flex column, so the body gets whatever height is left.\n- The CLI report `formatRepoTrustReport` (repo-trust.ts, 'Read from: …' line; printed by hench's trust command, hench's untrusted warning before a run and `ndx start`) joins the same list, and the `run-settings` finding's message joins every postured block's `path: keys`.\n\nOut of scope: making 'Not now' last longer than a page load (a design call for Ryan), trust being per checkout, and any change to what is trusted or restricted."
acceptanceCriteria:
  - "In a fresh, untrusted worktree the strip is no taller than about two lines collapsed, and `.app-body` keeps at least about two thirds of the viewport with Details open, at 1024 px and 1440 px on Home and Plan"
  - "The trust assessment, the CLI report and the strip list PRD run blocks as one grouped entry, and the trust digest is unchanged"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "high"
source: "ndx-capture"
---
