---
id: "48fb83fc-91ea-4729-b05e-a9f74474a4b2"
type: "capability"
title: "Background Tab Resource Optimization"
slug: "background-tab-resource-optimization"
statement: "The dashboard detects whether its browser tab is visible, suspends polling and avoids DOM updates and response buffering while the tab is in the background, and restores polling and resynchronizes data when the tab becomes active again."
criteria: [{"id":"c1","text":"The dashboard shall detect when its browser tab changes between visible and hidden."},{"id":"c2","text":"While the browser tab is hidden, the dashboard shall suspend all polling intervals."},{"id":"c3","text":"While the browser tab is hidden, the dashboard shall not apply DOM updates."},{"id":"c4","text":"While the browser tab is hidden, the dashboard shall not buffer polling responses in memory."},{"id":"c5","text":"When the browser tab becomes visible again, the dashboard shall restore its polling intervals."},{"id":"c6","text":"When the browser tab becomes visible again, the dashboard shall synchronize its data with the current server state."}]
source: "smart-add"
---
