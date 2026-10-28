---
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

Sidecar turns travel over HTTP: `POST /api/sidecar/sessions/:id/turns` answers `202` once the prompt is in the transcript, each appended frame is announced as a `sidecar:frames` WebSocket message with the session's cursor, and `GET …/frames?after=<cursor>` returns the frames, so a reloaded client resumes from the last cursor it rendered. Sessions can also be listed, created, interrupted and ended. Every `/api/sidecar` route refuses while the new `web.sidecar` feature flag (off by default) is off. A vendor session's turn now carries the whole reply in its assistant and completion events (`parseLine` takes a `textLimit`; hench keeps its 500-character summaries), and an interrupt escalates to a kill after 500 ms, so it stops a turn within 2 s. The process-table scan that finds the CLI's children has its own 1 s budget.
