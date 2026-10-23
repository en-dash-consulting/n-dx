---
id: "bcfe5bdf-685d-4be4-b581-581055424544"
type: "task"
title: "Address pattern issues (1 findings)"
slug: "address-pattern-issues-1-findings-bcfe5b"
description: "- Three distinct web package zones (web at 0.67, web-server at 0.60, crash at 0.71) each independently show high coupling to web-viewer, and global-0 records 13+9=22 bidirectional crossings. All four findings share the single root cause: no barrel export or import boundary exists for packages/web/src/viewer/. Web-viewer finding 4 (LLM pass) already identifies the fix. Scheduling these as four separate refactoring items misattributes scope — they are one gap with one fix."
priority: "high"
source: "sourcevision"
---
