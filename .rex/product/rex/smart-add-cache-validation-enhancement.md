---
id: "6772d41b-37bf-44ea-9cf9-e7dc25c15c79"
type: "capability"
title: "Smart Add Cache Validation Enhancement"
slug: "smart-add-cache-validation-enhancement"
statement: "Smart add saves a hash of the PRD with its cached pending proposals and checks it on acceptance, so proposals generated against an earlier PRD are not applied."
criteria: [{"id":"c1","text":"When smart add caches pending proposals, smart add shall save the hash of the current PRD with them."},{"id":"c2","text":"When cached proposals are loaded, smart add shall return the PRD hash stored with them."},{"id":"c3","text":"When --accept is used and the current PRD hash matches the cached hash, smart add shall apply the cached proposals."},{"id":"c4","text":"If the current PRD hash differs from the cached hash when --accept is used, smart add shall warn, clear the stale cache and not apply the cached proposals."},{"id":"c5","text":"When --accept is used on a cache file that has no PRD hash, smart add shall apply the cached proposals without checking the hash."}]
source: "smart-add"
---
