---
id: "97291b04-5d49-45d3-b7f7-7950e76f9ea4"
type: "task"
title: "Tracker rule engine with requestIds, confirmation reads and a dry-run log"
slug: "tracker-rule-engine-with-requestids"
description: "Story 45, part 1 (CAOS 3f7a80b7-1924-8147-aad1-d64b44332ec6). Deterministic, no LLM: packages/web/src/server/tracker/rules.ts evaluates an ndx event (change captured or placed with no link, run started, PR opened with the item's trailer, PR merged, release published, run failed twice) for a linked item against the project's trackerSync config and the profile's mapping, and yields a planned call or a card. Defaults per §14.2/CN4: creation by card, moves automatic after the dry run, blocked by card. dry-run records the would-be call; on records and executes it through the connection service. requestId = ndx:<project>:<rexId>:<event>; a create or duplicate reply is confirmed with the profile's read tool; a refusal records its problems list and is not retried. The activity log is an append-only JSONL under the project's ndx state dir (resolveLayout), each entry { at, event, rexId, rule, mode, call, result: would | ok | duplicate | refused | card | unavailable | needs-sign-in, problems? }. Project-server route POST /api/tracker/sync/tick (per-user token only; refuses a broker credential) runs the engine over queued events; GET /api/tracker/activity lists the log. Follow the shared rules in the parent change's description."
acceptanceCriteria:
  - "Each rule is off by default; dry-run records 'would' entries and makes no call; on makes the call through a fake server (tests)"
  - "Every call's requestId is ndx:<project>:<rexId>:<event>, and a duplicate reply is confirmed with a read before it is logged as duplicate (tests)"
  - "Creation and blocked raise a card entry instead of a call; moves run automatically only when their rule is on (tests)"
  - "A validation_failed refusal is logged with its problems and the same event is not retried with other arguments (test)"
  - "The tick route refuses a request without the per-user token and refuses a Sidecar broker credential (route tests)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "caos"
---
