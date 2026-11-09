---
id: "8c5a1439-ad72-437a-a53f-42b4adc01221"
type: "change"
title: "n-dx recovers from a stale build or old hub itself instead of telling the user to rebuild and restart"
slug: "n-dx-recovers-from-a-stale-build-or"
intent: "Found on 2026-11-08 in terrarium_site: `ndx start .` printed no sign-in link because the hub (up 3d 9h) predated the source-linked ndx, and the only remedy offered was `pnpm --filter \"@n-dx/web...\" build`, then `ndx hub stop` (which stops all 25 registered projects), then `ndx start`. Users should not have to rebuild or restart n-dx by hand; the regular commands should bring it back in line.\n\nThis follows completed change e8f8129f (\"ndx start prints no sign-in link when the hub runs a dist/ older than the CLI…\"), which made the advice correct but left the work to the user.\n\n## Messages on origin/main whose fix is a manual rebuild or restart\n\n1. `packages/core/web.js` — `serverRefreshFix`, used by `staleWebDistWarning`, `noNonceNote` and the `hubBuildMismatch` warning: \"run 'pnpm --filter \"@n-dx/web...\" build' in <checkout>, then 'ndx hub stop', then 'ndx start'\" / \"restart the hub: …\" / \"reinstall n-dx so @n-dx/web matches this ndx\".\n2. `packages/core/web.js` `hubAuthMismatchMessage` (~l.1822): \"Stop it first ('ndx hub stop'), then run this command again.\" (hub open vs token mode)\n3. `packages/web/src/hub/sidecars.ts` `NO_NDX_CLI` (l.57): \"This hub was started without an n-dx CLI to ask about extensions. Restart it: ndx hub stop, then ndx start.\"\n4. `packages/web/src/hub/children.ts` (l.299) and `packages/web/src/hub/routes.ts` (l.207): \"the hub cannot tell which n-dx binary to run; restart it with `ndx start`\".\n5. `packages/web/src/hub/hub.ts` (l.460) log: \"(none — restart the hub with `ndx start`)\".\n6. `packages/core/extension-env.js` (l.243): \"Could not stop the <name> sidecar (HTTP …); restart the hub with ndx hub stop\".\n7. `packages/core/cli.js` (l.501): \"Build artifact missing … Hint: Run 'pnpm install' (or 'pnpm build') from the repo root\".\n8. `packages/core/export.js` (l.712): \"Error: Viewer not built. Run 'pnpm build' first.\"\n\nNot in scope: `ndx hub stop`'s own help and the `Stop:` line `ndx start` prints, which describe the command rather than prescribe it as a fix."
acceptanceCriteria:
  - "When the running hub is an older build than this ndx, ndx start replaces it and re-registers every project it served, without the user running ndx hub stop"
  - "Every project registered before an automatic hub restart serves again on the same /p/<id>/ URL afterwards"
  - "If a restart would interrupt live work (an ndx work run, open MCP sessions), ndx start defers it and says when it will happen, rather than asking the user to stop the hub"
  - "On a source-linked install whose dist/ lags its source, ndx rebuilds the stale packages before spawning instead of printing a pnpm command"
  - "A hub auth-mode mismatch (open vs token) is resolved by restarting the hub in the requested mode when it is safe, not by telling the user to stop it"
  - "Hub-side faults (NO_NDX_CLI, unknown n-dx binary, sidecar stop failure) are repaired by the hub or by the next ndx command; none tells the user to run ndx hub stop or ndx start"
  - "A test fails any user-facing message in packages/core or packages/web/src that gives ndx hub stop, pnpm build/pnpm install or a restart as the fix, apart from a listed set of exceptions with reasons"
touches:
  - "e96db771-5ed0-4ba8-a70b-74a30f462f65"
priority: "high"
source: "ndx-capture"
---
