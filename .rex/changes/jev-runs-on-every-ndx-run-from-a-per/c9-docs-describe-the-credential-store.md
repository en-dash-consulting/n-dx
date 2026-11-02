---
id: "6d70bab8-a6c6-4839-9520-08d407116c79"
type: "task"
title: "C9: docs describe the credential store and auth modes"
slug: "c9-docs-describe-the-credential-store"
description: "PR 3. Re-ground before it runs, after T8 lands. Pages from the 2026-10-30 re-ground: README.md, docs/guide/configuration.md, getting-started.md, troubleshooting.md, commands.md, packages/core/README.md. Keep AGENTS.md within budget: reasoning goes to docs/."
acceptanceCriteria:
  - "Every page in 02-reground's docs table is updated to the store and auth-mode model, and no page advises guard.env.allow for TypeSafe"
  - "docs/archive/ is untouched and tests/e2e/agents-md-size-budget.test.js passes"
priority: "low"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "12d277fe-4308-47dd-9a3e-9634d4b829f6"
  - "742863c5-989f-4138-8909-9b59bb589fc4"
  - "94e25654-bb3c-4203-a1ab-49267e0ad734"
---
