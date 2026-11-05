---
id: "ea48bb24-27cc-4224-9e09-2d6ab4a54cc2"
type: "task"
title: "The hub home opens the hub session in a docked drawer with a purple scope chip"
slug: "the-hub-home-opens-the-hub-session-in"
description: "Story 25, part 3 of 3 (CAOS 3f7a80b7-1924-81b5-9c3e-d5aa3573b938). The hub-home entry on the 'Hub' mock board. home.ts stays server-rendered; the drawer is a drawer-only viewer entry the host serves through /hub/session/. Design §6, UX7; mock https://claude.ai/artifact/ShADFCVkG6XGvPrcs9wrUn (board Hub)."
acceptanceCriteria:
  - "The hub home header gains a 'Hub session' toggle (⌘J), shown only when the host reports the hub lens available"
  - "The toggle docks the drawer on the hub home, loaded from a drawer-only viewer entry the host serves through /hub/session/ on the hub's origin; home.ts imports no Preact and nothing from src/viewer/"
  - "The drawer head reads 'Hub session' with a purple 'Hub · all projects' scope chip, a 'snapshot · N Δ since your last turn' chip and the Hub lens chip; the composer shows 'read-only · drafts' and the ceiling meter against 40k"
  - "The new viewer entry reaches messaging and shared code only through src/viewer/external.ts and src/viewer/api.ts; colors come from existing theme tokens, so dark and light both apply"
  - "Tests render the hub home with the hub lens available and unavailable, and the drawer entry with the hub scope chip"
priority: "high"
source: "caos"
---
