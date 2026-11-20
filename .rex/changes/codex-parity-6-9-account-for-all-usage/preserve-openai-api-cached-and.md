---
id: "bc6b57ed-338a-4d0d-b776-e2019a5de6fd"
type: "task"
title: "Preserve OpenAI API cached and streaming token usage"
slug: "preserve-openai-api-cached-and"
description: "Fix the audit-observed API parser/cache and streaming inclusion gaps separately from the future agent loop.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Preserve cached input and any supported cache-write categories without counting them twice inside total input."
  - "Request and retain final streaming usage; partial/missing usage gets honest diagnostic provenance."
  - "Blocking and streaming responses normalize to the same token contract and pricing inputs."
  - "Disposable mocked/API fixtures cover cached, uncached, partial, absent and interrupted streams; never require production task mutations."
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-6"
source: "ndx-capture"
blockedBy:
  - "869bcab8-bc97-42e9-9eb6-4a72c95a49e0"
---
