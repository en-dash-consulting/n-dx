---
id: "bc475790-2fde-4d96-9aa4-1643adedc53a"
level: "task"
title: "Make the llm-client seam registry readable by every assistant, not only Claude"
status: "completed"
priority: "medium"
startedAt: "2026-10-06T14:32:33.109Z"
completedAt: "2026-10-06T15:47:31.076Z"
endedAt: "2026-10-06T15:47:31.076Z"
resolutionType: "code-change"
resolutionDetail: "Seam registry moved to packages/llm-client/AGENTS.md; CLAUDE.md reduced to @AGENTS.md. Registry row corrected to initAndLoadLLMConfig. TESTING.md now directs package seam registries to AGENTS.md. New instruction-surface checks in tests/e2e/instruction-alignment.test.js. Also fixed two pre-existing races in cli-start-two-projects/cli-start-hub that the added tests exposed."
acceptanceCriteria: []
description: "Requested by Ryan (2026-10-06): documentation updates must not be isolated to CLAUDE.md files; Codex and other assistants read AGENTS.md. Task 078d06e8 added packages/llm-client/CLAUDE.md (the llm-client injection seam registry for the JevObserver seam, its rules, and the judgment cache directory note). That content is vendor-neutral, but only Claude Code reads it.\n\nDo:\n1. Move the content into a new packages/llm-client/AGENTS.md (Codex reads nested AGENTS.md files) and reduce packages/llm-client/CLAUDE.md to an import of it (`@AGENTS.md`, the Claude Code import syntax), so there is one source and nothing can drift. Do not duplicate the text in both files.\n2. Verify the registry row against the code: the row names packages/sourcevision/src/cli/commands/analyze.ts (cmdAnalyze setup) as the registrar, but commit eff0f79db says setJevObserver is registered in initAndLoadLLMConfig, shared by sv analyze and sv narrate. Make the row name the real registration site.\n3. TESTING.md \"Co-evolution Rule: Seam Registry and Gateway Table\" says these governance tables live in CLAUDE.md, which steers authors to Claude-only files. Amend it so a package-level seam registry lives in that package's AGENTS.md (with CLAUDE.md importing it). Leave the root CLAUDE.md/AGENTS.md generation design (packages/core/assistant-assets/) as it is; if a root-level change is needed, edit the asset and regenerate both files, never only one.\n4. If any test enumerates CLAUDE.md files or instruction surfaces, keep it passing; add a check that packages/llm-client/CLAUDE.md imports AGENTS.md if a natural home for one exists.\n\nAcceptance criteria:\n- packages/llm-client/AGENTS.md holds the seam registry, rules, Jev observer specifics and judgment cache directory note.\n- packages/llm-client/CLAUDE.md contains only the import of AGENTS.md (plus at most a one-line pointer).\n- The registry row names the actual setJevObserver registration site.\n- TESTING.md tells authors to put package seam registries in AGENTS.md, not CLAUDE.md alone.\n- pnpm build, pnpm typecheck and the root and llm-client test suites pass.\n- No changeset needed unless a published package file changes; if one does, a patch changeset with the scoped name."
lastModified: "2026-10-06T15:47:31.592Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
