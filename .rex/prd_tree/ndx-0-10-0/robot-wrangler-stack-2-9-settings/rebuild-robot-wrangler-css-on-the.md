---
id: "25d98a98-f76b-4faa-9047-cd4590708770"
level: "task"
title: "Rebuild robot-wrangler.css on the defined design tokens and fail tests on undefined custom properties"
status: "pending"
priority: "high"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-2"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "robot-wrangler.css references no undefined custom property (verified by the new test)."
  - "The Automatic failover toggle shows a visible track in both states, and the Robot Wrangler header tile has a gap before the title, in dark and light themes."
  - "style-tokens.test.ts fails when a fixture stylesheet uses `var(--not-defined)` without a fallback, and passes for `var(--not-defined, red)`."
  - "shell.css uses `--orange` for the dirty indicator."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "`packages/web/src/viewer/styles/robot-wrangler.css` uses a token namespace nothing defines. Replace every one with the defined token from `styles/tokens.css` (which carries both themes):\n\n- `--color-accent` → `--accent`; `--color-accent-contrast` → `--bg` (dark text on the accent fill)\n- `--color-border` → `--border`; `--color-border-strong` → `--border-strong`\n- `--color-surface` → `--bg-surface`; `--color-surface-hover` → `--bg-hover`; `--color-input-bg` → `--bg`\n- `--color-text-primary` → `--text`; `--color-text-secondary` → `--text-dim`; `--color-text-tertiary` and `--color-text-dim` → `--text-muted`\n- `--color-success` → `--green`; `--color-error` → `--red`\n- `--spacing-xs/sm/md/lg/xl` → `--space-1/--space-2/--space-3/--space-4/--space-6` (4/8/12/16/24px)\n- `--font-sans`: drop it and inherit the page font\n\nDrop literal fallbacks that only existed because the token was missing. In `shell.css`, map `var(--warn, #e0a030)` to `var(--orange)`.\n\nThen extend `packages/web/tests/unit/viewer/style-tokens.test.ts`: collect every custom property defined in any viewer stylesheet, and fail on any `var(--x)` without a fallback whose `--x` is not among them, naming the file and the property. Do not restyle or relayout the page in this task: the visible changes are the ones the missing tokens caused."
lastModified: "2026-10-10T23:40:02.696Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
