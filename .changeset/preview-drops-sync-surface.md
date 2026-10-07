---
"@n-dx/web": patch
---

The shipped `ndx start --preview` mockups no longer advertise the removed tracker integrations. Gone: the "ndx sync" settings page and its "Remote Sync" panel from `index.layout.json`, and the `s-sync` page, the `sync` command row and the `rex.notionSync` / `rex.integrations` flag rows from `option1-demo.html`. `build.js` copies `src/preview` into `dist/preview`, so these were published in the package and offered commands and flags that no longer exist. The `/notion-config` → `/project` redirect alias is unchanged — it is kept for 0.8.0 URL compatibility.
