---
id: "6923ff61-6f80-4eab-a875-3b4af1de2bd2"
type: "capability"
title: "Memory-Aware Polling Loop Management"
slug: "memory-aware-polling-loop-management"
statement: "The UI suspends its active polling loops while memory pressure is high and restarts them automatically once the pressure subsides."
criteria: [{"id":"c1","text":"When memory pressure is detected as high, the UI shall suspend its active polling loops."},{"id":"c2","text":"When memory pressure subsides, the UI shall automatically restart the polling loops it suspended."},{"id":"c3","text":"The UI shall monitor polling suspension under memory pressure."}]
source: "smart-add"
---
