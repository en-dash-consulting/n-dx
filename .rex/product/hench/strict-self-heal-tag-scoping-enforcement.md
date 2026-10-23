---
id: "3d6ce70a-5c04-49a7-a358-90490b7ffa41"
type: "capability"
title: "Strict Self-Heal Tag Scoping Enforcement"
slug: "strict-self-heal-tag-scoping-enforcement"
statement: "During a self-heal run, every PRD item the system creates is tagged 'self-heal-items', and in self-heal mode the hench task selector runs only items that carry that tag."
criteria: [{"id":"c1","text":"The system shall define the self-heal tag value in a single exported constant that both the item-creation paths and the hench task selector import."},{"id":"c2","text":"When a self-heal run creates a PRD item (epic, feature or task) through recommend, analyze, smart-add or ad-hoc add, the system shall write the 'self-heal-items' tag into that item's persisted frontmatter."},{"id":"c3","text":"While running in self-heal mode, the hench task selector shall return only items whose tags include 'self-heal-items'."},{"id":"c4","text":"While running in self-heal mode, if an item has no tags or lacks the 'self-heal-items' tag, the hench task selector shall skip it and log the reason."},{"id":"c5","text":"If an existing item carries the legacy 'self-heal' tag, the system shall either treat it the same as 'self-heal-items' during self-heal selection or retag it to 'self-heal-items' in a one-time migration."}]
source: "smart-add"
---

The self-heal loop is documented to tag items it creates and to only operate on tagged items, but recent observation suggests the scope filter is not being enforced strictly enough — self-heal runs are picking up untagged tasks. Lock down the contract so self-heal sessions exclusively tag every created item with the 'self-heal-items' marker and the task selector refuses to execute any item missing that tag. This hardens the behavior previously delivered under feature ae28134a (selection filter) and feature 2e184cee (tag attribution).
