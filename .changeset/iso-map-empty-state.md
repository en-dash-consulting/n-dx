---
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Fix two isometric-map defects the new UI smoke test exposed.

`ndx init` writes empty `.sourcevision/` data files before anything has been analyzed, so `hasSourcevision()` was true on a freshly-initialized project and auto mode never fell back to a scan. A project full of source that had not been analyzed yet reported "nothing to map". Auto now falls back when the analysis parses but contains no zones.

`GET /api/iso-map` answered 404 for "this project has nothing to map yet". That is a state of the map, not a missing resource, and a 4xx on a `fetch` writes a network error into the browser console — which `tests/e2e-ui/navigation.spec.ts` requires every view to load without. It now answers 200 with an `x-iso-map-empty` marker header and a readable empty-state page, so the viewer still renders its own empty card and anyone opening the URL directly gets a page rather than a JSON blob. Genuine faults (bad parameter, wrong method, build failure) remain 4xx/5xx.

Also adds the `iso-map` and pre-existing `pr-markdown` views to the navigation smoke test, whose list is meant to track every `ViewId`.
