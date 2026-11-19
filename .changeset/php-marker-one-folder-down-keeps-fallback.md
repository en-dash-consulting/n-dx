---
"@n-dx/lang-kit": patch
---

`sv analyze` keeps TypeScript's skipped folders and test patterns in a repository whose only PHP marker is one folder down, such as `frontend/package.json` beside `backend/composer.json`.

Before, a `composer.json` or `index.php` in a direct child directory made the repository PHP alone, so `frontend/node_modules/` and `frontend/dist/` were listed as source, `App.test.tsx` as source rather than test, and `.d.ts` files as source rather than generated. Now PHP is detected beside the TypeScript fallback when a direct child directory holds `package.json` or the repository has source of a language with no config of its own (Rust, Ruby, …). The two are ordered by source-file count. A site whose PHP app sits one folder down, with no such evidence, is still PHP alone.
