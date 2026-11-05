---
"@n-dx/core": patch
"@n-dx/web": patch
---

An extension can declare one Sidecar drawer tab with `sidecarTab: { label, path }` in its manifest (needs a `sidecar`; `apiVersion` stays 1). With `?project=<id>`, `GET /api/hub/extensions` adds `tab: { label, url } | null` to each entry. Earlier releases list an extension that uses the field as invalid, so set `ndxVersion` to this release or later.
