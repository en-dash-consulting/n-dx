---
id: "2ae3fbcd-895e-40a2-8a3b-c0d419dd0331"
type: "change"
title: "Place an applied change after the fact, so migrated history leaves the Inbox"
slug: "place-an-applied-change-after-the-fact"
intent: "Follow-up to issue #873 (decision IB2, reframed 2026-10-27). The v1→v2 migration left 156 applied changes in `.rex/changes/inbox/` still flagged `needsPlacement` (175 in the Inbox, 19 open). The first idea was to have rex clear the flag. That breaks a rex invariant: `needsPlacement` is what exempts a change with no `touches` or `amends` from the `change-has-target` rule (`schema/v2.ts`, `schema/v2-rules.ts`), and the migration kept these as records on purpose (`change-placed-at-close`, `migrations/v1-to-v2/apply.ts`). Clearing it would turn 156 warnings into errors.\n\nThe valid way out is to give each one a target. Today `recordPlacement` refuses any change that isn't open (`change-not-open`). Allow an applied change to be placed with relation `touches` only: amends stays refused, because an applied change's amendments have already reached the map. That clears the flag the legitimate way and links the history to the capability it built. Nothing is bulk-accepted: a person picks each target. The rules' shortlist is offered as for open changes.\n\nDesign context: https://claude.ai/artifact/PS6Jg1NgsJ2a6nidJx4HBm (PR 3 already keeps these out of the Inbox count and shows them as a collapsed line)."
acceptanceCriteria:
  - "An applied change can be placed with relation touches from rex core, the CLI, MCP and the dashboard route; amends on an applied change is refused with a clear message"
  - "Placing an applied change clears needsPlacement, moves it out of changes/inbox/ and leaves rex health with no new error or warning for it"
  - "The dashboard's collapsed 'applied, never placed' line opens a list from which each can be placed through the detail panel"
  - "Changeset bumps the changed packages as patch"
touches:
  - "70443075-8352-48a4-a8ed-799505872d4b"
  - "5cfa1d83-839a-47a1-ae42-4353cd1acf83"
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "low"
tags:
  - "inbox-placement"
  - "issue-873"
  - "rex"
  - "web"
source: "ndx-capture"
blockedBy:
  - "21a8d036-41d6-45fb-b10c-181f074f3e4f"
---
