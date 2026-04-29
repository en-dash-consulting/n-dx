---
id: "8659f10b-6326-4db8-93bf-e84fe5168cd2"
level: "task"
title: "Epic Filtering for Work Command"
status: "completed"
source: "smart-add"
startedAt: "2026-02-05T16:26:43.089Z"
completedAt: "2026-02-05T16:26:43.089Z"
acceptanceCriteria: []
description: "Allow users to constrain hench work loop to execute only tasks within a specified epic"
---

## Subtask: Add epic parameter to hench run command

**ID:** `74c29c7b-f70f-432a-af2b-3901774e8564`
**Status:** completed
**Priority:** high

Extend the hench run CLI to accept an --epic flag that filters available tasks to only those within the specified epic

**Acceptance Criteria**

- Accepts epic ID or title as parameter value
- Validates epic exists before starting work loop
- Shows helpful error for non-existent epics

---

## Subtask: Implement epic-filtered task selection in findNextTask

**ID:** `2721b6c6-8847-4352-aefd-107fb3f827cf`
**Status:** completed
**Priority:** high

Modify the task selection logic to only consider tasks that belong to the specified epic when epic filter is active

**Acceptance Criteria**

- Only returns tasks from filtered epic
- Maintains priority and dependency ordering within epic
- Returns null when no actionable tasks remain in epic

---

## Subtask: Add epic scope validation and messaging

**ID:** `b9f97ae3-3676-428b-9436-e43ff61fb535`
**Status:** completed
**Priority:** medium

Provide clear feedback when epic filtering is active, including scope information and completion status

**Acceptance Criteria**

- Shows epic name and scope in work loop startup message
- Indicates when all tasks in epic are complete
- Warns if epic has no actionable tasks

---

## Subtask: Extend n-dx work orchestration with epic support

**ID:** `bedd0db7-3359-4ed8-85d6-1e026d89cac0`
**Status:** completed
**Priority:** high

Pass through epic filtering parameter from n-dx work command to hench run

**Acceptance Criteria**

- Accepts --epic flag in n-dx work command
- Forwards epic parameter to hench run
- Maintains backward compatibility with unfiltered runs

---
