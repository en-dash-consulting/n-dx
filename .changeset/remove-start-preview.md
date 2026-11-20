---
"@n-dx/core": patch
"@n-dx/web": patch
---

`ndx start --preview` is removed: the editable UI layout mock-up it served on port 3118 no longer ships, and the flag is now refused.

Action needed: stop a preview server that is still running with `ndx start --preview stop .` before upgrading, and delete any leftover `.n-dx-preview.pid` and `.n-dx-preview.port` files from the project root. After the upgrade, `ndx start --preview` exits with an error rather than starting or stopping anything.

The preview was a design surface for rearranging the dashboard's layout, not a second dashboard. The `web preview` subcommand, its `--file=` option, the `packages/web/src/preview/` documents and the `dist/preview/` copy in the published `@n-dx/web` package go with it. The flag is refused rather than ignored so that `ndx start --preview stop` cannot fall through to stopping the dashboard.
