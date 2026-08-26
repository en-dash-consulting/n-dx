---
id: "a9fcab05-166f-43eb-81f7-05f8c3cef117"
level: "feature"
title: "CLI Identity Detection and Configuration"
status: "completed"
source: "smart-add"
startedAt: "2026-08-13T00:39:22.831Z"
completedAt: "2026-08-13T00:39:22.831Z"
endedAt: "2026-08-13T00:39:22.831Z"
acceptanceCriteria: []
description: "n-dx is a toolkit that can be embedded in any project under any CLI binary name. Currently the dashboard, agent prompts, and help text hardcode 'ndx' as the command prefix. This feature detects the project's actual installed command name from package.json and stores it in .n-dx.json as cli.name, providing the resolution point for all surfaces that display or execute CLI commands."
---

## Children

| Title | Status |
|-------|--------|
| [Detect project CLI name from package.json bin field and expose in .n-dx.json schema](./detect-project-cli-name-from-2238b4.md) | completed |
| [Propagate resolved CLI name into hench agent prompts and task briefs](./propagate-resolved-cli-name-7828db.md) | completed |
