---
"@n-dx/web": patch
---

Opening the URL `ndx start` prints no longer answers a bare "Not found" once the browser already holds the `ndx_token` cookie. Both token gates (hub and project server) now redirect a navigation carrying `?ndx_token=` to the clean URL whether or not the request is already authenticated, so the token never stays in the address bar; and the static route matches on the pathname, so `/?anything` serves the dashboard instead of falling through to the 404.
