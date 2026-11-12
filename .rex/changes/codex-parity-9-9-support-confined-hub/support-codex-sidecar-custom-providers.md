---
id: "5d47b98c-517a-46c6-90be-2f4ed5d3434a"
type: "task"
title: "Support Codex Sidecar custom providers without loading unrelated integrations"
slug: "support-codex-sidecar-custom-providers"
description: "Carry only the provider settings/auth required by an operator-selected custom provider rather than re-enabling the whole user configuration.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Carry only required trusted custom-provider settings/auth while keeping unrelated MCP servers, hooks and integrations excluded."
  - "Fresh and resumed turns use the selected provider/binary/model without silent fallback to OpenAI or Claude."
  - "Provider credentials stay out of argv, logs, fixtures and agent child shells; broker credentials and operator card approvals remain isolated."
  - "Actionable errors distinguish unsupported CLI/provider capability, missing auth and connection failure; test with disposable provider/MCP fixtures."
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-9"
source: "ndx-capture"
blockedBy:
  - "b42b3957-511c-42f7-aed8-37980dfe6d13"
---
