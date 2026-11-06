---
"@n-dx/rex": patch
"@n-dx/web": patch
---

Rex's new `suggestPlacements` ranks many changes against one tree, building the tree index, placement nodes, open amenders and node keywords once. The area read and `GET /api/rex/changes/placements` use it, so an area with 60 Inbox changes answers in about 50 ms of ranking instead of growing with Inbox × tree.
