---
id: "c2d2a6aa-f957-4cd5-9395-d278659e514b"
type: "task"
title: "H3: add php to the hench language enums in the trust review, the config command and the web fields"
slug: "h3-add-php-to-the-hench-language-enums"
summary: "Makes a project's saved PHP language setting for the coding agent be kept and reviewed instead of silently thrown away."
description: "#1082 review H3 (medium). The trust review's copy of hench's schema has `language: optional(oneOf(\"typescript\", \"javascript\", \"go\", \"swift\"))` (`packages/llm-client/src/repo-trust.ts`, around line 1069), so a tracked `hench.language: \"php\"` is discarded instead of reviewed, while hench runs the PHP guards. The same four-language list is in `packages/hench/src/cli/commands/config.ts` (around line 779) and `packages/web/src/server/hench-config-fields.ts` (around line 194). `packages/hench/tests/unit/store/trust.test.ts` (around line 509) omits `php`, so it stays green.\n\nFix: add `php` in all three, and to the trust test's sample. If the three lists can share one source without crossing a tier boundary (llm-client is foundation; hench and web may import it), derive them from one exported list; otherwise add a test that the three agree.\n\nTests: a tracked `hench.language: \"php\"` is kept and reviewed by trust; `ndx config hench.language php` is accepted; the web field offers PHP."
acceptanceCriteria:
  - "hench.language php is accepted by trust review, the config command and the web settings"
  - "The language lists cannot drift apart unnoticed"
priority: "medium"
run: {"tier":"light","review":true,"skipTestGate":true}
tags:
  - "hench"
  - "llm-client"
  - "web"
---
