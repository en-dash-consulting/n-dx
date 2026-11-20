---
id: "f52cec8b-a3d9-410b-8ed1-cc6e45278028"
type: "change"
title: "ndx's stale-hint and update-notice lines print ANSI colour even with NO_COLOR or no TTY"
slug: "ndx-s-stale-hint-and-update-notice"
intent: "packages/core/stale-check.js (~79–81) and update-check.js (~201–203) write raw ANSI escapes to stderr regardless of NO_COLOR and TTY, unlike the rest of core, which colours through cli-brand.js. Repro: `NO_COLOR=1 ndx status 2>err.txt` in a project missing `.hench/`; err.txt contains `\\x1b[33m`.\n\nReachable: yes.\n\nFix options: (1, recommended) colour these lines through cli-brand's helpers; small. Changes stderr bytes when NO_COLOR is set, which is the point.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "With NO_COLOR set or stderr not a TTY, the stale-check and update-check lines contain no ANSI escapes"
  - "A test runs both with NO_COLOR=1 and asserts plain text"
priority: "low"
source: "ndx-adversarial-review"
---
