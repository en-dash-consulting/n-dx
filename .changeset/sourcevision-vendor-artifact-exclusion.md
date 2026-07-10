---
"@n-dx/sourcevision": patch
---

Exclude vendored third-party dependency directories from analysis in every project. Vendored deps are excluded via skip-directories (like `node_modules`), but only per-language configs skipped them (Go's `vendor/`, Python's virtualenvs) — the universal skip set held only `.git` and n-dx tooling dirs. A TS-primary repo with a committed `vendor/`, `third_party/`, `bower_components/`, `jspm_packages/`, etc. would therefore walk and classify those files as source, inflating language stats and distorting source-logic analysis. A new universal `VENDOR_SKIP_DIRS` set (`vendor`, `vendored`, `third_party`, `third-party`, `thirdparty`, `bower_components`, `jspm_packages`, `web_modules`, `Godeps`, `.yarn`) is now merged into the skip set for all projects. Directories are matched by exact name at any depth, so a plural `vendors/` directory or a `vendor-utils.ts` source file remains included.
