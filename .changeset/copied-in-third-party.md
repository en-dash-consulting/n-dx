---
"@n-dx/sourcevision": patch
"@n-dx/core": patch
---

`ndx analyze` now recognises third-party libraries copied into a repository by hand and leaves them out of zones, classification, the call graph, primary-language detection, readiness evidence and migration totals.

Mark them with `sourcevision.thirdParty` globs in the project config, `--third-party=<glob>` or `--third-party-file=<path>`; well-known libraries (PHPExcel, YUI, EditArea, the AuthorizeNet SDK, TinyMCE and others) are recognised from their own headers or directory names. A `!glob` denies a match.

Each such file stays in `inventory.json`, marked `thirdParty` with the reason and counted in `summary.thirdParty`, and imports into it still resolve. Analyze prints one line with the count per reason. `--include-third-party` maps them in `callgraph.json`. `sdlc-profile.json` counts their legacy constructs and dynamic code apart, under `ecosystem.<language>.thirdParty`, and an `outbound.json` call inside one is kept and marked `thirdParty`. A repository whose libraries had been read as application code gets a different, smaller zone map, by design.
