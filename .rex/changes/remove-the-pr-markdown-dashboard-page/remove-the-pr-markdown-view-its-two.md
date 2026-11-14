---
id: "15a1950c-f3b5-46ce-bc5a-4713d34defb0"
type: "task"
title: "Remove the PR Markdown view, its two read routes and its toggle"
slug: "remove-the-pr-markdown-view-its-two"
description: "Do the removal the change describes in one pass: viewer view and styles, stage section, view id/routing/meta/registry entries and their fallback for old links, guide/FAQ/favicon mentions, the /api/sv/pr-markdown and /api/sv/pr-markdown/state routes, the route-gate row, the registry entry and the AGENTS.md example. Update the tests that cover them (route-feature-gates, view registry and routing, stage pages). Leave the sourcevision generator and ndx refresh untouched."
acceptanceCriteria:
  - "No viewer, server or shared source file under packages/web/src references pr-markdown or prMarkdown except where Ask still needs shared styles"
  - "Navigating to the old PR Markdown route lands on a SourceVision page"
  - "The web test suite passes"
priority: "medium"
tags:
  - "feature-flags"
source: "ndx-capture"
---
