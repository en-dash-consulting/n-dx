---
"@n-dx/web": minor
---

The hub root now serves a home page with one card per registered project instead of a bare list. Each card joins the registry onto that project's own server — branch, uncommitted files, agents running, PRD progress and the next task — through the new `GET /api/hub/overview`, which the page also re-reads every few seconds so a card that changes while you are looking at it updates without a reload. A project whose server is not answering still gets a card saying so. Cards carry a "Start working" link into that project's Runs view rather than a second execute route, follow the dashboard's own theme (same storage key, so the choice carries between them), and are reachable from the keyboard.
