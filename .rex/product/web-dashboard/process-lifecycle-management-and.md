---
id: "f95ede7e-3b79-4370-9c8b-0174c83ead4c"
type: "capability"
title: "Process Lifecycle Management and Graceful Shutdown"
slug: "process-lifecycle-management-and"
statement: "The dashboard process lifecycle shuts down cleanly, freeing its processes, ports and resources when the dashboard is terminated, and drops disconnected WebSocket clients as soon as they disconnect."
criteria: [{"id":"c1","text":"When a WebSocket client disconnects, the dashboard server shall detect the disconnection immediately and remove the client from its active connections."},{"id":"c2","text":"When the dashboard is terminated, the dashboard shall shut down gracefully, cleaning up all of its processes."},{"id":"c3","text":"When the dashboard is terminated, the dashboard shall release the ports it holds."},{"id":"c4","text":"When the dashboard is terminated, the dashboard shall release the resources it holds."},{"id":"c5","text":"When ndx refresh starts, the refresh command shall detect existing dashboard processes."},{"id":"c6","text":"When ndx refresh finds existing dashboard processes, the refresh command shall clean them up before it starts the refresh operations."}]
source: "smart-add"
---
