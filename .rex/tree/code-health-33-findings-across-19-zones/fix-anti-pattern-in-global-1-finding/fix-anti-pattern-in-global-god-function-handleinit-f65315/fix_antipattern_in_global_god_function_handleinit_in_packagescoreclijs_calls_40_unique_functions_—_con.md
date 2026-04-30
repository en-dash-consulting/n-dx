---
id: "f653153b-52d7-4155-8773-51258364aeda"
level: "task"
title: "Fix anti-pattern in global: God function: handleInit in packages/core/cli.js calls 40 unique functions — con"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-17T15:11:24.224Z"
completedAt: "2026-04-17T15:22:09.410Z"
resolutionType: "code-change"
resolutionDetail: "Decomposed handleInit into 8 focused helpers: parseInitFlagSet, buildInitArgs, repairInitConfig, resolveInitAssistants, selectInitLLMProvider, runSubInitPhase (lifted from nested), persistInitLLMConfig, printStaticInitSummary. Reduced from 290 lines/40 unique call sites to ~100 lines/~18 call sites."
acceptanceCriteria: []
description: "- God function: handleInit in packages/core/cli.js calls 40 unique functions — consider decomposing into smaller, focused functions"
recommendationMeta: "[object Object]"
---
