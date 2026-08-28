---
id: "24f506b9-6b0b-478f-89da-40c093a16ec6"
level: "task"
title: "ndx config validators, help, and web UI paths for llm routing keys"
status: "pending"
priority: "medium"
tags:
  - "core"
  - "web"
  - "config"
  - "model-routing"
source: "ndx-work"
acceptanceCriteria:
  - "ndx config accepts and validates llm.tiers.*, llm.routes.*, llm.escalation.*, and llm.effort.* with helpful errors"
  - "ndx config --help documents the new keys and the llm.model standard-tier shorthand"
  - "The web UI valid-paths list includes the new keys and the google vendor"
  - "Config round-trips through ndx config set/get and reaches resolveTaskModel at runtime"
description: "Expose the routing config surface. ndx config gains validators and help text for llm.tiers.<vendor>.<tier>, llm.routes.<class>, llm.escalation.enabled/maxSteps, and llm.effort.<class>; document that top-level llm.model acts as a standard-tier shorthand. The web UI's valid LLM config paths gain the new keys and the google vendor (closing audit C7's gaps: google missing from VALID_VENDORS, llm.model undocumented)."
lastModified: "2026-08-28T19:23:06.485Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
