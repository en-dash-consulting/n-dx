---
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

`ndx analyze` writes `.sourcevision/legacy.json` with the PHP pack: each file's version floor and every removed or deprecated construct it uses, for planning an upgrade file by file.

Uses are listed by rule, status, version and line, sorted by path then position, with third-party files apart and mirror copies left out, so the per-file counts sum to `sdlc-profile.json`'s `ecosystem` totals. No code text and no URLs are written. A repository without such facts gets no `legacy.json`, and one an earlier run left is removed. The dashboard serves and watches the file once it exists.
