---
id: "15572c21-1d8f-4aa1-b105-82b516e71ad0"
type: "capability"
title: "Duplicate-aware Proposal Override for rex add"
slug: "duplicate-aware-proposal-override-for"
statement: "When rex add generates proposals that duplicate existing or completed PRD items, rex asks the user whether to cancel, merge with the existing work or force-create anyway, and records a marker on each item it force-creates."
criteria: [{"id":"c1","text":"When rex add generates a proposal that overlaps an existing or completed PRD item, rex shall detect the overlap before writing any item."},{"id":"c2","text":"When rex add detects a duplicate proposal, rex shall show the user a reason explaining why the proposal duplicates the matched item."},{"id":"c3","text":"When rex add detects a duplicate proposal, rex shall write nothing until the user confirms a choice."},{"id":"c4","text":"When rex add detects a duplicate proposal, rex shall offer the user three choices: cancel, merge with the existing item, or force-create anyway."},{"id":"c5","text":"If the user force-creates a duplicate item, rex shall store an override marker on that item."},{"id":"c6","text":"Rex shall show an item's override marker in its CLI output and make the marker available to downstream tools."},{"id":"c7","text":"When the user chooses to merge a duplicate proposal with existing work, rex shall leave no empty or childless proposed parent epic in the PRD."}]
source: "smart-add"
---
