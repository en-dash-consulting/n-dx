---
id: "8397f708-ccfc-4b8d-b8cf-a8047e91b84d"
type: "task"
title: "Placement approval refuses when the reviewed placement's spec moved, edited or not, and never writes a refused card"
slug: "placement-approval-refuses-when-the"
description: "Review F1 and F2 on #946. F1: sidecar-cards.ts sends only placementEdit.body with Place, readPlacementEdit dry-runs it on the current spec, and writePlacementCard pins that fresh result as expect, so movedSince compares the new spec hash with itself. F2: const expect = placement.check.ok ? placement.check : undefined lets an approval of a card raised with a refusal write unpinned; the viewer blocks it, the server does not."
acceptanceCriteria:
  - "Place on an edited card sends the dry run the operator reviewed (the edit's check) with the approval. The server refuses with 409 and writes nothing when movedSince(reviewed check, server re-check) is set: target, relation or spec hash moved since the operator's last check (tested: amends edited in the card, target spec reworded before Place, nothing written)"
  - "When an edited placement keeps the card's target and relation, the server re-check's base must also equal the card's own check base; otherwise the approval is refused the same way (tested)"
  - "Approving a card whose own dry run was refused, with no edit, calls no writer and returns the card's refusal ('Rex refused the placement (kind: …)… Nothing was written.'), even when the PRD has since changed so rex would accept it (tested with a target created after the card was raised)"
  - "An unedited card that still applies cleanly is written exactly as before, and the existing stale-card tests keep passing"
source: "ndx-capture"
---
