---
"@n-dx/web": patch
---

A request to an extension sidecar that crashes while the hub revalidates its launch plan now starts it again, instead of answering 503 "the hub is shutting down". A sidecar stopped on purpose during that check stays stopped and answers 404, as a stop during a first launch does.
