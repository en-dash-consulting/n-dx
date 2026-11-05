---
id: "eed75eaf-9a45-483e-978a-34410fb2894c"
type: "change"
title: "Sidecar drawer polish"
slug: "sidecar-drawer-polish"
intent: "The Sidecar drawer's controls render as raw browser widgets: grey native vendor and model selects, a light-grey textarea on the dark drawer, a grey Send that reads as disabled, an outline-only 11px lens chip, a default grey Sessions button, and tool lines that show wire names like mcp__ndx-sidecar__fake__create_ticket. Restyle the drawer to the approved mockup (https://claude.ai/artifact/Vo7NBvdzogV3N55Y4Y1wyq) for an operator who is not a developer, in both themes, without changing behaviour. Stacked on C1 (feat/sidecar-c1-connections) so the external-call card's fields are covered too.\n\nShared rules (approved mockup: https://claude.ai/artifact/Vo7NBvdzogV3N55Y4Y1wyq, boards \"Proposed · dark\" and \"Proposed · light\"; operator feedback 2026-11-04: the vendor and model pickers look like raw browser controls, the lens tag at the bottom is hard to see, and the message box is hard on the eyes, especially for a non-developer):\n- Styling only through the existing design tokens in packages/web/src/viewer/styles/tokens.css (--bg, --bg-surface, --bg-hover, --bg-active, --border, --text, --text-dim, --text-muted, --accent, --select-chevron, --radius-md, --space-*). No new hex colours; a tint is color-mix() of a token. Both themes must hold 4.5:1 text contrast, and the light theme's --accent is the dark teal, so the accent-filled Send button uses --bg (or a token that passes) for its label in each theme.\n- Behaviour stays as it is: the same keys send (Enter sends, Shift+Enter breaks the line), the same tabs, toggles, lens menu and card actions. Keep every existing aria-label and test id, or update the tests that read them in the same commit.\n- Viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts; sockets through openWebSocket(). Do not edit packages/web/AGENTS.md or packages/web/src/server/AGENTS.md. Nothing turns on web.sidecar.\n- Tests: viewer unit tests (jsdom) assert structure, class names and accessible names; no screenshot tests. Add a patch changeset for @n-dx/web per task."
acceptanceCriteria:
  - "The drawer's header, agent bar, transcript tool lines, composer and external-call card match the approved mockup's structure in dark and light themes"
  - "No raw wire name (mcp__…) is the visible label of a tool line; the full name stays reachable in the line's details"
  - "No behaviour, route or keyboard shortcut changes; packages/web/AGENTS.md and src/server/AGENTS.md are unchanged"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "medium"
source: "ndx-capture"
---
