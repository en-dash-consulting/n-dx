---
id: "07874b87-6683-4b55-8ed9-1555c5bd0d88"
type: "capability"
title: "Token Usage Aggregation Performance Optimization"
slug: "token-usage-aggregation-performance"
statement: "The product keeps token usage aggregation responsive over large run histories by updating aggregates incrementally, throttling high-frequency updates to the UI, bounding stored run history and removing stale usage entries."
criteria: [{"id":"c1","text":"When a new run is recorded, the usage aggregator shall update the existing aggregates incrementally instead of rebuilding them from the full run history."},{"id":"c2","text":"When WebSocket messages arrive at high frequency, the viewer shall throttle and coalesce them into batched updates so that they do not overwhelm the UI."},{"id":"c3","text":"While data changes at high frequency, the viewer shall skip DOM updates that the changed data does not require."},{"id":"c4","text":"The system shall apply a retention policy to stored historical run data to limit its growth."},{"id":"c5","text":"The usage aggregator shall remove obsolete entries from the usage aggregation."}]
source: "smart-add"
---
