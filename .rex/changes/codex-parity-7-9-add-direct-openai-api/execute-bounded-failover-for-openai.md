---
id: "6512dd4c-adad-4e77-a136-6a743bc55e6f"
type: "task"
title: "Execute bounded failover for OpenAI API runs"
slug: "execute-bounded-failover-for-openai"
description: "Extend actual failover execution after the OpenAI API loop exists; a declared chain alone is not support.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "With failover enabled, retryable OpenAI API failures walk the supported configured model/vendor chain within finite budgets."
  - "Non-retryable errors are handled explicitly; exhausted failover restores original selection and original-error behavior."
  - "Every switch records the effective vendor/model, reason, usage and cost without leaking credentials."
  - "Disabled failover is a no-op; cross-vendor requests use each provider's correct message/tool format."
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-7"
source: "ndx-capture"
blockedBy:
  - "eb1e2cbe-d12f-4e5d-8038-9aefb0136be4"
---
