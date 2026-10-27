---
id: "d07acdb3-2e83-4078-8ee7-49c0a9221d26"
type: "change"
title: "Add Google to failover chain, quota status logging, and token usage attribution"
slug: "add-google-to-failover-chain-quota"
intent: "Extend the llm.autoFailover chain definitions to include Google as both a failover source and target. Add Google quota fetch support to the between-run quota status logger. Extend hench token tracking to parse Gemini API usageMetadata fields and attribute usage to the active PRD task so ndx usage and get_token_usage MCP tool reflect Google-originated runs accurately."
acceptanceCriteria:
  - "When llm.autoFailover=true and the Google API returns a rate-limit error, hench retries on the configured fallback vendor and restores the original config on completion"
  - "Between-run quota log prints a Google quota line (or a 'quota unavailable' fallback) when vendor=google"
  - "Gemini response usageMetadata (promptTokenCount, candidatesTokenCount) is captured and stored in the hench run record"
  - "ndx usage output includes token totals for runs executed with vendor=google"
  - "get_token_usage MCP tool returns accurate totals for PRD items completed with the Google provider"
  - "Unit tests cover failover trigger, quota fetch normalization, and usageMetadata extraction for streaming and non-streaming response formats"
amends: [{"target":"ae9b2c95-002c-4f08-aefb-f86e7f85cebe","delta":"modified","summary":"Add Google to failover chain, quota status logging, and token usage attribution","base":"05573c3f3dae68f32ab834246baf9f163e855282469b8cc9f61295cfdd470d52"}]
priority: "high"
tags:
  - "hench"
  - "llm-client"
  - "google"
  - "failover"
  - "token-tracking"
source: "smart-add"
---
