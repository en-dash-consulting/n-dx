---
id: "77b3224f-68b0-4bd0-9d08-20c42819a9f1"
type: "change"
title: "Dashboard server routes to read, place and propose Inbox changes"
slug: "dashboard-server-routes-to-read-place"
intent: "PR 2 of 5 for issue #873. Design and decisions: https://claude.ai/artifact/PS6Jg1NgsJ2a6nidJx4HBm.\n\nNo dashboard route calls rex's placement today: `packages/web/src/server/routes-rex/product.ts` only reads `needsPlacement`, and `items.ts` sets it when Quick Add creates a v2 change. This change adds the server half the viewer PRs need, on top of PR 1's exports:\n- read a change's placement shortlist, enriched with what the viewer shows (title, type, area, statement, criteria, strength, reasons);\n- place a change (touches or amends) and propose a new home, both through rex's v2 transaction, the execution log and the `rex:prd-changed` broadcast;\n- an Inbox count on `/api/status`, which already feeds the bottom bar and refetches on every PRD change;\n- capture-time placement: `POST /api/rex/items` on v2 accepts `touches`.\n\nSame write path as the CLI and MCP; the server adds no placement logic of its own.\n\nLive numbers on this repo (2026-10-27): 175 changes in `.rex/changes/inbox/`, 19 open, 156 applied but still flagged `needsPlacement` (IB2: shown as a count, never placeable)."
acceptanceCriteria:
  - "GET /api/rex/changes/:id/placement returns the shortlist with title, type, area, statement, criteria, score, strength and reasons, plus relation and tied"
  - "POST /api/rex/changes/:id/place and POST /api/rex/changes/:id/propose write through rex's v2 transaction, log to the execution log and broadcast rex:prd-changed"
  - "A refusal answers 422 with rex's plain message and its kind; a v1 tree answers 409"
  - "/api/status reports rex.inbox { open, appliedUnplaced } on a v2 tree"
  - "POST /api/rex/items on v2 with touches creates a change that is not in the Inbox"
  - "Changeset bumps @n-dx/web as patch"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "high"
tags:
  - "inbox-placement"
  - "issue-873"
  - "web"
source: "ndx-capture"
blockedBy:
  - "fb0b3070-5a37-4772-9c17-0564a0c2a547"
---
