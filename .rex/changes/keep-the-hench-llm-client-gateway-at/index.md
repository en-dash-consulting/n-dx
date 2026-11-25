---
id: "ed05500c-db2a-4a67-861c-4e4dbc0463ee"
type: "change"
title: "Keep the hench llm-client gateway at 250 exports after the MDS cache fix"
slug: "keep-the-hench-llm-client-gateway-at"
summary: "The sandbox sign-in fix grew hench's list of shared-library imports by one. Move the lookup it needs into the shared library so that list does not grow."
intent: "Follow-up from operator review of 68ddc78a (commit 0a0505fb9). To run `getconf DARWIN_USER_CACHE_DIR` from createVendorCliSandbox (packages/hench/src/guard/sandbox.ts), the run exported execFileSyncNoShell through packages/hench/src/prd/llm-gateway.ts and raised the gateway's maxExports in tests/e2e/architecture-policy.test.js from 250 to 251 (and edited docs/architecture/gateways.md). Gateway cap raises are a last resort; design the export away instead."
acceptanceCriteria:
  - "The hench llm-gateway is back at maxExports 250 and the macOS vendor CLI sandbox still opens the MDS cache folder"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "high"
discoveredFrom: {"item":"68ddc78a-5fd2-4103-a739-63b00aeea890"}
tags:
  - "hench"
  - "llm-client"
  - "gateway"
source: "operator review"
---
