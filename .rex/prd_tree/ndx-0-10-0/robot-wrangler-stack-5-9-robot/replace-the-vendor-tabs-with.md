---
id: "2d0c1a65-30e2-4345-970c-19cc973a4010"
level: "task"
title: "Replace the vendor tabs with selectable vendor cards and the provider dropdown with connection cards"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-5"
blockedBy:
  - "f1a1314d-9dd3-4be6-9ff1-ca45c5c303c6"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "The vendor cards form a radio group navigable with arrow keys, each showing its readiness summary."
  - "Connection shows one card per catalog provider, and a single fixed card for single-provider vendors."
  - "Saving after changing vendor or connection writes the same keys the old page wrote."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "**Section 1, \"Vendor\"** (subtitle \"Who runs your commands\"):\n- Four cards in a `radiogroup`: Claude (Anthropic), Codex (OpenAI), Gemini (Google), Local (LM Studio / Ollama).\n- Each card: a colour dot, the name, the organisation, and the catalog's readiness summary at the bottom (green when ready, orange otherwise).\n- The selected card has a 2px accent border and a check badge.\n- Arrow keys move the selection (roving tabindex). Selecting is an unsaved edit until Save, like every field.\n\n**Section 2, \"Connection\"** (subtitle \"How ndx reaches <vendor>\"):\n- One radio card per provider the catalog offers, each with a title and a one-line description: \"Claude CLI · Uses your claude login. Recommended.\" and \"Anthropic API · Needs ANTHROPIC_API_KEY\", with \"· none found\" when readiness reports no key.\n- A vendor with a single provider shows one fixed card with the reason, for example \"Codex CLI · The only connection n-dx supports for Codex\".\n- The provider still saves through `/api/hench/config` as today."
lastModified: "2026-10-10T23:40:49.853Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
