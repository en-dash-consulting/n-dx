---
id: "e46feb51-c637-4b86-b39e-cb8ab72f0dc7"
level: "task"
title: "Cache the auth credential check; stop spawning ndx auth on every settings mount"
status: "completed"
priority: "medium"
startedAt: "2026-08-18T22:50:58.512Z"
completedAt: "2026-08-18T22:54:57.622Z"
endedAt: "2026-08-18T22:54:57.622Z"
acceptanceCriteria:
  - "Navigating to General settings repeatedly does not spawn ndx auth each time"
  - "The cached result invalidates when LLM config is saved; Re-check forces a fresh check without stacking processes"
description: "LlmProviderView runs check() in useEffect keyed on the stable check callback (llm-provider.ts:251), and GET /api/commands/auth spawns ndx auth with a 60s budget — one subprocess per navigation to the General settings page, plus stackable spawns from the Re-check button (no cache or debounce). It is also a GET that spawns a process, so it is freely re-triggerable and not cacheable the way GET implies. runAuthCheck (config.js:2061) is fully non-interactive so there is no TTY-hang risk — this is cost and semantics. Fix: cache the result server-side for the server's lifetime or until the LLM config is saved; the chip stays correct since what it reports only changes when credentials or config change."
---
