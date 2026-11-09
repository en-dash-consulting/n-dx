---
id: "7d86374a-4f41-43a8-a200-3efcf806bcf8"
type: "task"
title: "The trust strip never takes more than about a third of the viewport, and its details scroll inside it"
slug: "the-trust-strip-never-takes-more-than"
description: "The strip sits above the page body in the shell's flex column (packages/web/src/viewer/main.ts renders RepoTrustStrip; packages/web/src/viewer/styles/shell.css `.app-body`), and packages/web/src/viewer/styles/repo-trust.css gives it no height limit, so a long strip squashes `.app-body` to nothing.\n\n- Give `.repo-trust-strip` a maximum height of about a third of the viewport (e.g. `max-height: 33vh` / `33dvh`), keep the headline row and its buttons always visible, and scroll the expanded Details content (findings and sources) inside the strip (`overflow-y: auto` on the details container, `min-height: 0` where a flex child must shrink).\n- Make sure the strip does not shrink below its headline row and `.app-body` keeps the rest: with Details open, `.app-body` keeps at least about two thirds of the viewport.\n- Tokens only from packages/web/src/viewer/styles/tokens.css, in both themes; vh/dvh units for the cap are fine.\n\nTests: wherever the viewer has a stylesheet test (look for tests that read packages/web/src/viewer/styles/*.css), add one asserting the strip's max-height and the scrolling details container; otherwise add a small test in packages/web/tests/unit/viewer/ that reads repo-trust.css and checks those rules. The layout itself is checked in a real browser after the run. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from packages/web/src/viewer/styles/tokens.css, in both themes; viewer copy names the CLI through useCliName() or a {cli} template with resolveCliLabel(), never a bare 'ndx <command>' (tests/unit/viewer/cli-name-labels.test.ts); do not edit packages/web/AGENTS.md; do not change what is trusted or restricted, the trust digest, or the 'Not now' behaviour (it hides the strip for one page load, by design for now); run the static root policy suites (tests/e2e/architecture-policy, domain-isolation) before finishing; add a `@n-dx/web` patch changeset."
acceptanceCriteria:
  - "repo-trust.css caps the strip at about a third of the viewport and scrolls the expanded details inside it (stylesheet test)"
  - "With Details open, `.app-body` keeps at least two thirds of the viewport (browser check after the run)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
blockedBy:
  - "f7cdcaab-b2f2-4495-8c98-e62e27e4e3dd"
---
