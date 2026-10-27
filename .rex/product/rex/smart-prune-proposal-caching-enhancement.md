---
id: "ff24d31d-6bfc-4ed8-979e-2bc790ed8549"
type: "capability"
title: "Smart Prune Proposal Caching Enhancement"
slug: "smart-prune-proposal-caching-enhancement"
statement: "Smart prune caches its LLM-generated reshape proposals, so a dry run followed by an accept reuses them without a second LLM call."
criteria: [{"id":"c1","text":"When smart prune generates reshape proposals with the LLM, rex shall write them to .rex/pending-smart-prune.json along with the hash of the current PRD."},{"id":"c2","text":"When smart prune runs again and the PRD is unchanged, rex shall reuse the cached proposals without calling the LLM again and shall emit a 'Using cached proposals' message."},{"id":"c3","text":"If the PRD has changed since the proposals were cached, rex shall discard the cached proposals and generate new ones with the LLM."},{"id":"c4","text":"When smart prune applies proposals successfully with accept, rex shall clear the pending smart prune cache."},{"id":"c5","text":"When an accept follows a dry run of smart prune, rex shall reuse the proposals from the dry run instead of making another LLM call."}]
source: "smart-add"
---
