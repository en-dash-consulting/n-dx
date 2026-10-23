---
id: "72fe1093-132e-46f1-ad46-af304a453612"
type: "area"
title: "Product map and change layer"
slug: "product-map-and-change-layer"
summary: "Turn the PRD into two layers that together are the product's requirements: a product layer (areas, capabilities, constraints: the standing requirements, each with a computed build status) and a change layer (changes, tasks, subtasks; linear, closes). Releases become a field on a change (plannedRelease, shippedIn), never a container. Ships with storage v2 (.ndx/rex/product and .ndx/rex/changes, intent in Markdown, tool state in a committed state.yaml per folder, frozen slugs, no Children tables), the finished .ndx/ layout, removal of legacy formats and the unused tracker adapters, a map-based agent brief, and host-neutral provenance (GitHub and Bitbucket). Work lands as incremental PRs to main, one feature per PR; the Version Packages PR is held until the release gate passes. Every task runs through ndx (ndx work --task, or /ndx-work for assisted runs). Design and decisions: https://claude.ai/code/artifact/90af941f-79aa-47ad-b9e3-139ba70472fd"
tags:
  - "product-map"
  - "storage-v2"
source: "roadmap"
plannedRelease: "1.0.0"
priority: "high"
---
