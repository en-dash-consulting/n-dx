---
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Clear the last literal `.rex/`, `.hench/` and `.sourcevision/` paths, and make
the policy that forbids them a wall rather than a ratchet.

Where n-dx keeps its state is `resolveLayout`'s decision — `.ndx/rex` or
`.rex`, depending on the project's layout. A literal takes that decision a
second time in a file that has no idea which layout it is running under, and it
fails *silently*: the wrong path is simply a path nothing wrote to, which is
indistinguishable from a project that has nothing to show.

Two of the sites cleared here were live defects of exactly that shape, both on
a migrated project: `rex analyze` stamped every proposal it derived from an
analysis with `.sourcevision/zones.json`, naming a file the project does not
have, and hench's reviewer was told to list `.rex/prd_tree/` before capturing a
finding — a listing that came back empty, so every finding looked new and
duplicates got filed. A third, sourcevision's `prd-epic-resolver`, built its
paths from a fixed `.rex` too, but in a helper nothing calls; it now asks the
resolver so the literal is gone, and no command's behaviour changes.

The rest were display copy and one bucket key. Viewer text that names a
directory now names the command or the tool instead (`Make sure hench is
initialized for this project`), because the browser has no resolver to ask;
`sv pr-markdown --help` names its output file without fixing the folder; and
`rex status`'s canonical PRD bucket key now comes from the same constant as the
attributions it has to match, rather than from a second copy that agreed by eye.

Two files are allowed to keep a literal, both with the argument in their own
docstring: the viewer's `state-paths.ts`, a browser-safe twin of
`layoutStateNames()` pinned to the resolver by the contract test, because
`layout.ts` reaches for `node:fs` at module scope and cannot be bundled; and
rex's `LEGACY_SOURCE_FILE_PREFIX`, which is a value already written into PRD
data rather than a path any process constructs.

`tests/e2e/layout-literal-policy.test.js` now fails on *any* `.rex/`, `.hench/`
or `.sourcevision/` literal outside that allow-list, naming the file and line.
The `.n-dx*` config files stay on the inventory ratchet — 29 sites across
llm-client, hench and web are still waiting on that sweep — and the detector's
self-test now floors the files it visits rather than the literals it finds, so
it keeps its teeth once the debt reaches zero.
