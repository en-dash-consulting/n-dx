---
"@n-dx/graview": patch
"@n-dx/graview-face": patch
"@n-dx/core": patch
---

The Graview product face is an n-dx extension. `@n-dx/graview-face` declares an `ndx.extension` block with the `graview-face` sidecar, and `ndx graview serve` runs the launch plan `ndx extensions sidecar graview-face --json` prints instead of looking for the face itself. The flags and environment the face gets are unchanged. Run `ndx extensions enable graview-face` once to approve the face; until then `serve` exits 2 naming that command, and `--no-face` serves the bare store. A disabled or missing face gets the bare store. `graview.app` is retired: list a face checkout under `extensions.paths` in `<ndx home>/config.json` instead. The face honours the hub's `PORT` when no `--port` is given. A sidecar launch plan now includes the extension's `dir`, and a refusal includes its `state`.
