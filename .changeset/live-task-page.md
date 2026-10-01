---
"@n-dx/web": patch
---

Add the running-task page at `/live/task/:taskId`: a header with run n of m and a run picker (the selected run is kept in the URL as `?run=`), chips for elapsed time, epic chain, priority, turn, tokens and tokens per second, model and heartbeat, plus Copy link, Mark stuck and Stop. The Work tab shows each progress event as it is written and keeps the current step in view, followed by the last five log lines. A side column shows the task's criteria, its runs, where the run is running, what it has spent and what happens after it. `GET /api/live/task/:taskId` serves the page's data. Stop now also stops runs started from a terminal, using the pid on the run record. It does this only when the record is from this host and its heartbeat is fresh.
