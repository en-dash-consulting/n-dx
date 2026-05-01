---
id: "5ec16345-5c46-4197-9fa3-bcb50d58ce19"
level: "feature"
title: "Eliminate prd.md from Read and Write Paths in ndx add and Related Commands"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "Audit ndx add, rex add, and the smart-add pipeline to ensure none of them read from or write to .rex/prd.md. All add/edit operations must mutate only the .rex/prd_tree folder structure. Legacy prd.md should be ignored at runtime (no fallback read), with migration handled exclusively by the existing rex migrate-to-folder-tree command."
---

# Eliminate prd.md from Read and Write Paths in ndx add and Related Commands

 [pending]

## Summary

Audit ndx add, rex add, and the smart-add pipeline to ensure none of them read from or write to .rex/prd.md. All add/edit operations must mutate only the .rex/prd_tree folder structure. Legacy prd.md should be ignored at runtime (no fallback read), with migration handled exclusively by the existing rex migrate-to-folder-tree command.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add architecture-policy test enforcing prd.md is not read or written outside migration helper | task | pending | 1970-01-01 |
| Audit and remove all prd.md read fallbacks and write paths from ndx add and rex add pipelines | task | completed | 2026-05-01 |

## Info

- **Status:** pending
- **Level:** feature
