---
id: "c513f257-7f0b-4bce-9bf5-82f5cc909ef0"
level: "feature"
title: "ANSI Color Output Across Rex, SourceVision, and Hench"
status: "completed"
source: "smart-add"
startedAt: "2026-04-08T20:27:58.146Z"
completedAt: "2026-04-08T20:27:58.146Z"
acceptanceCriteria: []
description: "Add semantic ANSI color formatting to all CLI log output across rex, sourcevision, hench, and the ndx orchestrator, so operators can quickly distinguish statuses, results, and severity levels at a glance. Includes a shared utility layer with TTY detection and environment-flag support to ensure colors are never emitted in non-interactive or piped contexts."
---

## Children

| Title | Status |
|-------|--------|
| [Apply color formatting to sourcevision CLI output](./apply-color-formatting-to-51364a/index.md) | completed |
| [Apply color formatting to hench and ndx orchestrator output](./apply-color-formatting-to-hench-be167d/index.md) | completed |
| [Apply color formatting to rex CLI output](./apply-color-formatting-to-rex-cli-output/index.md) | completed |
| [Build shared ANSI color formatting utility with TTY and NO_COLOR support](./build-shared-ansi-color-2faf9d/index.md) | completed |
