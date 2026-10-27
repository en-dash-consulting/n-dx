---
id: "f6c36dec-764a-4a56-adc7-cb11e66890c9"
type: "capability"
title: "Deprecated npm Dependency Audit and Remediation"
slug: "deprecated-npm-dependency-audit-and"
statement: "The monorepo's package.json files declare no deprecated npm packages as direct dependencies, and the resolved dependency tree has no high or critical audit advisories."
criteria: [{"id":"c1","text":"Each monorepo package.json shall declare only direct dependencies that do not resolve to an npm-deprecated package."},{"id":"c2","text":"When pnpm audit runs against the monorepo, the dependency tree shall produce zero high or critical advisories."},{"id":"c3","text":"If a direct dependency has been replaced by an upgraded or successor package with a changed API, every call site in the monorepo shall use the replacement package's API."}]
source: "smart-add"
---

Identify and replace deprecated or end-of-life npm packages across all monorepo package.json files. Covers direct and transitive dependencies flagged by pnpm audit, npm deprecation notices, and packages with published successors.
