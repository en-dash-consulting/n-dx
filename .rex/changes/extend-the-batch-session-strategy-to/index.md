---
id: "662bb418-12f3-41ee-85bc-cd653aa05482"
type: "change"
title: "Extend the batch session strategy to the codex CLI"
slug: "extend-the-batch-session-strategy-to"
intent: "The batch strategy is implemented and verified on the Claude CLI but is not wired for codex, which is the vendor it most benefits: codex cannot fork, so batching is its only route out of per-task cold starts. The mechanism is known — `codex exec resume [SESSION_ID] [PROMPT]` resumes and appends, with `--last` as a session-id-free alternative — but two pieces are missing. First, the codex adapter has no session handling at all: it ignores resumeSessionId and always spawns `codex exec ... -`, so it needs a resume branch emitting `exec resume <id> -`. Second, nothing captures a session id from codex's `--json` JSONL stream, and whether it emits one (and under what key) was not verifiable without codex auth and real tokens — so that has to be confirmed against the live CLI before the chain can be trusted. Prefer a captured id over `--last`: `--last` picks the newest recorded session globally, so a concurrent codex run elsewhere on the machine would hijack the chain."
acceptanceCriteria:
  - "The codex adapter honors resumeSessionId by emitting `exec resume <id>` instead of a fresh `exec`"
  - "A codex session id is captured from its JSONL output, verified against the live CLI rather than assumed"
  - "resolveSessionStrategy allows batch for codex and it chains across tasks up to tasksPerSession"
  - "A failed codex task starts a fresh session rather than resuming the failure"
  - "`--last` is used only as a documented fallback, if at all, with the concurrent-run hijack risk noted"
amends: [{"target":"00d910d1-dc49-488d-bd6f-3d26911abc79","delta":"modified","summary":"Extend the batch session strategy to the codex CLI","base":"8651f70c777d290ce068ef1b754ef2d4896241d4e7e62434b8bf53a0529b5d56"}]
priority: "low"
tags:
  - "hench"
  - "sessions"
  - "codex"
source: "ndx-work"
---
