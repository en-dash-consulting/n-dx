---
"@n-dx/web": patch
---

Add two browser test layers to the dashboard: a manual Playwright suite (`pnpm run test:e2e-manual`) that records video of three real-vendor flows — prompt to completed agent run, analysis plus a form-added task to completion, and a Settings vendor/model switch followed by a three-task iteration run on Claude then Codex — and happy-click specs in the automated `e2e-ui` suite that press every safe control on every dashboard page and assert its intended effect, with a shared click policy naming what a sweep must never press.
