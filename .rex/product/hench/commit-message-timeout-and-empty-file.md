---
id: "9b9564f6-acd1-418a-a388-fa0c22d4d6f4"
type: "capability"
title: "Commit Message Timeout and Empty-File Safeguard for Autonomous Runs"
slug: "commit-message-timeout-and-empty-file"
statement: "When an autonomous hench run creates its commit message file, a timer auto-commits the staged changes once it expires, and if the file is empty or holds only whitespace at that point, hench deletes it without committing."
criteria: [{"id":"c1","text":"If the commit message timer fires while the commit message file is empty or contains only whitespace, hench shall delete the file and produce no commit."},{"id":"c2","text":"When hench skips a commit because the commit message was empty, hench shall log a line that names the empty message as the skip reason and is distinct from the line logged for a successful auto-commit."},{"id":"c3","text":"When hench skips a commit on timer expiry because the message was empty, hench shall leave no partial state on disk, with the commit message file removed and no orphaned lock files."},{"id":"c4","text":"When hench skips a commit on timer expiry because the message was empty, the run loop shall either continue or terminate cleanly."}]
requirements: [{"id":"9b9564f6-acd1-418a-a388-fa0c22d4d6f4:c1","title":"If the commit message timer fires while the commit message file is empty or contains only whitespace, hench shall delete the file and produce no commit","description":"Linked to: packages/hench/tests/integration/commit-msg-timer.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["If the commit message timer fires while the commit message file is empty or contains only whitespace, hench shall delete the file and produce no commit."]}]
source: "smart-add"
---

Prevent autonomous hench runs from stalling indefinitely when the agent leaves a commit message file open. Add a 5-minute timer that auto-commits the staged changes once the commit message file is created, and delete the file (without committing) if it remains empty when the timer fires. This eliminates a class of endless-loop hangs where a successful run never reaches the commit step because the agent sits on the commit message prompt.
