---
id: "c6f00d82-e4fc-42c0-a61a-5f691bb20542"
type: "task"
title: "Failing items are exempt from short-title uniqueness"
slug: "failing-items-are-exempt-from-short"
summary: "Work that is currently failing doesn't count when checking short names for duplicates, even though it is the most urgent work. This makes failing items hold their name like other open work."
description: "Verdict: should-fix (severity medium); the user decided failing counts as open. From the adversarial review of feat/short-titles.\n\nrex treats failing as the most actionable status (change-selection.ts:93: ACTIONABLE = {pending, in_progress, failing}; selection ranks failing first), but NAME_HOLDING_STATUSES in packages/rex/src/core/short-title.ts:19 omits it and a unit test pins that. Trigger: set task T to failing; another open item can take T's name, and both appear in Ready to run under the same name. A failing item can also take any open item's name because its own status skips the check.\n\nFix: add 'failing' to the set and flip the unit test. One word; nothing relies on the exemption yet."
acceptanceCriteria:
  - "A short title equal to a failing item's shown name is refused"
  - "A failing item cannot take an open item's shown name as its short title"
  - "The unit test asserts failing holds a name"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
