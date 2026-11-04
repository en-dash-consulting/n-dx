---
id: "6d70bab8-a6c6-4839-9520-08d407116c79"
type: "task"
title: "C9: docs describe the credential store and auth modes"
slug: "c9-docs-describe-the-credential-store"
description: "PR 3, last. Re-grounded 2026-11-03 against 4f9b9ab00 (workshop credential-injection/05-pr3-reground). Pages still wrong: README.md:213 (argv key); docs/guide/configuration.md:125-131 (\"API mode (recommended)\", argv key, then export), :140 (\"*.api_key written to .n-dx.local.json\"), :193 (export TYPESAFE_API_KEY first); docs/guide/getting-started.md:73-75; docs/guide/troubleshooting.md:91-93; docs/guide/commands.md:275; docs/guide/gitignore.md:18 (API keys go to .n-dx.local.json); packages/core/README.md:179. PR 1 already removed the README's guard.env.allow advice for TypeSafe. No assistant instruction file names a vendor key. Reasoning goes to docs/, not AGENTS.md."
acceptanceCriteria:
  - "Every page listed in the description shows the CLI login first and ndx config credentials.<vendor> for a key, and never puts a key on the command line"
  - "docs/guide/configuration.md gains an API keys and auth modes section: llm.<vendor>.auth (cli, api, auto, and what auto does with a stored key), the lookup order (config, environment, store), --helper with its quoting rules and the interpreter limit, --check, --import, and that writing llm.<vendor>.api_key sets auth api when it is unset"
  - "No page advises guard.env.allow for TypeSafe, and export TYPESAFE_API_KEY appears only as the override"
  - "docs/archive/ and docs/releases/ are untouched, and tests/e2e/agents-md-size-budget.test.js and the docs build pass"
priority: "low"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "12d277fe-4308-47dd-9a3e-9634d4b829f6"
  - "742863c5-989f-4138-8909-9b59bb589fc4"
  - "94e25654-bb3c-4203-a1ab-49267e0ad734"
  - "b52513b3-58a0-4a2b-9e36-d116bdcf6a54"
  - "f912174e-96e5-41a3-acd9-5c73bae27c5b"
---
