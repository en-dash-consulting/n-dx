---
id: "900c5196-8073-467e-9d43-90919bb781fe"
level: "task"
title: "Wire Copy and Capture-to-PRD actions on the answer"
status: "pending"
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "rex"
  - "clipboard"
blockedBy:
  - "514d0d03-868a-4eaf-abeb-3e2abdd38bd5"
  - "74c3fee8-3281-4b30-8157-8794ea68aea5"
source: "ndx-capture"
acceptanceCriteria:
  - "Copy places the raw answer text on the clipboard, falling back to execCommand when navigator.clipboard is unavailable"
  - "A clipboard permission denial is reported distinctly from a generic copy failure, matching the PR Markdown view's messaging"
  - "Capture-to-PRD requires an explicit confirm step before any write, and reports the created item and its parent afterwards"
  - "Capture failure surfaces the reason and leaves the answer text intact and re-copyable"
  - "Copy/Capture feedback clears itself and does not persist across a new question"
  - "Unit tests cover copy success, copy fallback, permission denial, and capture confirm/cancel"
description: "Add the two response actions. Copy reuses the clipboard workflow already proven in the PR Markdown view (pr-markdown.ts:91 fallbackCopyText, :308 handleCopyRawMarkdown) -- navigator.clipboard with an execCommand fallback, permission-denied distinguished from generic failure, and transient success/error feedback -- rather than reimplementing it.\n\nCapture-to-PRD follows the confirm-guarded pattern from the Overview Next Steps panel (overview.ts:204 -> POST /api/rex/capture-next-steps): the user confirms before anything is written, and the result reports what was created and where it landed.\n\nThe shared clipboard logic should be lifted to a reusable helper if that can be done without a new single-consumer module -- see the two-consumer rule in CLAUDE.md."
lastModified: "2026-09-01T14:05:00.607Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
