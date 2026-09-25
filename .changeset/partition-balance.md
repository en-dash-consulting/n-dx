---
"@n-dx/sourcevision": patch
---

Zones stay balanced. A subdivision that leaves one child holding most of its parent is retried, and dropped if it can't be balanced, so nested zones no longer form a chain of one dominant child plus slivers. When the zone count is capped, the zones most tightly bound to a neighbour are merged first, so one zone no longer absorbs whole features. An oversized zone now makes the partition borderline. Test directories nested in code (`__tests__`, `packages/x/tests/<suite>`) form one zone per parent or suite instead of one project-wide test zone. The iso map draws sub-zones as tiles on their parent block and lists them in its side panel.
