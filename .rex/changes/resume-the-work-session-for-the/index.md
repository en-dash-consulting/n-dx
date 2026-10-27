---
id: "2eb560aa-843f-476d-864c-21ad4469ee64"
type: "change"
title: "Resume the work session for the reviewer on --resume"
slug: "resume-the-work-session-for-the"
intent: "Capture session_id from the Claude CLI stream-json output onto SpawnResult (first value only, so a late malformed line cannot redirect the resume), add resumeSessionId to VendorSpawnOptions, and have the Claude adapter append the resume flag. Vendors without a resume equivalent fall back to a fresh reviewer seeded with the task context."
touches:
  - "6eb227af-ffb2-4f39-8f62-d4afbad09a57"
priority: "high"
---
