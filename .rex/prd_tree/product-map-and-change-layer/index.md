---
id: "72fe1093-132e-46f1-ad46-af304a453612"
level: "epic"
title: "Product map and change layer"
status: "pending"
priority: "high"
tags:
  - "product-map"
  - "storage-v2"
source: "roadmap"
description: "Turn the PRD into two layers that together are the product's requirements: a product layer (areas, capabilities, constraints: the standing requirements, each with a computed build status) and a change layer (changes, tasks, subtasks; linear, closes). Releases become a field on a change (plannedRelease, shippedIn), never a container. Ships with storage v2 (.ndx/rex/product and .ndx/rex/changes, intent in Markdown, tool state in a committed state.yaml per folder, frozen slugs, no Children tables), the finished .ndx/ layout, removal of legacy formats and the unused tracker adapters, a map-based agent brief, and host-neutral provenance (GitHub and Bitbucket). Work lands as incremental PRs to main, one feature per PR; the Version Packages PR is held until the release gate passes. Every task runs through ndx (ndx work --task, or /ndx-work for assisted runs). Design and decisions: https://claude.ai/code/artifact/90af941f-79aa-47ad-b9e3-139ba70472fd"
lastModified: "2026-10-06T16:54:39.109Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
plannedRelease: "1.0.0"
---

## Children

| Title | Status |
|-------|--------|
| [Agent brief from the product layer](./agent-brief-from-the-product-layer/index.md) | pending |
| [Apply engine for change amendments](./apply-engine-for-change-amendments/index.md) | pending |
| [Apply the migration](./apply-the-migration/index.md) | pending |
| [Capture the product map roadmap](./capture-the-product-map-roadmap/index.md) | completed |
| [CLI for the product layer and changes](./cli-for-the-product-layer-and-changes/index.md) | pending |
| [Correct the v2 schema before files are written](./correct-the-v2-schema-before-files-are/index.md) | pending |
| [Dashboard on the v2 model](./dashboard-on-the-v2-model/index.md) | pending |
| [Define the v2 PRD schema](./define-the-v2-prd-schema/index.md) | completed |
| [Derived status, health and computed edges](./derived-status-health-and-computed-edges/index.md) | pending |
| [Docs, skills and policies for the v2 model](./docs-skills-and-policies-for-the-v2/index.md) | pending |
| [Every n-dx commit carries an item trailer](./every-n-dx-commit-carries-an-item/index.md) | pending |
| [Generate the migration plan](./generate-the-migration-plan/index.md) | pending |
| [MCP tools for the product layer and changes](./mcp-tools-for-the-product-layer-and/index.md) | pending |
| [Merge driver and bundle format for v2](./merge-driver-and-bundle-format-for-v2/index.md) | pending |
| [Migrate this repository and cut 1.0.0](./migrate-this-repository-and-cut-1-0-0/index.md) | pending |
| [Move the Jev client into llm-client and redact Bitbucket tokens](./move-the-jev-client-into-llm-client/index.md) | completed |
| [Placement engine for changes](./placement-engine-for-changes/index.md) | pending |
| [Product, Changes and capability views on fixtures](./product-changes-and-capability-views/index.md) | pending |
| [Read and write the v2 folder trees](./read-and-write-the-v2-folder-trees/index.md) | pending |
| [Recommendations become changes](./recommendations-become-changes/index.md) | pending |
| [Remove the unused tracker integrations](./remove-the-unused-tracker-integrations/index.md) | completed |
| [Review follow-ups for the product layer work](./review-follow-ups-for-the-product/index.md) | pending |
| [Route remaining state paths through the layout resolver](./route-remaining-state-paths-through/index.md) | completed |
| [Select and complete work on changes](./select-and-complete-work-on-changes/index.md) | pending |
| [Shared assistant guidance for every vendor](./shared-assistant-guidance-for-every/index.md) | pending |
| [Single state writer for state.yaml](./single-state-writer-for-state-yaml/index.md) | pending |
| [Split the rex MCP tools into one module per tool](./split-the-rex-mcp-tools-into-one/index.md) | completed |
| [Stamp shippedIn from any CI](./stamp-shippedin-from-any-ci/index.md) | pending |
| [Stewards and code-owner files](./stewards-and-code-owner-files/index.md) | pending |
| [User docs and docs.n-dx.dev for the v2 model](./user-docs-and-docs-n-dx-dev-for-the-v2/index.md) | pending |
