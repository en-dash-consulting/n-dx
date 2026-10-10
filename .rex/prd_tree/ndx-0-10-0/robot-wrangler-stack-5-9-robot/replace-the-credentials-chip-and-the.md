---
id: "707c2af1-5e6e-4033-ae1a-119ebc5891e7"
level: "task"
title: "Replace the credentials chip and the will-run-with block with a run card that previews unsaved edits"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-5"
blockedBy:
  - "f1a1314d-9dd3-4be6-9ff1-ca45c5c303c6"
  - "61fa63ff-1c9c-4beb-9a11-ceacb0fd5c1e"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "The card shows the effective model, vendor, provider, source and the review chip from GET /api/llm/config."
  - "Changing the vendor shows the previewed model with an After-save badge before Save, and nothing is written."
  - "A refused configuration shows the banner with the server's message; Codex never offers an API switch."
  - "Unit tests cover the ready, pending, refused, checking and legacy states."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "At the top of the page, replace `AuthStatusChip`, `EffectiveBlock` and the inline `CatalogStatus` line with one run card.\n\n**Left side:**\n- The label \"NEXT `ndx work` RUN\".\n- The effective model id in large monospace.\n- Chips: the vendor (with its colour dot), \"via <provider>\", and \"model from <source key>\". When review is on, add a teal chip: \"Reviewed by Codex · gpt-5.6-sol\" or \"Self review · <model>\".\n- A small line: \"A task's saved run settings (Prepare task) or a --model flag can override this for that run.\"\n\n**Right side, a checklist:**\n- Credentials: valid, or failed with a \"Re-run ndx auth\" action, plus Re-check.\n- CLI found, with its version.\n- Model list source (live or built-in), with Refresh.\n\n**Problems:** when the server reports problems, show a red banner under the card, \"ndx work would refuse this.\", with the server's message and the fix that applies. A missing Codex CLI gets \"How to install\" and \"pick another vendor\". Never offer an API connection for Codex.\n\n**Unsaved edits:** while edits are pending, call `POST /api/llm/config/preview` (debounced about 300ms). The card shows the previewed result with an \"After save\" badge and the previous model struck through.\n\n**Other states:**\n- Checking: show placeholder rows.\n- A legacy `claude.*` key in use: show an info line."
lastModified: "2026-10-10T23:40:46.522Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
