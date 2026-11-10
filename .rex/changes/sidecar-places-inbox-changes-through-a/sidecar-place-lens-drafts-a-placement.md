---
id: "23eb7360-bb32-40cf-b670-988fd545d4bb"
type: "task"
title: "Sidecar Place lens drafts a placement and carries it out through rex's own place and propose rules"
slug: "sidecar-place-lens-drafts-a-placement"
description: "Place lens packet, instructions and the place_change_card effect (story 29, server half). Reuses rex's suggestPlacement, recordPlacement and recordProposal and the Inbox stack's routes-rex/placement.ts; nothing re-implements a placement rule. Design §5 Place (Q8)."
acceptanceCriteria:
  - "LENS_PACKETS.place is a packet with a 6k cap for an attached change: its title, intent, tags and status; the rules' shortlist (top 5 with score, strength and reasons); each candidate's statement and capability criteria; the relation default and the rule that set it; and the open changes that would block apply. Each section carries provenance, and the shortlist comes from the same builder GET /api/rex/changes/:id/placement uses, not a copy"
  - "The lens targets a 'change' item (ref = change id): with none attached it is unavailable naming 'a change awaiting placement', on a v1 tree it is unavailable naming 'a v2 PRD', and no other lens's packet is sent (tested)"
  - "PLACE_INSTRUCTIONS have the agent recommend one target and relation with its reasons, draft the proposed statement and criteria delta for amends, propose a new capability or constraint under an area when nothing on the shortlist fits, and never offer apply_change"
  - "place_change_card takes change, then either target with relation, summary, proposed and criteria, or propose with type, under and title, plus the agent's reasons. When the card is raised, the server dry-runs the placement through rex's recordPlacement or recordProposal on the loaded tree without writing, and puts the result on the card: applies cleanly against the target's spec hash, or the refusal kind and message, plus warnings naming blocking changes (tested)"
  - "POST /api/rex/changes/:id/placement/check returns that same dry run for an edited placement and writes nothing (tested by hashing the tree)"
  - "On approval the broker writes through recordPlacement or recordProposal under withPrdModelTransaction, by the same function POST /api/rex/changes/:id/place and /propose use, then refreshes the PRD cache and logs. A rex refusal returns its kind to the agent, and a denied card writes nothing. place_change_card stays never allow-listable and leaves CARRIED_OUT_LATER"
  - "A proposed new node is recorded only as the change's added amendment and reaches the product layer only when the change is applied; nothing accepts it automatically (tested)"
  - "Tests cover a packet for a strong pick, a tied shortlist and an amends default, and carry-out for touches, amends with a criteria delta, propose, a refusal kind and a deny. No new viewer/external.ts export unless the server and viewer share the type, and no node:child_process in web"
source: "ndx-capture"
---
