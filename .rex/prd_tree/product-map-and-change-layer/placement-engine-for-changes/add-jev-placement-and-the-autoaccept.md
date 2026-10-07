---
id: "581f7bd2-4019-4a0d-b6fa-61588c91f431"
level: "task"
title: "Add Jev placement and the autoAccept setting"
status: "pending"
priority: "medium"
tags:
  - "pr-12"
  - "lane-rex-domain"
  - "rex"
  - "llm-client"
blockedBy:
  - "8ac55bc6-c995-479d-8043-935199d6b764"
source: "roadmap"
acceptanceCriteria:
  - "Each autoAccept mode has a test"
  - "Unplaced changes carry needsPlacement"
description: "rex.placement.autoAccept: none, agree (default), confident (requires Jev bands). A change without an accepted placement gets needsPlacement.\n\nSpec (2026-10-07, Ryan):\n- Two settings, read from .n-dx.json through loadProjectOverrides from @n-dx/llm-client (no edits under packages/rex/src/store/); the domain functions take both as parameters with their defaults. rex.placement.models: text (default), jev, both. rex.placement.autoAccept: none, agree (default), confident.\n- Rules always run (free; they produce the shortlist from task 8ac55bc6). models decides which injected seams are called: text = rules + text model (prd.place); jev = rules + Jev; both = rules + text model + Jev.\n- Jev is additive, under its own task class prd.place.judge. Do not add prd.place.judge to DEFAULT_JUDGMENT_ROUTES: exporting TYPESAFE_API_KEY for sourcevision must not turn on Jev placement. Jev placement is one choice question: state = the change (title, intent, evidence files) plus the rules shortlist; criteria = candidate capability id -> its statement. Rank candidates by the answer probabilities.\n- autoAccept per mode. none: never, in every mode. agree: text = the text model picks the rules top candidate; jev = Jev picks the rules top candidate; both = rules top, text model and Jev all pick the same capability. confident: text = never, with a warning that confident needs Jev; jev and both = Jev pick has confidence >= 0.8 (a named constant, like sourcevision FINDING_RESCOPE_MIN_CONFIDENCE) and is on the rules shortlist.\n- No Jev available (no TYPESAFE_API_KEY, passed in as a flag or absent judge seam): both degrades to text with a warning; jev degrades to rules only with a warning (never a silent text-model call).\n- Pure domain: the Jev judge is an injected seam with the askJev signature; the domain module never reads env, network, the judgment cache or the Jev observer. Real wiring is PR 16. Tests mock both model seams, never call a live model or Jev, and cover the 3 models x 3 autoAccept matrix plus the two degradations.\n- Out of scope: llm.routes[prd.place] = typesafe as a second way to say jev-only is left for PR 16 (treat as jev or warn); a configurable band is 1.x."
lastModified: "2026-10-07T21:58:06.223Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
