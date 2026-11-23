---
id: "928ae7a6-5a15-4371-9eac-e30e0210bbf5"
type: "change"
title: "Assign Inbox and backlog items to people, and show mine by default"
slug: "assign-inbox-and-backlog-items-to"
summary: "Anyone can assign an Inbox or backlog item to a person who works on the repository, or type in someone new by id or email. The Inbox opens on your own items when you have any, with one click to see everyone's."
intent: "Changes already carry an assignee field (matched by ndx work --mine). Add an assignee picker to Inbox and backlog rows and the change detail panel. It lists the repository's known people (git commit authors and product-layer stewards, deduplicated by email) and accepts a free-form user id or email for someone not yet in the repo. Add an assignee filter to the Inbox and backlog: Mine / All / a specific person. Default to Mine when the current user (git config user.email, the same identity ndx work --mine uses) has at least one assigned open item, otherwise All. The filter only hides rows; no existing item or behaviour is removed. Lists stay sorted."
acceptanceCriteria:
  - "Inbox rows, backlog rows and the change detail panel offer an assignee picker"
  - "The picker lists known people from git authors and product stewards, deduplicated by email"
  - "The picker accepts a free-form id or email for a person not in the list, and saves it as the assignee"
  - "Assigning and clearing an assignee writes through the existing assignee field and is reflected after reload"
  - "The Inbox and backlog have an assignee filter with Mine, All and per-person options"
  - "The filter defaults to Mine when the current user has assigned open items, and to All otherwise"
  - "Filtering hides rows only; switching to All shows every item that was there before"
  - "Unit tests cover the people list, the default filter choice and free-form entry"
touches:
  - "2171d478-2d5b-4926-8e85-837f52c99abd"
priority: "medium"
tags:
  - "web"
  - "plan"
  - "inbox"
  - "collaboration"
source: "ndx-capture"
---
