---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Each package's full build now ends by writing `dist/.build-stamp.json`, a hash of the source it compiled. The repository's affected test gate uses it to tell a current build from a stale one by content rather than by file times, so a partial build no longer hides stale compiled code and an identical-content rewrite no longer demands a rebuild.
 The stamp is excluded from the published tarballs.
