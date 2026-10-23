---
id: "5f775d38-468c-42a8-9c81-2a1ce800a983"
type: "capability"
title: "Token Event Attribution Accuracy"
slug: "token-event-attribution-accuracy"
statement: "The product records the LLM vendor and model actually used on every token usage event and aggregates utilization by that per-event metadata rather than by the currently configured model."
criteria: [{"id":"c1","text":"When a token usage event is recorded, the system shall store the LLM vendor actually used at execution time on that event."},{"id":"c2","text":"When a token usage event is recorded, the system shall store the LLM model actually used at execution time on that event."},{"id":"c3","text":"When utilization is calculated, the system shall aggregate token usage by each event's recorded vendor and model metadata."},{"id":"c4","text":"If the configured model differs from the model recorded on a token usage event, the utilization calculation shall attribute that event to its recorded vendor and model, not the configured values."}]
source: "smart-add"
---
