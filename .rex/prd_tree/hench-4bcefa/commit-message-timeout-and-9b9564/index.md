---
id: "9b9564f6-acd1-418a-a388-fa0c22d4d6f4"
level: "feature"
title: "Commit Message Timeout and Empty-File Safeguard for Autonomous Runs"
status: "completed"
source: "smart-add"
startedAt: "2026-05-15T13:42:19.414Z"
completedAt: "2026-05-15T13:42:19.414Z"
endedAt: "2026-05-15T13:42:19.414Z"
acceptanceCriteria: []
description: "Prevent autonomous hench runs from stalling indefinitely when the agent leaves a commit message file open. Add a 5-minute timer that auto-commits the staged changes once the commit message file is created, and delete the file (without committing) if it remains empty when the timer fires. This eliminates a class of endless-loop hangs where a successful run never reaches the commit step because the agent sits on the commit message prompt."
---

## Children

| Title | Status |
|-------|--------|
| [Delete empty commit message file on timeout instead of committing](./delete-empty-commit-message-283175.md) | completed |
