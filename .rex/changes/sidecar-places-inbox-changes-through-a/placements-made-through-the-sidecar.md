---
id: "dc9f6945-8db1-466b-8857-fee10b03c5f6"
type: "task"
title: "Placements made through the Sidecar record who decided and why"
slug: "placements-made-through-the-sidecar"
description: "Story 31: change_placed and change_proposed log events gain optional decision fields for Sidecar placements. Design §5 Place (Q8) additions."
acceptanceCriteria:
  - "A placement or proposal written through a Sidecar card logs decidedBy 'sidecar:<session id>', approvedBy (the operator, resolved the way lastModifiedBy is) and the agent's reasons; a Plan-lens change-set placement logs decidedBy and approvedBy too"
  - "CLI, MCP and dashboard placements log exactly what they log today (tested)"
  - "Readers of the execution log ignore the new fields: rex's log reads and the dashboard's log views read an entry carrying them without error (tested)"
source: "ndx-capture"
---
