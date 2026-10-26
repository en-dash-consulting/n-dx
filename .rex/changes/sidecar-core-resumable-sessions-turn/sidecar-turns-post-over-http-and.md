---
id: "287eab75-fe67-4039-b6a2-a14a6f39041b"
type: "task"
title: "Sidecar turns post over HTTP and stream back as tagged WebSocket frames"
slug: "sidecar-turns-post-over-http-and"
description: "POST a turn; server appends frames and broadcasts sidecar:frames with a cursor; client fetches after the cursor. CAOS story: https://www.notion.so/3f7a80b7192481c5a8fef7faf77e11e0."
acceptanceCriteria:
  - "POST /api/sidecar/sessions/:id/turns and GET …/frames?after= exist"
  - "a reload resumes from the cursor"
  - "interrupt stops the turn within 2 s"
  - "a turn's text and assistant events carry the full reply, not the 500-character summary, while hench's run summaries stay truncated as before"
priority: "high"
source: "caos"
---
