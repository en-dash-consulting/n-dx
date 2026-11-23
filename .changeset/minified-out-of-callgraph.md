---
"@n-dx/sourcevision": patch
"@n-dx/core": patch
---

`ndx analyze` now leaves minified bundles out of `callgraph.json`; `--include-minified` maps them again.

A file is minified when its name is `*.min.js`, `*.min.mjs`, `*.min.cjs`, `*.min.css`, `*-min.js`, `*.bundle.js` or a JS/CSS source map, or when a JS or CSS file has a line over 2,000 characters in its first 64 KiB. The inventory gives these files role `generated` wherever they sit, and still lists them. The call graph and the component catalog no longer parse files with role `generated` or `asset`, so a committed jQuery or theme bundle no longer adds hundreds of thousands of functions to `callgraph.json`. The analyze log names how many minified files were left out. `callgraph.json` covers JavaScript and TypeScript only; PHP call facts are not in it yet.

Call-cycle counting no longer overflows the stack on a call chain thousands of functions deep.
