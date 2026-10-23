---
id: "2e184cee-25e9-4811-af0a-da72bb9c366f"
type: "capability"
title: "Self-Heal Tag Attribution on Created PRD Items"
slug: "self-heal-tag-attribution-on-created"
statement: "When ndx self-heal creates a PRD item, the item carries the 'self-heal' tag, so autonomously created remediation work can be told apart from manually authored items."
criteria: [{"id":"c1","text":"When ndx self-heal creates a PRD item, whether through rex add, recommend --accept or a direct MCP write, ndx self-heal shall apply the 'self-heal' tag to that item."},{"id":"c2","text":"When a PRD item is created outside a self-heal run, for example by a manual add or ndx plan, the system shall not apply the 'self-heal' tag to it."},{"id":"c3","text":"When ndx self-heal creates a PRD item, ndx self-heal shall write the 'self-heal' tag to PRD storage as part of creating the item, not as a later update."},{"id":"c4","text":"While a self-heal run is in progress, ndx self-heal shall leave existing PRD items that lack the 'self-heal' tag unchanged."}]
source: "smart-add"
---

Ensure that every PRD item created or added during a self-heal run is automatically tagged with 'self-heal', making it easy to distinguish autonomously-created remediation work from manually-authored PRD items.
