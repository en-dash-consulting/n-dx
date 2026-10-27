---
id: "342cf446-03ad-4ef7-8774-634df0d7611b"
type: "change"
title: "Settings consolidation"
slug: "settings-consolidation"
intent: "Six settings routes (General, analyze/plan, work, sync, export/refresh, feature flags and CLI timeouts) become three pages. Robot Wrangler holds provider and model for every LLM-using command and reads those keys from both their old and new config locations until 1.0.0. Workflow holds the work settings, templates and timeouts. Project holds analyze and plan settings, feature flags and integrations. The export and refresh action panels move to the Commands page. All three pages use an explicit Save with a dirty indicator.\n\nThis feature also takes the vendor-aware hench settings deferred from 0.7.1. Today the hench Config view is Claude-specific. Its Provider field offers cli and api for every vendor and calls itself the Claude provider, although hench allows cli or api for Claude, only cli for Codex, and forces api for Google and local models. Its Model field is dead: ndx work resolves the model from --model, then llm.<vendor>.model, then the vendor default, and never reads hench.model. Robot Wrangler should serve one per-vendor model catalog (llm-client's catalog for Claude, Codex and Gemini, and the live list from the local server for local models) in place of the list hard-coded in the LLM Provider view; offer only the providers the active vendor supports, with the server rejecting any other; and back the agent model with a real per-vendor override (for example hench.models.<vendor>) that ndx work honours after --model and before the project-wide setting. An invalid override in .n-dx.json falls back to the default for that field and warns instead of failing the run. The rex tasks for this work (8559090f, d2981476, 94acd4e9, b767dbff) were removed from the 0.7.1 PRD and are restored in the 0.8.0 planning pull request. Separately, hench config's curated key list is missing about 14 keys that ndx config accepts, promptCacheTtl among them; the Workflow page and hench config should list the same keys.\n\nGoal: Every setting has one obvious home, and changing the model happens in one place for every command."
acceptanceCriteria:
  - "/llm-provider, /hench-config, /project-settings, /feature-toggles, /cli-timeouts and /notion-config redirect to the three pages."
  - "A project whose provider and model are still in the old keys loads and displays them; saving writes the new keys."
  - "Unsaved changes show a dirty indicator and navigating away prompts."
  - "hench uses the same provider and model the page shows (contract test)."
  - "For every vendor (Claude, Codex, Google, local) the provider choices are exactly what hench accepts, and the model picker lists that vendor's models from one server-side catalog."
  - "ndx work runs the per-vendor agent model when one is set, and resolves exactly as today when none is set (regression test)."
  - "An invalid override in .n-dx.json warns and falls back per field."
  - "Every key ndx config accepts for hench appears on the Workflow page and in hench config."
plannedRelease: "0.8.0"
priority: "high"
tags:
  - "0.8.0"
  - "settings-consolidation"
source: "caos work management: feature ndx 0.8.0 - Settings consolidation"
---

Migration suggestion (text claude-opus-5-5, not accepted): place on "Centralized Model Resolution and Vendor Visibility Across All LLM Commands" (e34e664a-b788-41e5-ad5d-95c94d9abd8a).
