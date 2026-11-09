---
id: "93f2d213-a16e-40da-8785-bc8848270d8a"
type: "task"
title: "deepMerge skips prototype-chain keys from a config file"
slug: "deepmerge-skips-prototype-chain-keys"
description: "packages/core/config.js deepMerge (~230-249): a literal __proto__ key in .n-dx.json or .n-dx.local.json becomes an own key after JSON.parse and the merge assigns it, setting the merged object's prototype. File-controlled and local to that object, so low, but the same class the stack #855 guards closed elsewhere. Surfaced by the layer 6 review. Fix: skip __proto__, constructor and prototype keys while merging, inline the three-name set as config.js does elsewhere."
acceptanceCriteria:
  - "Merging a config object with a __proto__ key leaves the result's prototype and Object.prototype unchanged, with a test"
  - "Ordinary nested keys merge as before"
priority: "low"
source: "codeql-triage"
---
