---
id: "b67648eb-e1a0-4420-89e0-2052b810ead4"
type: "change"
title: "Child Process Cleanup and Exit Hygiene"
slug: "child-process-cleanup-and-exit-hygiene"
intent: "Ensure `n-dx` tears down all spawned child processes and lingering worker threads when commands complete, fail, or are interrupted so local machines are not left with orphaned SourceVision-related activity."
source: "smart-add"
---
