---
id: "5a1e68a7-8630-487c-a0bb-80eab14687d1"
level: "task"
title: "No way to disable cache_control breakpoints for a Claude api_endpoint that rejects them"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "hench"
  - "prompt-cache"
  - "config"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "hench config schema accepts `promptCache` (boolean, default true) and `ndx config hench.promptCache false` persists it"
  - "With `promptCache: false`, the request passed to `client.messages.create` contains zero `cache_control` markers and `system` is a plain string"
  - "With the default, the request is unchanged from the current PR (existing prompt-cache tests pass)"
  - "A unit test covers the disabled path and fails on the current code"
  - "Config documentation describes when to disable it"
description: "Severity: low. Verdict: should-fix (user elected to address). Found by the adversarial review of PR #353.\n\n## Failure scenario\n`buildCachedMessageRequest` (packages/hench/src/agent/lifecycle/prompt-cache.ts:158) always emits two `cache_control` markers, and `initApiResources` honours `claude.api_endpoint` as the SDK `baseURL` (packages/hench/src/agent/lifecycle/loop.ts:246). A gateway or proxy that does not accept `cache_control` (some OpenAI-to-Anthropic shims, some enterprise gateways, Bedrock's legacy InvokeModel path for models without caching) returns a 400 on turn 1, and there is no configuration that turns the markers off. Which proxies reject the field was not verified during the review.\n\n## Reachability\nOnly projects with `claude.api_endpoint` set to a non-Anthropic gateway. No report yet.\n\n## Solution options\n1. (Recommended) Add `hench.promptCache: boolean` (default `true`). When false, the Anthropic loop sends `system` as a plain string and untouched tools and messages, byte-identical to the pre-PR request. Implement as a flag on `buildCachedMessageRequest` so the copy-on-write normalization is also skipped. Cost: trivial. Risk: none.\n2. Detect the 400 and retry without markers. More code, and it masks a misconfiguration.\n\nOption 1 is a one-line knob with a clear name."
lastModified: "2026-09-07T20:28:46.946Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
