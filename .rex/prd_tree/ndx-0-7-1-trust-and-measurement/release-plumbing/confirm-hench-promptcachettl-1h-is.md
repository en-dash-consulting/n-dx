---
id: "b13e95dd-f99e-4f95-97e6-be560a699fd7"
level: "task"
title: "Confirm hench.promptCacheTtl 1h is accepted by the live Anthropic API before the cut"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "release-check"
  - "hench"
  - "prompt-cache-config"
source: "ndx-adversarial-review of PR M task a0eaf286 (run 01d15d75, F3)"
acceptanceCriteria:
  - "One hench.provider=api run, or a direct request built by buildCachedMessageRequest with promptCacheTtl \"1h\", against the Anthropic API returns 200, and its usage shows the cache write."
  - "If a beta header or other change is needed, it lands before #380 merges, as a patch with its own changeset."
  - "The result is noted on this task, with the model and date."
description: "PR M's `hench.promptCacheTtl: \"1h\"` sends `cache_control: {type: \"ephemeral\", ttl: \"1h\"}` on both breakpoints, but it has never been sent to a live endpoint. Nothing in hench or llm-client sends an `anthropic-beta` header. The reviewer found the field typed on the non-beta `Anthropic.CacheControlEphemeral`, which suggests it is generally available, but could not read the SDK or the network to confirm. If a beta header is required, every turn-1 request 400s while the key is on. The setting is opt-in and off by default, so the risk is limited to operators who turn it on."
lastModified: "2026-09-24T20:30:51.162Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
