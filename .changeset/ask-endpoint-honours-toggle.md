---
"@n-dx/web": patch
---

Enforce `sourcevision.ask` on the endpoint, not just in the viewer.

`POST /api/sourcevision/ask` now refuses with `403` and `kind: "disabled"` when
the toggle is off. Gating only the viewer made the toggle a property of one
client: the panel hid itself while anything else that could reach the port
still spent the project's tokens, which is the one consequence the toggle's
impact text names.

- **Checked before the body is read and before the analysis is loaded**, so a
  disabled project is told the feature is off rather than told about whichever
  other precondition it also happens to be missing.
- **Fails closed.** A missing `.n-dx.json`, an unparseable one, or a key absent
  from the registry all resolve to the registry default — `false` for Ask. A
  gate that opens when it cannot tell is not a gate.
- **Read per request, not cached.** Toggles are edited from the dashboard while
  the server runs; a value read once at startup would keep refusing after the
  user enabled it.

New `isFeatureEnabled(projectDir, key)` in `routes-features.ts` is the shared
reader. `disabled` is a first-class `AskErrorKind` with its own status, fallback
wording, and entry in the panel's per-kind presentation table, so the card names
the fault and points at the Feature Toggles view instead of rendering a bare
403. `askFailureKindFromStatus` deliberately does not mirror 403 back to
`disabled`: our own 403 carries its kind in the body, and a foreign 403 is an
access denial.

This diverges from `sourcevision.prMarkdown`, which stays viewer-gated. The
difference is deliberate — that page renders from analysis already on disk,
while each Ask call spends tokens. The two `/api/rex/*` routes the panel uses
(`capture-ask`, `apply-refinements`) are not gated: they belong to the rex
scope and neither one calls a model.
