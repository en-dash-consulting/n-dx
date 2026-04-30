---
id: "2f718148-1812-4472-99bb-56b0396057a8"
level: "task"
title: "Show trex mascot banner on every ndx init invocation"
status: "completed"
priority: "medium"
startedAt: "2026-04-09T21:38:43.676Z"
completedAt: "2026-04-09T21:43:39.451Z"
acceptanceCriteria: []
description: "In packages/core/cli.js, the showInitBanner() call (line 752) is gated behind 'if (resolution.needsProviderPrompt)', meaning the trex mascot banner from cli-brand.js only appears on first-time init when no provider is configured. Move the showInitBanner() call outside the conditional so it runs unconditionally at the start of handleInit(), before the LLM selection flow. The banner is defined in packages/core/cli-brand.js formatInitBanner() and renders the pixel-art trex mascot."
---

# Show trex mascot banner on every ndx init invocation

🟡 [completed]

## Summary

In packages/core/cli.js, the showInitBanner() call (line 752) is gated behind 'if (resolution.needsProviderPrompt)', meaning the trex mascot banner from cli-brand.js only appears on first-time init when no provider is configured. Move the showInitBanner() call outside the conditional so it runs unconditionally at the start of handleInit(), before the LLM selection flow. The banner is defined in packages/core/cli-brand.js formatInitBanner() and renders the pixel-art trex mascot.

## Info

- **Status:** completed
- **Priority:** medium
- **Level:** task
- **Started:** 2026-04-09T21:38:43.676Z
- **Completed:** 2026-04-09T21:43:39.451Z
- **Duration:** 4m
