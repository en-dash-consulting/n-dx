---
id: "8d2d9a84-b136-4c51-9532-9b169df13080"
type: "task"
title: "LLM catalog probe keeps the vendor's own auth tokens"
slug: "llm-catalog-probe-keeps-the-vendor-s"
description: "Gate failure from run 2f87c032 (task 94a33e07, commit f7dfc6c03). packages/web/src/server/llm-catalog.ts builds probeConfig with auth forced to \"cli\" (line ~94) so a probe under llm.<vendor>.auth api with no usable key does not throw. Since f7dfc6c03, auth cli also drops tokens the CLI ranks above its login (ANTHROPIC_AUTH_TOKEN, CODEX_API_KEY), so the probe now loses ANTHROPIC_AUTH_TOKEN and web's tests/unit/server/routes-llm-catalog.test.ts 'hands each probed CLI the vendor's filtered environment, not the parent's (#686)' fails at line 317. The probe must see the environment the vendor's runs get. Fix in llm-catalog.ts, not in child-env.ts: build the probe environment with the project's own auth setting, and fall back to auth cli only when that throws an auth-reason error (auth api, no usable key). Do not change resolveVendorCliEnv's cli behaviour from f7dfc6c03, and do not weaken the #686 test."
acceptanceCriteria:
  - "routes-llm-catalog.test.ts passes unchanged, including the #686 filtered-environment test"
  - "With llm.claude.auth unset, the catalog probe's claude child keeps an exported ANTHROPIC_AUTH_TOKEN"
  - "With llm.claude.auth api and no usable key, the catalog probe does not throw and still probes the CLI"
  - "With llm.claude.auth cli, the probe's environment matches resolveVendorCliEnv under cli"
priority: "high"
tags:
  - "credential-store"
  - "review-followup"
  - "web"
source: "gate failure of run 2f87c032 (2026-11-04)"
---
