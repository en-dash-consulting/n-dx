---
id: "27eab993-7418-46e3-bdb0-52d868031058"
type: "task"
title: "Sidecar explains a product area, capability or zone on v1 and v2 trees"
slug: "sidecar-explains-a-product-area"
description: "Story 16 (CAOS https://www.notion.so/3f7a80b7192481f88060ea9e55cdbf00). The agent cannot judge a model's answer, so this task builds and tests what the Explain lens sends: its packet (sidecar/lens-packets.ts, packet-builders.ts, buildLensPacket) and its lens instructions. For a capability the packet carries each capability criterion with its derived status (met, not met, not verified) and its evidence, read through rex-gateway as get_capability does. For a product area it carries the area's capabilities; for a sourcevision zone the zone summary through domain-gateway. On a v1 tree the packet says there is no product layer and explains from the PRD and zones. The instructions require the met / not met / not verified labels with evidence, and the words 'capability criteria' (standing requirements on the product layer) versus 'done when' (a change or task's acceptance criteria). Packets stay within the lens's bound. Mock: Explain board."
acceptanceCriteria:
  - "An Explain packet for a capability lists each capability criterion with its status and evidence (tested)"
  - "Explain packets for a product area and for a zone carry the area's capabilities and the zone's summary (tested)"
  - "On a v1 tree the Explain packet says there is no product layer (tested)"
  - "The Explain lens instructions require the met / not met / not verified labels with evidence and the 'capability criteria' versus 'done when' wording (tested)"
  - "With a stub vendor, the Explain packet and instructions reach the session's first turn, within the lens's bound (tested)"
priority: "medium"
source: "caos"
---
