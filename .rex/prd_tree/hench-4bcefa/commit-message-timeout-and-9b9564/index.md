---
id: "9b9564f6-acd1-418a-a388-fa0c22d4d6f4"
level: "feature"
title: "Commit Message Timeout and Empty-File Safeguard for Autonomous Runs"
status: "pending"
source: "smart-add"
startedAt: "2026-05-15T13:42:19.414Z"
endedAt: "2026-05-15T13:42:19.414Z"
acceptanceCriteria: []
description: "Prevent autonomous hench runs from stalling indefinitely when the agent leaves a commit message file open. Add a 5-minute timer that auto-commits the staged changes once the commit message file is created, and delete the file (without committing) if it remains empty when the timer fires. This eliminates a class of endless-loop hangs where a successful run never reaches the commit step because the agent sits on the commit message prompt."
lastModified: "2026-08-28T16:30:46.752Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A failed timer auto-commit deletes the commit message file anyway, then the fallback path returns silently](./a-failed-timer-auto-commit-c084d8.md) | completed |
| [Delete empty commit message file on timeout instead of committing](./delete-empty-commit-message-283175.md) | completed |
| [The run log's .gitignore write lands after the commit step and leaves the tree dirty](./the-run-log-s-gitignore-write-3e4678.md) | pending |
