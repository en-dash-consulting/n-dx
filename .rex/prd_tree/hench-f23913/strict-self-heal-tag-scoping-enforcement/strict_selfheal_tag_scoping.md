---
id: "3d6ce70a-5c04-49a7-a358-90490b7ffa41"
level: "feature"
title: "Strict Self-Heal Tag Scoping Enforcement"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "The self-heal loop is documented to tag items it creates and to only operate on tagged items, but recent observation suggests the scope filter is not being enforced strictly enough — self-heal runs are picking up untagged tasks. Lock down the contract so self-heal sessions exclusively tag every created item with the 'self-heal-items' marker and the task selector refuses to execute any item missing that tag. This hardens the behavior previously delivered under feature ae28134a (selection filter) and feature 2e184cee (tag attribution)."
---

## Children

| Title | Status |
|-------|--------|
| [Standardize self-heal tag to 'self-heal-items' across creation and selection paths](./standardize-self-heal-tag-to-756197/index.md) | in_progress |
